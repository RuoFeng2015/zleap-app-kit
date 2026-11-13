import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { approveBatch, createApprovalClient, loadApprovalOptions } from '../scripts/lib/release-approve.mjs';

const items = ['platform', 'cli', 'sdk', 'create'].map((name, i) => ({ name, version: '1.0.0', id: `00000000-0000-0000-0000-00000000000${i}` }));
const failure = (code) => Object.assign(new Error('SECRET upstream credential'), { code });
const options = { registry: 'https://registry.example/', '//registry.example/:_authToken': 'SECRET' };

test('ordered batch shares first OTP and never logs credentials', async () => {
  const calls = [], logs = []; let auth = 0;
  const result = await approveBatch(items, {
    client: { stagedItems: async () => [], approve: async (item, otp) => { calls.push([item.name, otp]); if (!otp) throw failure('EOTP'); } },
    authenticate: async () => { auth++; return 'SECRET'; }, log: (s) => logs.push(s),
  });
  assert.equal(auth, 1);
  assert.deepEqual(calls, [['platform', undefined], ...items.map(i => [i.name, 'SECRET'])]);
  assert.deepEqual(result.approved, items);
  assert.ok(!logs.join('').includes('SECRET'));
});

test('single-use OTP: stale OTP is dropped and each package gets a fresh browser challenge', async () => {
  const used = new Set(); let auth = 0; const challenges = [];
  const result = await approveBatch(items, {
    client: { stagedItems: async () => [], approve: async (item, otp) => {
      if (!otp) throw Object.assign(failure('EOTP'), { body: { authUrl: 'https://npmjs.com/auth', doneUrl: 'https://registry.example/done' } });
      if (used.has(otp)) throw failure('EOTP');
      used.add(otp);
    } },
    authenticate: async (error) => { challenges.push(error.body?.authUrl); return `OTP${auth++}`; },
  });
  assert.deepEqual(result.approved, items);
  assert.equal(auth, items.length);
  assert.ok(challenges.every(Boolean));
});

test('validation wait reports progress', async () => {
  const logs = []; let polls = 0;
  await approveBatch(items, {
    client: { stagedItems: async () => (polls++ === 0 ? [{ ...items[0], status: 'validating' }] : []), approve: async () => {} },
    wait: async () => {}, log: (s) => logs.push(s),
  });
  assert.match(logs[0], /等待 npm 校验/);
});

test('only EOTP reauthenticates, bounded per package', async () => {
  let auth = 0, calls = 0;
  await assert.rejects(approveBatch(items, {
    client: { stagedItems: async () => [], approve: async () => { calls++; throw failure('EOTP'); } },
    authenticate: async () => { auth++; return 'SECRET'; },
  }), /EOTP/);
  assert.equal(auth, 2); assert.equal(calls, 5);
});

for (const code of ['E403', 'E401', 'ETIMEDOUT', 'ECONNRESET', 'ABORT_ERR']) {
  test(`${code} stops batch and redacts upstream errors`, async () => {
    let auth = 0; const calls = [];
    await assert.rejects(approveBatch(items, {
      client: { stagedItems: async () => [], approve: async (item) => { calls.push(item.name); if (calls.length === 2) throw failure(code); } },
      authenticate: async () => { auth++; },
    }), error => {
      assert.ok(!error.message.includes('SECRET'));
      assert.match(error.message, /已成功：platform@1.0.0/);
      assert.match(error.message, /失败\/结果未知：cli@1.0.0/);
      assert.match(error.message, /尚未尝试：sdk@1.0.0、create@1.0.0/);
      return true;
    });
    assert.equal(auth, 0); assert.deepEqual(calls, ['platform', 'cli']);
  });
}

