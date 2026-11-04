#!/usr/bin/env node
// 项目内的一键命令，封装 zleap-app CLI：
//
//   npm run login  [-- --target https://os.example.com]   浏览器授权，保存开发会话（自动续期，最长 30 天）
//   npm run deploy [-- --no-build] [--no-install]          构建 → 检查 → 上传开发版本 → 安装/切换到新版本
//   npm run status                                        查看本应用的安装、权限与可用版本
//   npm run versions                                      列出全部成员上传的开发版本、当前线上版本和发布记录
//   npm run release [-- --version-id <id>] [--notes 说明] [--yes]
//                                                         把开发版本（默认最近一次 deploy 的）发布为线上版本；回退 = 发布旧版本
//   npm run logs   [-- --environment dev|prod] [--invocation <调用编号>]
//                                                         查看最近 24 小时应用页面上报的错误与本人云函数日志
//
// 设计约束（与平台一致）：结果未知（COMMIT_UNKNOWN）时不自动重试；不替你做数据迁移；不碰生产环境。
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const stateDir = join(root, '.zleap'); // zleap-app pack 会排除 .zleap/，且已写入 .gitignore
const configFile = join(stateDir, 'config.json');
const stateFile = join(stateDir, 'state.json');
const manifestFile = join(root, 'manifest.json');

const argv = process.argv.slice(2);
const command = argv[0];
const option = (name) => {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? undefined : argv[index + 1];
};
const has = (name) => argv.includes(`--${name}`);

class StepError extends Error {}

function readJSON(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJSON(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function cliCommand() {
  const override = process.env.ZLEAP_APP;
  if (override && /\.[cm]?js$/.test(override)) return { file: process.execPath, prefix: [override], shell: false };
  if (override) return { file: override, prefix: [], shell: false };
  const bin = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'zleap-app.cmd' : 'zleap-app');
  if (!existsSync(bin)) throw new StepError('没有找到 zleap-app，请先安装依赖（npm install）。');
  return { file: bin, prefix: [], shell: process.platform === 'win32' };
}

/** 调用 zleap-app。capture=true 时解析 stdout 中的 JSON。 */
function cli(args, { capture = true } = {}) {
  const { file, prefix, shell } = cliCommand();
  const result = spawnSync(file, [...prefix, ...args], {
    cwd: root,
    shell,
    encoding: 'utf8',
    stdio: capture ? ['inherit', 'pipe', 'pipe'] : 'inherit',
  });
  if (result.error) throw new StepError(`无法运行 zleap-app：${result.error.message}`);
  // 被信号杀掉时 status 为 null、没有任何输出（例如 macOS 拒绝运行签名缓存不一致的二进制会发 SIGKILL）。
  if (result.signal) throw new StepError(`zleap-app 被系统终止（${result.signal}）。macOS 上多为二进制被原地替换导致：删除 node_modules 后重新 npm install`);
  let json;
  if (capture && result.stdout) {
    try {
      json = JSON.parse(result.stdout);
    } catch {
      json = undefined;
    }
  }
  return { code: result.status ?? 1, json, stdout: result.stdout ?? '', stderr: (result.stderr ?? '').trim() };
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) throw new StepError(`${command} ${args.join(' ')} 失败`);
}

function npmRun(script) {
  const npm = process.env.npm_execpath;
  if (npm && npm.endsWith('.js')) run(process.execPath, [npm, 'run', script]);
  else run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', script]);
}

const paint = (code, mark, stream = process.stdout) => (stream.isTTY ? `\x1b[${code}m${mark}\x1b[0m` : mark);
const log = (text) => console.log(`${paint(36, '▸')} ${text}`);
const ok = (text) => console.log(`${paint(32, '✔')} ${text}`);
const warn = (text) => console.log(`${paint(33, '!')} ${text}`);

function needLogin(stderr) {
  return /auth login|开发会话已过期|目标与已登录开发会话不一致|仅授权应用/.test(stderr);
}

function manifest() {
  const value = readJSON(manifestFile);
  // appid 由平台生成（云开发控制台「创建应用」）；旧项目写的是 app_key，同样可用
  if (!value?.appid && !value?.app_key)
    throw new StepError('manifest.json 缺少 appid：先在 zleapOS 云开发控制台「创建应用」，把 appid 填进 manifest.json');
  return value;
}

const appIdOf = (value) => value.appid ?? value.app_key;

function bumpPatch(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(.*)$/.exec(version);
  if (!match) throw new StepError(`无法自动递增版本号「${version}」，请手动修改 manifest.json 的 version`);
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

const stripDigest = (value) => String(value ?? '').replace(/^sha256:/, '');
const id = (value) => (value === undefined || value === null ? '' : String(value));

async function ask(question, fallback) {
  if (!process.stdin.isTTY) return fallback;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(question)).trim();
    return answer || fallback;
  } finally {
    rl.close();
  }
}

