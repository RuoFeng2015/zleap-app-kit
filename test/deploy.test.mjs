import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { scaffold } from '../packages/create-zleap-app/lib/scaffold.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const stub = join(root, 'test/fixtures/stub-zleap-app.mjs');
if (process.platform !== 'win32') chmodSync(stub, 0o755);

function project(initial = {}, appid = 'com.acme.todo') {
  const dir = join(mkdtempSync(join(tmpdir(), 'zleap-deploy-')), 'app');
  scaffold({
    templateDir: join(root, 'packages/create-zleap-app/templates/react-ts'),
    targetDir: dir,
    appid,
    name: '待办',
    packageName: 'app',
    cliPackage: '@zleap-ai/app-cli',
    cliVersion: '0.10.0',
    sdkPackage: '@zleap-ai/app-sdk',
  });
  // 用不依赖 Vite 的「构建」：把 manifest 复制进 dist/
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  pkg.scripts.build = `node -e "require('fs').mkdirSync('dist',{recursive:true});require('fs').copyFileSync('manifest.json','dist/manifest.json')"`;
  writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg, null, 2));
  const stateFile = join(dir, 'stub-state.json');
  writeFileSync(
    stateFile,
    JSON.stringify({ calls: [], loggedIn: true, packages: [], nextVersionId: 500, installedVersion: null, ...initial }),
  );
  const run = (command, ...args) =>
    spawnSync(process.execPath, ['scripts/zleap.mjs', command, ...args], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, ZLEAP_APP: stub, STUB_STATE: stateFile, npm_execpath: '' },
    });
  const deploy = (...args) => run('deploy', ...args);
  const state = () => JSON.parse(readFileSync(stateFile, 'utf8'));
  return { dir, deploy, run, state };
}

test('首次部署：构建 → 检查 → 上传 → 安装，并记录状态', () => {
  const { dir, deploy, state } = project();
  const result = deploy();
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.deepEqual(state().calls, ['check dist', 'status', 'publish dist', 'diagnose 93', 'install 93', 'diagnose 93', 'diagnose 93']);
  const saved = JSON.parse(readFileSync(join(dir, '.zleap/state.json'), 'utf8'));
  assert.equal(saved.appId, '93');
  assert.equal(saved.versionId, '500');
  assert.equal(saved.packageId, '1500');
  assert.match(result.stdout, /开发环境已创建，数据库已就绪/);
});

test('已安装旧版本：用 expected-version-id 切换到新版本', () => {
  const { deploy, state } = project({ installedVersion: 400 });
  const result = deploy();
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.ok(state().calls.includes('update 93 --expected-version-id 400 --version-id 500'));
  assert.equal(state().installedVersion, 500);
});

test('同版本号已上传过不同内容：自动递增补丁号并重新构建', () => {
  const { dir, deploy, state } = project({
    contentTag: 'v2',
    packages: [{ app_key: 'com.acme.todo', version: '1.0.0', digest: '1.0.0-v1', visibility: 'private', version_id: 400 }],
  });
  const result = deploy();
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')).version, '1.0.1');
  assert.equal(JSON.parse(readFileSync(join(dir, 'dist/manifest.json'), 'utf8')).version, '1.0.1');
  assert.ok(state().packages.some((row) => row.version === '1.0.1'));
});

test('同版本同内容：直接复用（上传幂等），不改版本号', () => {
  const { dir, deploy } = project({
    packages: [{ app_key: 'com.acme.todo', version: '1.0.0', digest: '1.0.0-v1', visibility: 'private', version_id: 400 }],
  });
  assert.equal(deploy().status, 0);
  assert.equal(JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')).version, '1.0.0');
});

test('未登录：提示 npm run login，不上传', () => {
  const { deploy, state } = project({ loggedIn: false });
  const result = deploy();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /npm run login/);
  assert.ok(!state().calls.includes('publish dist'));
});

test('上传结果未知：退出且给出查询原操作的命令，不重试', () => {
  const { deploy, state } = project({ publishUnknown: true });
  const result = deploy();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /COMMIT_UNKNOWN/);
  assert.match(result.stderr, /operation --request-id publish-abc/);
  assert.equal(state().calls.filter((call) => call.startsWith('publish')).length, 1);
});

test('数据声明变化：报 DATA_MIGRATION_REQUIRED 的处理建议，保留原版本', () => {
  const { deploy, state } = project({ installedVersion: 400, migrationRequired: true });
  const result = deploy();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /DATA_MIGRATION_REQUIRED/);
  assert.match(result.stderr, /新建集合/);
  assert.equal(state().installedVersion, 400);
});

test('--no-install 只上传', () => {
  const { dir, deploy, state } = project();
  assert.equal(deploy('--no-install').status, 0);
  assert.ok(!state().calls.some((call) => call.startsWith('install')));
  assert.ok(existsSync(join(dir, '.zleap/state.json')));
});

test('部署结束按诊断结果打印环境与数据库状态', () => {
  const { deploy } = project();
  const result = deploy();
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.match(result.stdout, /开发环境已创建，数据库已就绪/);
  assert.doesNotMatch(result.stdout, /创建开发环境/);
});

test('npm run logs 自动选应用所在环境，也可手动指定', () => {
  const dev = project();
  assert.equal(dev.deploy().status, 0);
  assert.equal(dev.run('logs').status, 0);
  assert.ok(dev.state().calls.includes('runtime-logs 93 --environment dev'));

  const prod = project({ cloudEnvironments: [{ environment_key: 'dev', status: 'active' }, { environment_key: 'prod', status: 'active' }] });
  assert.equal(prod.deploy().status, 0);
  assert.equal(prod.run('logs').status, 0);
  assert.ok(prod.state().calls.includes('runtime-logs 93 --environment prod'));
  assert.equal(prod.run('logs', '--environment', 'dev', '--invocation', '1750').status, 0);
  assert.ok(prod.state().calls.includes('runtime-logs 93 1750 --environment dev'));
});

test('开发环境还没建好时提示去控制台处理', () => {
  const { deploy } = project({ cloudEnvironments: [] });
  const result = deploy();
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.match(result.stdout, /开发环境未创建/);
  assert.match(result.stdout, /创建开发环境/);
});

test('npm run release：发布最近一次部署的版本（非交互需 --yes），旧应用拒绝', () => {
  const app = project({}, 'zl0123456789abcdef');
  assert.equal(app.deploy().status, 0);
  const unconfirmed = app.run('release', '--notes', '修复预订冲突');
  assert.equal(unconfirmed.status, 1);
  assert.match(unconfirmed.stderr, /--yes/);
  assert.ok(!app.state().calls.some((call) => call.startsWith('release')));
  const released = app.run('release', '--notes', '修复预订冲突', '--yes');
  assert.equal(released.status, 0, released.stderr + released.stdout);
  assert.ok(app.state().calls.includes('release 93 --version-id 500 --notes 修复预订冲突'));
  assert.match(released.stdout, /已发布/);
  assert.equal(app.run('release', '--version-id', '400', '--yes').status, 0);
  assert.ok(app.state().calls.includes('release 93 --version-id 400'));
  assert.equal(app.run('versions').status, 0);
  assert.ok(app.state().calls.includes('releases 93'));

  const legacy = project();
  assert.equal(legacy.deploy().status, 0);
  const refused = legacy.run('release', '--yes');
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /旧命名空间应用/);
});

test('npm run release：生产数据库还没就绪时给出处理办法', () => {
  const app = project({ releaseDatabaseNotReady: true }, 'zl0123456789abcdef');
  assert.equal(app.deploy().status, 0);
  const result = app.run('release', '--yes');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /稍后再 npm run release/);
});