test('failure report shows HTTP status and timeout codes, nothing else from upstream', async () => {
  for (const [code, shown] of [['E429', 'E429'], ['E500', 'E500'], ['EIDLETIMEOUT', 'EIDLETIMEOUT'], ['SECRET_CODE', '请求失败或结果未知'], [undefined, '请求失败或结果未知']]) {
    await assert.rejects(approveBatch(items, {
      client: { stagedItems: async () => [], approve: async () => { throw failure(code); } }, wait: async () => {},
    }), error => {
      assert.ok(error.message.includes(`批准批次停止：${shown}`));
      assert.ok(!error.message.includes('SECRET'));
      return true;
    });
  }
});

test('E429 waits (honouring retry-after), reauthenticates and retries; gives up after bounded waits', async () => {
  const waits = [], logs = []; let calls = 0, auth = 0;
  const limited = Object.assign(failure('E429'), { headers: { 'retry-after': ['90'] } });
  const result = await approveBatch(items.slice(0, 1), {
    client: { stagedItems: async () => [], approve: async (item, otp) => { calls++; if (!otp) throw failure('EOTP'); if (calls === 2) throw limited; } },
    authenticate: async () => { auth++; return 'SECRET'; }, wait: async (ms) => { waits.push(ms); }, log: (s) => logs.push(s),
  });
  assert.equal(result.approved.length, 1); assert.equal(auth, 2);
  assert.deepEqual(waits, [60000, 30000]);
  assert.ok(logs.some((s) => /限流/.test(s)) && !logs.join('').includes('SECRET'));
  let total = 0;
  await assert.rejects(approveBatch(items.slice(0, 1), {
    client: { stagedItems: async () => [], approve: async () => { total++; throw failure('E429'); } }, wait: async () => {},
  }), /E429.*限流/);
  assert.equal(total, 4);
});

test('cancelled authentication stops with no further package requests', async () => {
  let calls = 0;
  await assert.rejects(approveBatch(items, {
    client: { stagedItems: async () => [], approve: async () => { calls++; throw failure('EOTP'); } },
    authenticate: async () => undefined,
  }), /取消/);
  assert.equal(calls, 1);
});

test('dry run and empty batch invoke nothing', async () => {
  await approveBatch(items, { dryRun: true });
  await approveBatch([]);
});

test('validation timeout never approves', async () => {
  let waits = 0;
  await assert.rejects(approveBatch(items, {
    client: { stagedItems: async () => [{ ...items[0], status: 'validating' }], approve: () => assert.fail() },
    wait: async () => { waits++; }, validationAttempts: 2,
  }), /校验等待超时/);
  assert.equal(waits, 1);
});

