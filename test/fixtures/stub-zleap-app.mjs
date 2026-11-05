#!/usr/bin/env node
// 测试用 zleap-app 替身：按 STUB_STATE（JSON 文件）模拟平台，并把每次调用追加到 calls。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
  case 'auth': {
    // auth login [--create-app --name X]：新建应用时与 CLI 一致，把 appid 写回项目的 manifest。
    if (rest.includes('--create-app')) {
      const name = rest[rest.indexOf('--name') + 1];
      const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
      const dir = existsSync(join(process.cwd(), 'manifest.json')) ? '.' : (pkg.zleap?.packageDir ?? '.');
      const file = join(process.cwd(), dir, 'manifest.json');
      const m = JSON.parse(readFileSync(file, 'utf8'));
      writeFileSync(file, JSON.stringify({ ...m, appid: 'zl00000000000000dd' }, null, 2));
      state.createdApps = [...(state.createdApps ?? []), name];
      out({ status: 'authenticated', app_key: 'zl00000000000000dd', created_app: { appid: 'zl00000000000000dd', name } });
    } else {
      out({ status: 'authenticated', app_key: rest[rest.indexOf('--app-key') + 1] });
    }
    state.loggedIn = true;
    break;
  }
  case 'deploy': {
    if (state.noDeploy) fail('未知命令 deploy');
    // 与 zleap-app deploy 一致：相同摘要复用 → 上传 → 安装或切换 → 写 .zleap/state.json；失败输出 stage / next。
    if (!state.loggedIn) fail('尚未登录该部署，请先在终端运行 zleap-app auth login --target local，勿向MCP提供密码');
    const dir = rest[rest.indexOf('--package-dir') + 1] ?? '.';
    const m = JSON.parse(readFileSync(join(process.cwd(), dir, 'manifest.json'), 'utf8'));
    const key = m.appid ?? m.app_key;
    const digest = digestOf(m).slice(7);
    const result = { target: 'http://127.0.0.1:1', appid: key, version: m.version, completed_stages: ['check'], skipped_stages: [] };
    const stop = (stage, error, next, code = 2) => {
      out({ ...result, status: code === 6 ? 'unknown' : 'failed', stage, error, next });
      fail(error, code);
    };
    let pkg = state.packages.find((row) => row.digest === digest);
    if (!pkg) {
      if (state.publishUnknown) stop('publish', 'COMMIT_UNKNOWN: 请查询原操作 publish-abc', '上传结果未确认；重新执行 zleap-app deploy 会先按原操作号核对，不会重复上传', 6);
      const versionId = state.nextVersionId++;
      pkg = { id: versionId + 1000, app_id: 93, version_id: versionId, digest, visibility: 'private', app_key: key, version: m.version };
      state.packages.push(pkg);
      result.completed_stages.push('publish');
      if (state.autoSign) result.auto_sign = state.autoSign;
    }
    Object.assign(result, { app_id: '93', version_id: String(pkg.version_id), package_id: String(pkg.id) });
    const record = { appId: '93', versionId: String(pkg.version_id), packageId: String(pkg.id), version: m.version };
    mkdirSync(join(process.cwd(), '.zleap'), { recursive: true });
    const writeState = () => writeFileSync(join(process.cwd(), '.zleap/state.json'), JSON.stringify({ ...record, targets: {} }, null, 2));
    if (rest.includes('--no-install')) {
      writeState();
      out({ ...result, status: 'succeeded' });
      break;
    }
    if (state.installedVersion === null) {
      state.installedVersion = pkg.version_id;
      result.completed_stages.push('install');
    } else if (state.installedVersion !== pkg.version_id) {
      if (state.migrationRequired) stop('install', '平台错误 40900: DATA_MIGRATION_REQUIRED：数据结构变化需要显式迁移，未切换版本', '数据集合或 Schema 有变化，deploy 不会替你迁移：要改字段结构请新建集合并迁移数据');
      state.calls.push(`update 93 --expected-version-id ${state.installedVersion} --version-id ${pkg.version_id}`);
      state.installedVersion = pkg.version_id;
      result.completed_stages.push('update');
    }
    writeState();
    result.diagnosis = { app_id: '93', installed: true, version_id: String(state.installedVersion), cloud_environments: state.cloudEnvironments ?? [{ environment_key: 'dev', status: 'active' }], cloud_allocation: [{ status: 'ready' }] };
    out({ ...result, status: 'succeeded' });
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
