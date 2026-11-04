#!/usr/bin/env node
// 测试用 zleap-app 替身：按 STUB_STATE（JSON 文件）模拟平台，并把每次调用追加到 calls。
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const file = process.env.STUB_STATE;
const state = JSON.parse(readFileSync(file, 'utf8'));
const [command, ...rest] = process.argv.slice(2);
state.calls.push([command, ...rest].join(' '));
const save = () => writeFileSync(file, JSON.stringify(state, null, 2));
const out = (value) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
const fail = (message, code = 2) => {
  save();
  process.stderr.write(`${message}\n`);
  process.exit(code);
};

// 与服务端一致：manifest 的 appid 归一为 app_key
const manifest = () => {
  const m = JSON.parse(readFileSync(join(process.cwd(), rest[0] ?? '.', 'manifest.json'), 'utf8'));
  return { ...m, app_key: m.appid ?? m.app_key };
};
const digestOf = (m) => `sha256:${m.version}-${state.contentTag ?? 'v1'}`;

switch (command) {
  case 'check': {
    const m = manifest();
    out({ status: 'passed', schema: 'zleap.app/2', app_key: m.app_key, version: m.version, digest: digestOf(m), entry: 'index.html', bytes: 10, files: 3, runtime_test: 'not_checked' });
    break;
  }
  case 'status':
    if (!state.loggedIn) fail('请先在终端运行 zleap-app auth login，勿向MCP提供密码');
    out(state.packages);
    break;
  case 'publish': {
    if (!state.loggedIn) fail('请先在终端运行 zleap-app auth login，勿向MCP提供密码');
    const m = manifest();
    if (state.publishUnknown) {
      out({ request_id: 'publish-abc', status: 'unknown' });
      fail('COMMIT_UNKNOWN: 请查询原操作 publish-abc，不要重新生成制品重试', 6);
    }
    const versionId = state.nextVersionId++;
    const pkg = { id: versionId + 1000, app_id: 93, version_id: versionId, digest: digestOf(m).slice(7), visibility: 'private' };
    state.packages.push({ ...pkg, app_key: m.app_key, version: m.version });
    out({ request_id: 'publish-1', status: 'uploaded_private', result: { app_key: m.app_key, version: m.version, package: pkg } });
    break;
  }
  case 'diagnose':
    out({ app_id: '93', installed: state.installedVersion !== null, ...(state.installedVersion ? { version_id: String(state.installedVersion) } : {}), cloud_environments: state.cloudEnvironments ?? [{ environment_key: 'dev', status: 'active' }], cloud_allocation: [{ status: 'ready' }] });
    break;
  case 'install':
    state.installedVersion = state.packages.at(-1).version_id;
    out({ installed: true });
    break;
  case 'update': {
    if (state.migrationRequired) fail('平台错误 40900: DATA_MIGRATION_REQUIRED：数据结构变化需要显式迁移，未切换版本 detail=null');
    const target = rest[rest.indexOf('--version-id') + 1];
    state.installedVersion = Number(target);
    out({ version_id: target, status: 'active' });
    break;
  }
  case 'releases':
    out({ app_id: rest[0], items: [], publications: [] });
    break;
  case 'release': {
    if (state.releaseDatabaseNotReady) {
      out({ code: 40900, detail: { reason: 'PROD_DATABASE_NOT_READY' } });
      fail('平台错误 40900: 生产数据库还没就绪，暂时不能发布 detail={"reason":"PROD_DATABASE_NOT_READY"}');
    }
    const target = rest[rest.indexOf('--version-id') + 1];
    out({ app_id: rest[0], version_id: target, version: '1.0.0', unchanged: false });
    break;
  }
  case 'runtime-logs':
    out({ items: [], function_logs: { environment: rest[rest.indexOf('--environment') + 1] } });
    break;
  default:
    fail(`unexpected ${command}`);
}
save();
