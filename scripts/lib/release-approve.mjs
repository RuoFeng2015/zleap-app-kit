// Official npm APIs; importing this module does not load configuration or contact a registry.
import Config from '@npmcli/config';
import npmAgent from '@npmcli/agent';
import definitionsModule from '@npmcli/config/lib/definitions/index.js';
import registryFetch from 'npm-registry-fetch';
import profile from 'npm-profile';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

const { definitions, shorthands, flatten } = definitionsModule;
const require = createRequire(import.meta.url);

export class ApprovalError extends Error {}

// Never include upstream messages, bodies, URLs, options or causes: they may contain credentials.
export function safeFailure(error) {
  const codes = new Set(['EOTP', 'E401', 'E403', 'E404', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'ABORT_ERR']);
  return codes.has(error?.code) ? error.code : '请求失败或结果未知';
}

export async function loadApprovalOptions({ cwd, env = process.env, argv = [], ...overrides } = {}) {
  try {
    const conf = new Config({ definitions, shorthands, flatten,
      npmPath: dirname(require.resolve('@npmcli/config/package.json')), cwd, env, argv, ...overrides });
    await conf.load();
    conf.validate();
    return { ...conf.flat, registry: conf.get('registry'), npmCommand: 'stage',
      npmSession: randomBytes(8).toString('hex'), retry: { retries: 0 },
      timeout: 30_000, redirect: 'error' };
  } catch {
    throw new ApprovalError('无法加载 npm 配置（为保护凭据，不显示原始错误）。');
  }
}

export function createApprovalClient(options, { fetch = registryFetch, webAuthOpener = profile.webAuthOpener } = {}) {
  const opts = { ...options, retry: { retries: 0 }, redirect: 'error' };
  const registry = new URL(opts.registry);
  if (!['https:', 'http:'].includes(registry.protocol) || registry.username || registry.password) {
    throw new ApprovalError('无效的 registry URL');
  }
  // Fetch v17 forwards agent, but not redirect/signal. The callback runs before
  // every request (including redirects), preventing cross-origin credential leaks.
  const guardedAgent = (signal) => (url) => {
    if (signal?.aborted || new URL(url.href).origin !== registry.origin) {
      throw new ApprovalError('Request cancelled or cross-origin redirect blocked');
    }
    return npmAgent.getAgent(url, { ...opts, agent: undefined });
  };
  opts.agent = guardedAgent();
  return {
    async stagedItems() {
      try {
        const items = [];
        for (let page = 0; ; page++) {
          const result = await fetch.json('/-/stage', { ...opts, query: { page, perPage: 100 } });
          items.push(...result.items);
          if (items.length >= result.total || result.items.length < 100) return items;
        }
      } catch (error) { throw new ApprovalError(`读取暂存区失败：${safeFailure(error)}`); }
    },
    async published(name, version) {
      try {
        const result = await fetch.json(`/${encodeURIComponent(name)}/${encodeURIComponent(version)}`, { ...opts, cache: false });
        return result.version === version;
      } catch (error) {
        if (error.code === 'E404') return false;
        throw new ApprovalError(`查询已发布版本失败：${safeFailure(error)}`);
      }
    },
    approve(item, otp) {
      if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(item.id)) throw new ApprovalError('无效的暂存 ID');
      return fetch.json(`/-/stage/${item.id}/approve`, { ...opts, method: 'POST', otp });
    },
    async authenticate(error, { openBrowser, promptOtp, timeoutMs = 300_000 }) {
      const { authUrl, doneUrl } = error.body ?? {};
      if (authUrl || doneUrl) {
        // npm-registry-fetch can reuse registry auth for same-host URLs. Require exact origin,
        // and refuse redirects, so challenges cannot exfiltrate either auth or OTP.
        let auth, done;
        try { auth = new URL(authUrl); done = new URL(doneUrl); } catch { throw new ApprovalError('无效的验证 URL'); }
        if (auth.protocol !== 'https:' || auth.username || auth.password || done.username || done.password || done.origin !== registry.origin) {
          throw new ApprovalError('拒绝不安全或跨域的验证 URL');
        }
        const controller = new AbortController();
        let timer;
        try {
          const result = await webAuthOpener(async (url, { signal }) => {
            await openBrowser(url);
            // Keeping the opener pending lets npm-profile abort its own polling sleep on timeout.
            await new Promise((resolve, reject) => {
              if (signal.aborted) return resolve();
              signal.addEventListener('abort', resolve, { once: true });
              timer = setTimeout(() => { controller.abort(); reject(new ApprovalError('浏览器验证超时')); }, timeoutMs);
            });
          }, auth.href, done.href, { ...opts, otp: undefined, agent: guardedAgent(controller.signal), timeout: Math.min(opts.timeout || 30_000, timeoutMs) });
          if (typeof result?.token !== 'string' || !result.token) throw new ApprovalError('验证没有返回 OTP');
          return result.token;
        } finally { clearTimeout(timer); controller.abort(); }
      }
      const otp = await promptOtp();
      if (!/^\d{6}$/.test(otp)) throw new ApprovalError('验证码无效或已取消');
      return otp;
    },
  };
}