async function login() {
  const config = readJSON(configFile, {});
  let target = option('target') || process.env.ZLEAP_TARGET || config.target;
  if (!target) target = await ask('zleapOS 地址（例如 https://os.example.com）：', '');
  if (!target) throw new StepError('请提供 OS 地址：npm run login -- --target https://os.example.com');
  const appKey = appIdOf(manifest());
  log(`登录 ${target}（应用 ${appKey}）。浏览器打开后，核对页面与终端里的确认码一致再允许。`);
  const args = ['auth', 'login', '--target', target, '--app-key', appKey];
  if (has('no-browser')) args.push('--no-browser');
  const result = cli(args, { capture: false });
  if (result.code !== 0) throw new StepError('登录未完成');
  writeJSON(configFile, { ...config, target });
  ok('已登录：访问凭据自动续期，授权最长 30 天（到期或 auth logout 后重新登录）');
}

function publishedVersions() {
  const result = cli(['status']);
  if (result.code !== 0) {
    if (needLogin(result.stderr)) throw new StepError(`${result.stderr}\n先运行 npm run login`);
    throw new StepError(`读取已上传版本失败：${result.stderr}`);
  }
  return Array.isArray(result.json) ? result.json : [];
}

function checkDist() {
  const result = cli(['check', 'dist']);
  if (result.code !== 0 || result.json?.status !== 'passed') {
    throw new StepError(`本地检查未通过：${result.stderr || result.stdout}`);
  }
  return result.json;
}

/** 生成的项目用 Vite 7（Node.js 20.19+ / 22.12+）；旧 Node 上构建会报难懂的语法错误，先说清楚。 */
function requireSupportedNode() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major > 22 || (major === 22 && minor >= 12) || (major === 20 && minor >= 19)) return;
  throw new StepError(
    `当前 Node.js ${process.versions.node} 无法构建本项目（需要 20.19+ 或 22.12+）。请升级 Node.js（例如 nvm install 22）后重试。`,
  );
}

async function deploy() {
  requireSupportedNode();
  const build = () => {
    if (has('no-build')) return;
    log('构建 dist/');
    npmRun('build');
  };

  build();
  let report = checkDist();
  ok(`检查通过：${report.app_key} v${report.version}（${report.files} 个文件，runtime_test=${report.runtime_test}）`);

  // 同一版本号只能对应一份内容；内容变了就自动递增补丁号。
  const existing = publishedVersions().find((row) => row.app_key === report.app_key && row.version === report.version);
  if (existing && (stripDigest(existing.digest) !== stripDigest(report.digest) || !['private', 'members'].includes(existing.visibility))) {
    if (has('no-build')) throw new StepError(`版本 ${report.version} 已上传过不同内容，请修改 version 后重新构建`);
    const current = manifest();
    const next = bumpPatch(current.version);
    warn(`版本 ${current.version} 已上传过不同内容，自动递增为 ${next}`);
    writeJSON(manifestFile, { ...current, version: next });
    build();
    report = checkDist();
  }

  // appid 应用的上传是只有应用成员可见的开发版本；旧 app_key 应用是本人 private。都不会直接给全企业用。
  log('上传开发版本');
  const published = cli(['publish', 'dist']);
  if (published.code === 6) {
    const requestId = published.json?.request_id;
    throw new StepError(
      `上传结果未知（COMMIT_UNKNOWN）。不要重新上传，先查询原操作：\n  npx zleap-app operation --request-id ${requestId ?? '<request_id>'}`,
    );
  }
  if (published.code !== 0) {
    if (needLogin(published.stderr)) throw new StepError(`${published.stderr}\n先运行 npm run login`);
    throw new StepError(`上传被拒绝：${published.stderr}`);
  }
  const pack = published.json?.result?.package ?? {};
  const appId = id(pack.app_id);
  const versionId = id(pack.version_id);
  const packageId = id(pack.id);
  if (!appId || !versionId) throw new StepError(`上传回执缺少 app_id / version_id：${published.stdout}`);
  ok(`已上传 v${report.version}：app_id=${appId} version_id=${versionId} package_id=${packageId}`);
  writeJSON(stateFile, { appId, versionId, packageId, version: report.version, digest: report.digest, at: new Date().toISOString() });

  if (has('no-install')) return finish(appId, false);

  let diagnosis = cli(['diagnose', appId]);
  if (diagnosis.code !== 0) throw new StepError(`读取安装状态失败：${diagnosis.stderr}`);
  if (!diagnosis.json?.installed) {
    log('安装给自己');
    const installed = cli(['install', appId]);
    if (installed.code !== 0) throw new StepError(`安装失败：${installed.stderr}`);
    diagnosis = cli(['diagnose', appId]);
  }
  const current = id(diagnosis.json?.version_id);
  if (current && current !== versionId) {
    log(`把本人安装从 version_id=${current} 切换到 ${versionId}`);
    const updated = cli(['update', appId, '--expected-version-id', current, '--version-id', versionId]);
    if (updated.code !== 0) {
      if (/DATA_MIGRATION_REQUIRED/.test(updated.stderr)) {
        throw new StepError(
          '新版本改动了 data / storage 声明，平台拒绝直接切换（DATA_MIGRATION_REQUIRED），当前安装保持原版本。\n' +
            '注意：已建好的集合结构不会随新版本改变。开发阶段可以 npx zleap-app uninstall <app_id> 后再 npm run deploy（卸载保留数据）；\n' +
            '要改字段结构请新建集合并自行迁移数据。',
        );
      }
      if (updated.code === 6) throw new StepError(`切换结果未知，先运行 npm run status 核对，不要重复切换。`);
      throw new StepError(`切换版本失败：${updated.stderr}`);
    }
  }
  ok(`本人安装已是 v${report.version}`);
  finish(appId, true, cli(['diagnose', appId]).json);
}

