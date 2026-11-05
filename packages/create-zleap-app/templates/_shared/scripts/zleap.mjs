#!/usr/bin/env node
// 项目内的一键命令，封装 zleap-app CLI：
//
//   npm run login  [-- --target https://os.example.com]   浏览器授权，保存开发会话（自动续期，最长 30 天）
//   npm run deploy [-- --no-build] [--no-install]          构建 → 检查 → zleap-app deploy（上传开发版本 → 安装/切换 → 按诊断准备资源）
//   npm run status                                        查看本应用的安装、权限与可用版本
//   npm run versions                                      列出全部成员上传的开发版本、当前线上版本和发布记录
//   npm run release [-- --version-id <id>] [--notes 说明] [--yes]
//                                                         把开发版本（默认最近一次 deploy 的）发布为线上版本；回退 = 发布旧版本
//   npm run logs   [-- --environment dev|prod] [--invocation <调用编号>]
//                                                         查看最近 24 小时应用页面上报的错误与本人云函数日志
//   node scripts/zleap.mjs sdk                            vanilla 模板：把 Cloud SDK 从 node_modules 复制进应用目录
//
// 设计约束（与平台一致）：结果未知（COMMIT_UNKNOWN）时不自动重试；不替你做数据迁移；不碰生产环境。
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const stateDir = join(root, '.zleap'); // zleap-app pack 会排除 .zleap/，且已写入 .gitignore
const configFile = join(stateDir, 'config.json');
const stateFile = join(stateDir, 'state.json'); // 由 zleap-app deploy 写入，本脚本只读
// 项目形态写在 package.json 的 zleap 字段：packageDir 是上传的目录，build=false 表示不用构建（vanilla 模板），
// sdkDir 是要从 node_modules 复制 Cloud SDK 的目录。React 模板缺省为 dist/ + 构建。
const project = { packageDir: 'dist', build: true, sdkDir: '', ...(readJSON(join(root, 'package.json'), {}).zleap ?? {}) };
const packageDir = project.packageDir;
// 构建型项目的 manifest 在项目根目录（构建时复制进产物）；不构建的项目 manifest 就在上传目录里。
const manifestFile = existsSync(join(root, 'manifest.json')) ? join(root, 'manifest.json') : join(root, packageDir, 'manifest.json');

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