test('official configuration loads isolated project/env settings without real HOME', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'approval-config-'));
  try {
    writeFileSync(join(dir, 'package.json'), '{}');
    writeFileSync(join(dir, '.npmrc'), 'registry=https://registry.example/\n//registry.example/:_authToken=${TEST_TOKEN}\n');
    const opts = await loadApprovalOptions({ cwd: dir, env: { HOME: dir, TEST_TOKEN: 'SECRET', npm_config_userconfig: join(dir, 'userconfig'), npm_config_globalconfig: join(dir, 'globalconfig') } });
    assert.equal(opts.registry, options.registry);
    assert.equal(opts['//registry.example/:_authToken'], 'SECRET');
    assert.equal(opts.npmCommand, 'stage');
    const calls = [];
    const client = createApprovalClient(opts, { fetch: { json: async (url, request) => { calls.push(request); return { items: [], total: 0, version: '1.0.0' }; } } });
    await client.stagedItems(); await client.published('sdk', '1.0.0'); await client.approve(items[0], '123456');
    assert.ok(calls.every(c => c.registry === options.registry && c.npmSession === opts.npmSession && c['//registry.example/:_authToken'] === 'SECRET'));
    assert.equal(calls[2].otp, '123456');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('published treats only 404 as absent', async () => {
  for (const code of ['E404', 'E403', 'ETIMEDOUT']) {
    const client = createApprovalClient(options, { fetch: { json: async () => { throw failure(code); } } });
    if (code === 'E404') assert.equal(await client.published('sdk', '1.0.0'), false);
    else await assert.rejects(client.published('sdk', '1.0.0'), error => !error.message.includes('SECRET'));
  }
});

test('unsafe challenge URLs rejected before opening browser or official polling', async () => {
  const client = createApprovalClient(options, { webAuthOpener: () => assert.fail('must not authenticate') });
  for (const body of [
    { authUrl: 'https://npmjs.com/auth', doneUrl: 'https://evil.example/done' },
    { authUrl: 'javascript:alert(1)', doneUrl: 'https://registry.example/done' },
    { authUrl: 'https://npmjs.com/auth', doneUrl: 'http://registry.example/done' },
    { authUrl: 'https://npmjs.com/auth' },
  ]) await assert.rejects(client.authenticate({ body }, { openBrowser: () => assert.fail() }));
});

async function server(t, handler) {
  const srv = createServer(handler); srv.listen(0, '127.0.0.1'); await once(srv, 'listening');
  t.after(() => { srv.closeAllConnections(); srv.close(); });
  return `http://127.0.0.1:${srv.address().port}/`;
}

test('real official profile polls local server, returns OTP and shares auth context', async (t) => {
  const headers = []; let count = 0, opened = 0;
  const registry = await server(t, (req, res) => {
    headers.push(req.headers); res.setHeader('content-type', 'application/json');
    if (count++ === 0) { res.writeHead(202, { 'retry-after': '0.001' }); res.end('{}'); }
    else res.end(JSON.stringify({ token: 'SHARED_OTP' }));
  });
  const client = createApprovalClient({ registry, [`//${new URL(registry).host}/:_authToken`]: 'SECRET', npmSession: 'session', timeout: 1000 });
  const otp = await client.authenticate({ body: { authUrl: 'https://npmjs.com/auth', doneUrl: `${registry}done` } }, { openBrowser: async () => { opened++; }, timeoutMs: 1000 });
  assert.equal(otp, 'SHARED_OTP'); assert.equal(opened, 1);
  assert.ok(headers.every(h => h.authorization === 'Bearer SECRET' && h['npm-session'] === 'session'));
});

test('real doneUrl 403 and polling timeout stop safely', async (t) => {
  let mode = '403';
  const registry = await server(t, (req, res) => {
    res.setHeader('content-type', 'application/json');
    if (mode === '403') { res.writeHead(403); res.end('{"error":"SECRET"}'); }
    else { res.writeHead(202, { 'retry-after': '100' }); res.end('{}'); }
  });
  const client = createApprovalClient({ registry, timeout: 1000 });
  const authenticate = () => client.authenticate({ body: { authUrl: 'https://npmjs.com/auth', doneUrl: `${registry}done` } }, { openBrowser: async () => {}, timeoutMs: 50 });
  await assert.rejects(authenticate(), { code: 'E403' });
  mode = 'timeout';
  await assert.rejects(authenticate(), /超时/);
});

test('actual cross-origin redirect never reaches second server with token or OTP', async (t) => {
  let leaked = 0;
  const other = await server(t, (req, res) => { leaked++; res.end('{}'); });
  const registry = await server(t, (req, res) => { res.writeHead(307, { location: other }); res.end(); });
  const client = createApprovalClient({ registry, [`//${new URL(registry).host}/:_authToken`]: 'SECRET', timeout: 1000 });
  await assert.rejects(client.approve(items[0], 'SECRET_OTP'));
  assert.equal(leaked, 0);
});

test('entrypoint dry preview returns before approve and verify; no per-package fallback', () => {
  const source = readFileSync(new URL('../scripts/release.mjs', import.meta.url), 'utf8');
  const resume = source.slice(source.indexOf('async function approveStaged()'), source.indexOf('async function waitLive'));
  assert.match(resume, /if \(dryRun\).*return;/);
  assert.ok(resume.indexOf('if (dryRun)') < resume.indexOf('await approveAll'));
  assert.doesNotMatch(source, /approveWithNpm|registryAuth|npmHeaders|\['stage', 'approve'/);
});