/** 安装时平台会自动创建开发环境并开通数据库；这里按真实状态提示，而不是一律让用户去控制台创建。 */
function cloudStatus(diagnosis) {
  if (!diagnosis) return null;
  const envs = Array.isArray(diagnosis.cloud_environments) ? diagnosis.cloud_environments : [];
  const allocation = Array.isArray(diagnosis.cloud_allocation) ? diagnosis.cloud_allocation[0]?.status : undefined;
  const keys = envs.filter((env) => env?.status === 'active').map((env) => env.environment_key);
  return { dev: keys.includes('dev'), prod: keys.includes('prod'), databaseReady: allocation === 'ready' };
}

function finish(appId, installed, diagnosis = null) {
  const state = readJSON(stateFile, {});
  writeJSON(stateFile, { ...state, appId });
  const cloud = cloudStatus(diagnosis);
  if (cloud) {
    const parts = [`开发环境${cloud.dev ? '已创建' : '未创建'}`, `数据库${cloud.databaseReady ? '已就绪' : '未就绪'}`];
    if (cloud.prod) parts.push('已有生产环境（应用默认运行在生产数据域）');
    (cloud.dev && cloud.databaseReady ? ok : warn)(parts.join('，'));
  }
  // 步骤按实际出现的条目连续编号：有的步骤视情况省略，写死序号会出现「1、3」。
  const steps = [];
  if (installed) steps.push('从 zleapOS 启动台打开应用（已打开的窗口点「重新加载应用」）。');
  if (hasBackgroundCapabilities(readJSON(manifestFile, {})) && diagnosis?.resource_preparation_required) {
    steps.push(
      `有云函数 / 后台能力：npx zleap-app prepare ${appId} --version-id ${readJSON(stateFile, {}).versionId ?? '<version_id>'} 补做开发环境准备（平台上传时通常已自动签名并绑定，只有自动签名失败时才会走到这一步），再在应用窗口「权限」里允许后台能力。`,
    );
  }
  if (!cloud || !cloud.dev || !cloud.databaseReady) {
    steps.push('开发环境或数据库还没就绪：打开「云开发控制台」选中本应用 → 概览，按提示「创建开发环境」/ 等数据库「已就绪」。');
  }
  steps.push('出问题：npm run status 看安装与权限，npm run logs 看页面错误，控制台「运行体检」逐层排查。');
  const manifestValue = readJSON(manifestFile, {});
  if (/^zl[0-9a-f]{16}$/.test(manifestValue?.appid ?? manifestValue?.app_key ?? '')) {
    steps.push('给同事用：npm run release -- --notes "本次更新说明"（或在「云开发控制台」→ 版本管理里「发布为线上版本」）。全企业可见，正在用的人不受打扰。');
    steps.push('一起开发：控制台「成员」里把同事加为开发者；他们上传的版本也会出现在版本管理里。');
  } else {
    steps.push('上生产 / 云函数 / 分享给同事：见 skill zleap-cloud-app-release，或 npx zleap-app prepare <app_id> --version-id <id>。');
  }
  console.log('\n下一步：');
  steps.forEach((text, index) => console.log(`  ${index + 1}. ${text}`));
  console.log(`  （app_id=${appId}，状态记录在 .zleap/state.json）`);
}