// maxAuthentications 是每个包的上限：web 2FA 的口令是一次性的，服务端通常每个包都要重新验证一次。
export async function approveBatch(items, { client, dryRun = false, authenticate, log = () => {}, wait = sleep, validationAttempts = 120, maxAuthentications = 2 } = {}) {
  if (dryRun || items.length === 0) return { approved: [], unattempted: items };
  const approved = [];
  let current;
  let otp;
  try {
    let ready = false;
    for (let attempt = 0; attempt < validationAttempts; attempt++) {
      const staged = await client.stagedItems();
      const validating = staged.filter((item) => items.some((own) => own.id === item.id) && item.status === 'validating');
      if (validating.length === 0) { ready = true; break; }
      // 校验可能要几分钟，期间必须有输出，否则看起来像卡死。
      if (attempt % 6 === 0) log(`等待 npm 校验暂存包（还有 ${validating.length} 个校验中，已等 ${attempt * 5} 秒）…`);
      if (attempt + 1 < validationAttempts) await wait(5000);
    }
    if (!ready) throw new ApprovalError('暂存校验等待超时，未批准任何包');
    for (const item of items) {
      current = item;
      let authentications = 0;
      for (;;) {
        try { await client.approve(item, otp); break; }
        catch (error) {
          if (error.code !== 'EOTP') throw error;
          // 带着用过的一次性口令被拒时，响应里没有浏览器验证地址（会误落到 6 位验证码输入）。
          // 去掉旧口令重发一次，拿到新的浏览器质询。
          if (otp && !error.body?.authUrl) { otp = undefined; continue; }
          if (authentications >= maxAuthentications) throw error;
          authentications++;
          log(`需要 2FA 验证：${item.name}@${item.version}`);
          otp = await authenticate(error);
          if (typeof otp !== 'string' || !otp) throw new ApprovalError('验证已取消');
        }
      }
      approved.push(item);
      log(`已批准：${item.name}@${item.version}`);
      current = undefined;
    }
    return { approved, unattempted: [] };
  } catch (error) {
    const unattempted = items.filter((item) => !approved.includes(item) && item !== current);
    const label = (list) => list.map((item) => `${item.name}@${item.version}`).join('、') || '无';
    const message = `批准批次停止：${error instanceof ApprovalError ? error.message : safeFailure(error)}\n已成功：${label(approved)}\n失败/结果未知：${label(current ? [current] : [])}\n尚未尝试：${label(unattempted)}\n请用 npm run release:approve 重新查询后续跑；不会逐包降级授权。`;
    throw new ApprovalError(message);
  } finally { otp = undefined; }
}