/** 调用 zleap-app。capture=true 时解析 stdout 中的 JSON；liveStderr=true 时进度（如授权链接）直接显示在终端。 */
function cli(args, { capture = true, liveStderr = false } = {}) {
  const { file, prefix, shell } = cliCommand();
  const result = spawnSync(file, [...prefix, ...args], {
    cwd: root,
    shell,
    encoding: 'utf8',
    stdio: capture ? ['inherit', 'pipe', liveStderr ? 'inherit' : 'pipe'] : 'inherit',
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
  // appid 由平台生成：npm run login 时自动新建，或在云开发控制台「创建应用」后填入；旧项目写的是 app_key，同样可用
  if (!value?.appid && !value?.app_key)
    throw new StepError('manifest.json 还没有 appid：先运行 npm run login（会在授权时自动新建应用），或把云开发控制台里应用的 appid 填进 manifest.json');
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
  const value = readJSON(manifestFile, {});
  const appKey = appIdOf(value);
  let args;
  if (appKey) {
    log(`登录 ${target}（应用 ${appKey}）。浏览器打开后，核对页面与终端里的确认码一致再允许。`);
    args = ['auth', 'login', '--target', target, '--app-key', appKey];
  } else {
    // 还没有 appid：在同一次授权里新建应用（本人为管理员，一次授权最多建一个），CLI 把 appid 写回 manifest.json。
    if (!value?.name) throw new StepError('manifest.json 缺少 name，无法新建应用');
    log(`登录 ${target} 并新建应用「${value.name}」。浏览器打开后，核对确认码一致再允许。`);
    args = ['auth', 'login', '--target', target, '--create-app', '--name', value.name];
  }
  if (has('no-browser')) args.push('--no-browser');
  writeJSON(configFile, { ...config, target });
  // 新建应用时要拿到 stdout 里的 appid，授权链接和确认码仍实时显示。
  const result = cli(args, { capture: !appKey, liveStderr: true });
  if (result.code !== 0) {
    throw new StepError(
      appKey ? '登录未完成' : '登录未完成：如果上面提示该部署不支持登录时新建应用，请在云开发控制台「创建应用」，把 appid 填进 manifest.json 后重新 npm run login',
    );
  }
  if (!appKey) ok(`已新建应用：appid=${result.json?.app_key ?? appIdOf(readJSON(manifestFile, {}))}（已写入 manifest.json）`);
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

/** vanilla 模板：把 npm 包里的 Cloud SDK 复制到应用目录，页面用 import { zl } from './sdk/index.js'。 */
function syncSdk() {
  if (!project.sdkDir) return;
  const from = join(root, 'node_modules', '@zleap-ai', 'app-sdk', 'dist');
  if (!existsSync(join(from, 'index.js'))) throw new StepError('没有找到 @zleap-ai/app-sdk，请先安装依赖（npm install）。');
  mkdirSync(join(root, project.sdkDir), { recursive: true });
  for (const file of ['index.js', 'host.js', 'workspace.js']) {
    if (existsSync(join(from, file))) copyFileSync(join(from, file), join(root, project.sdkDir, file));
  }
}

function checkDist() {
  const result = cli(['check', packageDir]);
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
  manifest(); // 还没有 appid 时先说清楚：npm run login 会新建应用
  if (project.build) requireSupportedNode();
  const build = () => {
    syncSdk();
    if (!project.build || has('no-build')) return;
    log(`构建 ${packageDir}/`);
    npmRun('build');
  };

  build();
  let report = checkDist();
  ok(`检查通过：${report.app_key} v${report.version}（${report.files} 个文件，runtime_test=${report.runtime_test}）`);

  // 同一版本号只能对应一份内容；内容变了就自动递增补丁号（构建型项目要重新构建，所以在这里做）。
  const existing = publishedVersions().find((row) => row.app_key === report.app_key && row.version === report.version);
  if (existing && (stripDigest(existing.digest) !== stripDigest(report.digest) || !['private', 'members'].includes(existing.visibility))) {
    if (project.build && has('no-build')) throw new StepError(`版本 ${report.version} 已上传过不同内容，请修改 version 后重新构建`);
    const current = manifest();
    const next = bumpPatch(current.version);
    warn(`版本 ${current.version} 已上传过不同内容，自动递增为 ${next}`);
    writeJSON(manifestFile, { ...current, version: next });
    build();
    report = checkDist();
  }

  // 上传、安装 / 切换本人安装、按诊断准备资源都交给 zleap-app deploy：每步先查平台事实，重复执行安全，
  // 部署记录写在 .zleap/state.json。appid 应用的上传是只有成员可见的开发版本，不会直接给全企业用。
  log('上传开发版本并装到本人');
  const args = ['deploy', '.', '--package-dir', packageDir];
  if (has('no-install')) args.push('--no-install');
  const result = cli(args);
  const out = result.json ?? {};
  if (result.code !== 0) {
    if (/未知命令 deploy/.test(result.stderr)) {
      throw new StepError(`当前 zleap-app 版本太旧，不支持 deploy：npm i -D ${'@zleap-ai/app-cli'}@latest @zleap-ai/app-sdk@latest`);
    }
    if (needLogin(result.stderr)) throw new StepError(`${result.stderr}\n先运行 npm run login`);
    if (result.code === 6 || out.status === 'unknown') {
      throw new StepError(`${out.stage ?? '部署'}结果未知（COMMIT_UNKNOWN）：不要手动重复操作。重新运行 npm run deploy 会先按原操作号核对，不会重复上传。`);
    }
    const reason = out.error ?? result.stderr;
    throw new StepError([`部署停在「${out.stage ?? '未知阶段'}」：${reason}`, out.next].filter(Boolean).join('\n'));
  }
  const appId = id(out.app_id);
  const versionId = id(out.version_id);
  ok(`已上传 v${report.version}：app_id=${appId} version_id=${versionId} package_id=${id(out.package_id)}`);
  // 平台 appid 应用：带云函数 / 后台能力的版本上传后平台自动签名；签不上时回执带原因（旧平台没有这个字段）。
  if (out.auto_sign?.status === 'failed') {
    warn(
      `平台自动签名失败（${out.auto_sign.reason ?? '未知原因'}）：云函数 / 后台能力暂时不可用。打开应用或切换版本时平台会自动重试；` +
        `也可以运行 npx zleap-app prepare ${appId} --version-id ${versionId} 查看详细错误。`,
    );
  }
  if (has('no-install')) return finish(appId, false);
  ok(`本人安装已是 v${report.version}`);
  finish(appId, true, out.diagnosis ?? null);
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
    case 'sdk':
      return syncSdk();
    default:
      console.log('用法：node scripts/zleap.mjs <login|deploy|status|logs|versions|release|sdk>');
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