/** manifest 里声明了 headless 后台能力（云函数等）。 */
function hasBackgroundCapabilities(value) {
  const provides = value?.runtime?.capabilities?.provides;
  return Array.isArray(provides) && provides.some((item) => item?.execution === 'headless');
}

function currentAppId() {
  const appId = option('app-id') || readJSON(stateFile, {}).appId;
  if (!appId) throw new StepError('还没有部署记录，先运行 npm run deploy（或用 --app-id 指定）');
  return appId;
}

/** 日志查的环境要和应用实际所在的数据域一致：应用有生产环境时发布者走 prod，否则走 dev。 */
function logs() {
  const appId = currentAppId();
  let environment = option('environment');
  if (!environment) {
    const cloud = cloudStatus(cli(['diagnose', appId]).json);
    environment = cloud?.prod ? 'prod' : 'dev';
    log(`查看 ${environment} 环境（可用 -- --environment dev|prod 指定）`);
  }
  const args = ['runtime-logs', appId];
  if (option('invocation')) args.push(option('invocation'));
  passthrough([...args, '--environment', environment]);
}

/** 平台 appid 应用的线上版本列表。 */
function versions() {
  passthrough(['releases', currentAppId()]);
}

/** 发布为线上版本：影响全企业使用者，交互终端里先确认；非交互必须带 --yes。 */
async function release() {
  const appId = currentAppId();
  const appid = appIdOf(manifest());
  if (!/^zl[0-9a-f]{16}$/.test(appid)) {
    throw new StepError('旧命名空间应用没有线上版本；新应用请先在云开发控制台「创建应用」拿到 appid。');
  }
  const state = readJSON(stateFile, {});
  const versionId = option('version-id') || state.versionId;
  if (!versionId) throw new StepError('不知道要发布哪个版本：先 npm run deploy，或用 --version-id 指定（npm run versions 查看）');
  const label = option('version-id') ? `version_id=${versionId}` : `v${state.version}（version_id=${versionId}）`;
  if (!has('yes')) {
    if (!process.stdin.isTTY) throw new StepError('发布会让全企业的使用者用上这个版本；非交互运行请加 --yes 确认');
    const answer = await ask(`把 ${label} 发布为线上版本？全企业可见，使用者下次打开自动更新。[y/N] `, 'n');
    if (!/^y(es)?$/i.test(answer)) {
      warn('已取消');
      return;
    }
  }
  const args = ['release', appId, '--version-id', versionId];
  if (option('notes')) args.push('--notes', option('notes'));
  log(`发布 ${label}`);
  const result = cli(args);
  if (result.code !== 0) {
    if (needLogin(result.stderr)) throw new StepError(`${result.stderr}\n先运行 npm run login`);
    const output = result.stderr + result.stdout;
    if (/PROD_DATABASE_NOT_READY/.test(output)) {
      throw new StepError('生产数据库还没就绪，暂时不能发布：通常 1 分钟内就绪，稍后再 npm run release；持续失败请在云开发控制台「数据库」查看状态。');
    }
    if (/UPLOADER_INACTIVE/.test(output)) {
      throw new StepError('这个版本的上传者账号已停用，无法发布：重新 npm run deploy 上传一个版本，再发布。');
    }
    if (/UPLOADER_NOT_ON_VERSION/.test(output)) {
      // 旧版平台才会返回：新平台任一成员都能发布任一版本
      throw new StepError('当前平台版本要求上传者正在使用这个版本：上传者先 npm run deploy（会自动切换），再发布。');
    }
    throw new StepError(`发布失败：${result.stderr || result.stdout}`);
  }
  const out = result.json ?? {};
  if (out.unchanged) ok(`${label} 已经是线上版本`);
  else ok(`已发布：线上版本为 v${out.version ?? state.version}。使用者下次打开自动更新，正在用的窗口会收到更新提示（24 小时后自动切换）。`);
}

function passthrough(args) {
  const result = cli(args, { capture: false });
  if (result.code !== 0) process.exitCode = result.code;
}

async function main() {
  switch (command) {
    case 'login':
      return login();
    case 'deploy':
      return deploy();
    case 'status':
      return passthrough(['diagnose', currentAppId()]);
    case 'logs':
      return logs();
    case 'versions':
      return versions();
    case 'release':
      return release();
    default:
      console.log('用法：node scripts/zleap.mjs <login|deploy|status|logs|versions|release>');
      process.exitCode = 1;
  }
}

main().catch((error) => {
  if (error instanceof StepError) {
    console.error(`${paint(31, '✖', process.stderr)} ${error.message}`);
    process.exitCode = 1;
    return;
  }
  throw error;
});
