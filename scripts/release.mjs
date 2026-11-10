#!/usr/bin/env node
// 一键发布：和 npm 上的 latest 比 → 只发真正变了的包 → 自动定版本 → 构建、测试 → 暂存发布（不要 2FA）→ 一次授权批准全部。
//
//   npm run release                    # 打印发布计划，确认后执行
//   npm run release -- --dry-run       # 只检测、打印计划，不改任何文件
//   npm run release -- --yes           # 不再询问确认（批准时的 2FA 仍要你本人完成）
//   npm run release:approve            # 只批准暂存区里已上传的包（上传成功、批准中断后续跑用）
//   --force cli,sdk,create             # 没检测到变化也强制发这几条线
//   --refs                             # 文档站有新改动时同步进 skills（配合 --yes；交互模式会问）
//   --source ../zleap-service --docs ../zleap-web/apps/docs   # 事实源位置（默认同级目录）
//
// 为什么能「一次授权」：npm 12 的 `npm stage publish` 上传时不要 2FA，只有批准（approve）要。
// 所以先把所有包上传进暂存区（慢的部分），再连续批准（每个只是一次很小的请求）：
//   · 2FA 用验证器 App：输一次 6 位码，所有包都用它批准；过期了再问一次。
//   · 2FA 用安全密钥 / 浏览器验证：浏览器验证一次，拿到的凭据先给后面的包复用；npm 不收时再开一次浏览器。
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { setTimeout as sleep } from 'node:timers/promises';

import { arg, config, flag, paths, platformDir, platformPackageName, readJSON, sdkSourceDigest, sdkSourceDir } from './lib/config.mjs';
import { cliSourceDigest } from './lib/fingerprint.mjs';

const dryRun = flag('dry-run');
const approveOnly = flag('approve-only');
const yes = flag('yes');
const force = new Set(arg('force') ? String(arg('force')).split(',') : []);
const source = resolve(arg('source', join(paths.root, '..', 'zleap-service')));
const docs = resolve(arg('docs', join(paths.root, '..', 'zleap-web', 'apps', 'docs')));
const win = process.platform === 'win32';
const npmBin = win ? 'npm.cmd' : 'npm';
const npxBin = win ? 'npx.cmd' : 'npx';
const NPM12 = ['-y', 'npm@12', '--loglevel', 'error'];
const tmp = mkdtempSync(join(tmpdir(), 'zleap-release-'));
process.on('exit', () => rmSync(tmp, { recursive: true, force: true }));

const bold = (text) => `\x1b[1m${text}\x1b[0m`;
const dim = (text) => `\x1b[2m${text}\x1b[0m`;
const green = (text) => `\x1b[32m${text}\x1b[0m`;
const red = (text) => `\x1b[31m${text}\x1b[0m`;

class ReleaseError extends Error {}

function step(title) {
  console.log(`\n${bold(`▸ ${title}`)}`);
}

function node(script, ...args) {
  execFileSync(process.execPath, [join(paths.root, 'scripts', script), ...args], { cwd: paths.root, stdio: 'inherit' });
}

function npm(args, options = {}) {
  return spawnSync(npmBin, args, { encoding: 'utf8', shell: win, cwd: tmp, ...options });
}

let rl;
async function ask(question) {
  rl ??= createInterface({ input: process.stdin, output: process.stdout });
  return (await rl.question(question)).trim();
}

async function confirm(question) {
  if (yes) return true;
  if (!process.stdin.isTTY) throw new ReleaseError(`需要确认「${question}」，非交互环境请加 --yes`);
  return /^y(es)?$/i.test(await ask(`${question} (y/N) `));
}

// ───────────────────────── 版本号 ─────────────────────────

const parse = (version) => version.split('-')[0].split('.').map(Number);
function newer(a, b) {
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}
const bumpPatch = (version) => {
  const [major, minor, patch] = parse(version);
  return `${major}.${minor}.${patch + 1}`;
};

function latestOf(name) {
  const result = npm(['view', name, 'dist-tags.latest']);
  return result.status === 0 && result.stdout.trim() ? result.stdout.trim() : null;
}

function published(name, version) {
  const result = npm(['view', `${name}@${version}`, 'version']);
  return result.status === 0 && result.stdout.trim() === version;
}

function viewField(spec, field) {
  const result = npm(['view', spec, field]);
  return result.status === 0 ? result.stdout.trim() : '';
}

// ───────────────────────── 内容对比 ─────────────────────────

/** npm pack（registry 上的版本或本地目录）后解压，返回 package/ 目录。和发布时同一套打包规则，比直接比源码目录可靠。 */
function unpack(spec, label) {
  const dest = join(tmp, label);
  mkdirSync(dest, { recursive: true });
  const result = npm(['pack', spec, '--pack-destination', dest, '--json']);
  if (result.status !== 0) throw new ReleaseError(`npm pack ${spec} 失败：\n${result.stderr}`);
  const [{ filename }] = JSON.parse(result.stdout);
  execFileSync('tar', ['-xzf', join(dest, filename.split('/').pop()), '-C', dest]);
  return join(dest, 'package');
}

function filesUnder(dir) {
  return readdirSync(dir, { recursive: true })
    .map(String)
    .filter((rel) => statSync(join(dir, rel)).isFile())
    .map((rel) => rel.split(sep).join('/'));
}

const sortKeys = (value) =>
  Array.isArray(value)
    ? value.map(sortKeys)
    : value && typeof value === 'object'
      ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys(value[key])]))
      : value;

/** package.json 去掉本来就会随版本变的字段：自身版本、平台子包版本、脚手架写入的 CLI/SDK 版本。 */
function manifestShape(text) {
  const pkg = JSON.parse(text);
  delete pkg.version;
  for (const name of Object.keys(pkg.optionalDependencies ?? {})) pkg.optionalDependencies[name] = '*';
  if (pkg.zleapKit) {
    delete pkg.zleapKit.cliVersion;
    delete pkg.zleapKit.sdkVersion;
  }
  return JSON.stringify(sortKeys(pkg));
}

function changedFiles(before, after, skip = () => false) {
  const names = [...new Set([...filesUnder(before), ...filesUnder(after)])].filter((rel) => !skip(rel)).sort();
  return names.filter((rel) => {
    const [a, b] = [join(before, rel), join(after, rel)];
    if (!existsSync(a) || !existsSync(b)) return true;
    if (rel === 'package.json') return manifestShape(readFileSync(a, 'utf8')) !== manifestShape(readFileSync(b, 'utf8'));
    return !readFileSync(a).equals(readFileSync(b));
  });
}

const summarize = (files) => (files.length > 4 ? `${files.slice(0, 4).join('、')} 等 ${files.length} 个文件` : files.join('、'));

// ───────────────────────── 检测 ─────────────────────────

function detectCli() {
  const latest = latestOf(config.cliPackage);
  if (!latest) return { latest, reasons: ['npm 上还没有'] };
  const reasons = [];
  const platforms = config.platforms.map(platformPackageName);
  const missing = platforms.filter((name) => !published(name, latest));
  if (missing.length) reasons.push(`平台包组合变了（${latest} 里没有 ${missing.join('、')}）`);
  const remote = missing.length === platforms.length ? '' : viewField(`${platforms.find((name) => !missing.includes(name))}@${latest}`, 'zleapApp.source');
  if (!remote) reasons.push('已发布版本没有记录源码指纹（首次按新流程发布）');
  else if (remote !== cliSourceDigest(source)) reasons.push('zleap-app 的 Go 源码有变化');
  const files = changedFiles(unpack(`${config.cliPackage}@${latest}`, 'cli-npm'), unpack(paths.cli, 'cli-local'));
  if (files.length) reasons.push(`主包文件有变化：${summarize(files)}`);
  return { latest, reasons };
}

function detectSdk() {
  const latest = latestOf(config.sdkPackage);
  if (!latest) return { latest, reasons: ['npm 上还没有'] };
  const reasons = [];
  const remote = unpack(`${config.sdkPackage}@${latest}`, 'sdk-npm');
  const info = join(remote, 'dist', 'build-info.json');
  const remoteSource = existsSync(info) ? readJSON(info).source : '';
  if (remoteSource !== sdkSourceDigest(sdkSourceDir(source)).digest) reasons.push('SDK 源码有变化');
  const files = changedFiles(remote, unpack(paths.sdk, 'sdk-local'), (rel) => rel.startsWith('dist/'));
  if (files.length) reasons.push(`包壳文件有变化：${summarize(files)}`);
  return { latest, reasons };
}

function detectCreate(dependents) {
  const latest = latestOf(config.createPackage);
  if (!latest) return { latest, reasons: ['npm 上还没有'] };
  const reasons = [];
  const files = changedFiles(unpack(`${config.createPackage}@${latest}`, 'create-npm'), unpack(paths.create, 'create-local'));
  if (files.length) reasons.push(`模板 / skills 有变化：${summarize(files)}`);
  if (dependents.length) reasons.push(`新项目要用新的 ${dependents.join(' / ')} 版本`);
  return { latest, reasons };
}

/** 发布版本：本地已写了比 npm 新且没发过的版本就用它（续跑不会重复递增），否则在较大者上递增补丁号。 */
function nextVersion(name, local, latest) {
  let version = !latest || (newer(local, latest) && !published(name, local)) ? local : bumpPatch(newer(local, latest) ? local : latest);
  while (published(name, version)) version = bumpPatch(version);
  return version;
}

function writeVersions(versions) {
  const file = join(paths.root, 'kit.config.json');
  let text = readFileSync(file, 'utf8');
  for (const [key, version] of Object.entries(versions)) {
    text = text.replace(new RegExp(`("${key}":\\s*)"[^"]*"`), `$1"${version}"`);
  }
  writeFileSync(file, text);
}

// ───────────────────────── 暂存与批准 ─────────────────────────

function npm12(args, options = {}) {
  return spawnSync(npxBin, [...NPM12, ...args], { encoding: 'utf8', shell: win, ...options });
}

function stagedItems() {
  const result = npm12(['stage', 'list', '--json'], { cwd: tmp });
  if (result.status !== 0) throw new ReleaseError(`读取暂存区失败：\n${result.stderr}`);
  return JSON.parse(result.stdout || '[]');
}

function localShasum(dir) {
  const result = npm(['pack', dir, '--dry-run', '--json']);
  return JSON.parse(result.stdout)[0].shasum;
}

function stage(target, existing) {
  const found = existing.find((item) => item.packageName === target.name && item.version === target.version);
  if (found) {
    if (found.shasum !== localShasum(target.dir)) {
      throw new ReleaseError(
        `${target.name}@${target.version} 已在暂存区，但内容和本地不同。\n` +
          `  先拒绝旧的暂存（需要 2FA）：npx -y npm@12 stage reject ${found.id}，或在 kit.config.json 递增版本后重跑。`,
      );
    }
    console.log(`  · ${target.name}@${target.version} 已在暂存区（${found.id}），沿用`);
    return found.id;
  }
  const result = npm12(['stage', 'publish', '--access', 'public', '--tag', 'latest'], { cwd: target.dir, stdio: ['inherit', 'pipe', 'inherit'] });
  const id = result.stdout?.match(/staged with id ([0-9a-f-]{36})/i)?.[1] ?? stagedItems().find((item) => item.packageName === target.name && item.version === target.version)?.id;
  if (result.status !== 0 || !id) throw new ReleaseError(`${target.name}@${target.version} 上传暂存区失败：\n${result.stdout ?? ''}`);
  console.log(`  ${green('✔')} ${target.name}@${target.version} 已上传暂存区`);
  return id;
}

function registryAuth() {
  const registry = npm(['config', 'get', 'registry']).stdout.trim().replace(/\/?$/, '/') || 'https://registry.npmjs.org/';
  const { host, pathname } = new URL(registry);
  const key = `//${host}${pathname}:_authToken`;
  for (const file of [join(paths.root, '.npmrc'), npm(['config', 'get', 'userconfig']).stdout.trim()]) {
    if (!file || !existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*([^=\s]+)\s*=\s*(.*?)\s*$/);
      if (match?.[1] === key) {
        const token = match[2].replace(/^["']|["']$/g, '').replace(/\$\{([^}]+)\}/g, (_, name) => process.env[name] ?? '');
        return { registry, token };
      }
    }
  }
  return { registry, token: '' };
}

function openBrowser(url) {
  const [cmd, args] = win ? ['cmd', ['/c', 'start', '""', url]] : [process.platform === 'darwin' ? 'open' : 'xdg-open', [url]];
  spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
}

/**
 * 和 npm 自己发的请求头保持一致（npm-registry-fetch）：批准请求与轮询验证结果用同一组头，
 * registry 按它们把浏览器验证和这次请求对应起来，只带 token 轮询会被拒（403）。
 */
function npmHeaders(token) {
  const version = npm12(['--version'], { cwd: tmp }).stdout?.trim() || '12.0.0';
  return {
    'user-agent': `npm/${version} node/${process.version} ${process.platform} ${process.arch} workspaces/false`,
    'npm-auth-type': 'web',
    'npm-command': 'stage',
    'npm-session': randomBytes(8).toString('hex'),
    authorization: `Bearer ${token}`,
  };
}

/** 浏览器验证（安全密钥 / 浏览器里的 2FA）：打开 authUrl，轮询 doneUrl 拿一次性凭据。与 npm 自己的流程相同。 */
async function webAuth({ authUrl, doneUrl }, headers) {
  console.log(`\n  在浏览器里完成 npm 验证（已尝试自动打开）：\n  ${authUrl}`);
  openBrowser(authUrl);
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    const res = await fetch(doneUrl, { headers, cache: 'no-store' });
    if (res.status === 200) {
      const body = await res.json();
      if (body.token) return body.token;
    } else if (res.status !== 202) {
      throw new ReleaseError(`浏览器验证结果读取失败：HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    }
    await sleep(Math.max(1, Number(res.headers.get('retry-after')) || 1) * 1000);
  }
  throw new ReleaseError('浏览器验证超时（5 分钟）');
}

/** 交给 npm 自己批准（它的浏览器验证一定可用）：每个包各验证一次，作为兜底。 */
function approveWithNpm(items) {
  for (const item of items) {
    console.log(`  · ${item.name}@${item.version}：npm stage approve ${item.id}`);
    const result = spawnSync(npxBin, [...NPM12, 'stage', 'approve', item.id], { stdio: 'inherit', shell: win, cwd: tmp });
    if (result.status !== 0) {
      throw new ReleaseError(`${item.name}@${item.version} 批准失败。也可以在 npmjs.com 头像 → Packages →「Staged Packages」里点 Approve。`);
    }
    console.log(`  ${green('✔')} ${item.name}@${item.version} 已批准上线`);
  }
}

async function approveAll(staged) {
  // 刚上传的包 registry 要先校验（status: validating），校验完才能批准。
  for (let i = 0; i < 60; i++) {
    const validating = stagedItems().filter((item) => staged.some((own) => own.id === item.id) && item.status === 'validating');
    if (validating.length === 0) break;
    if (i === 0) console.log(dim(`  等 registry 校验完：${validating.map((item) => item.packageName).join('、')}`));
    await sleep(5000);
  }
  const { registry, token } = registryAuth();
  // 凭据不在 .npmrc（例如来自环境变量）：只能交给 npm 自己批准。
  if (!token) return approveWithNpm(staged);
  const headers = npmHeaders(token);
  let otp = '';
  for (const [index, item] of staged.entries()) {
    try {
      for (let attempt = 0; ; attempt++) {
        const res = await fetch(new URL(`-/stage/${item.id}/approve`, registry), {
          method: 'POST',
          headers: { ...headers, ...(otp ? { 'npm-otp': otp } : {}) },
        });
        if (res.ok) {
          console.log(`  ${green('✔')} ${item.name}@${item.version} 已批准上线`);
          break;
        }
        const text = await res.text();
        const needsOtp = res.status === 401 && (/otp/i.test(res.headers.get('www-authenticate') ?? '') || /one-time pass/i.test(text));
        if (!needsOtp || attempt >= 3) {
          throw new ReleaseError(`${item.name}@${item.version} 批准失败：HTTP ${res.status} ${text.slice(0, 300)}`);
        }
        let body = {};
        try {
          body = JSON.parse(text);
        } catch {
          // 纯文本错误：按验证码处理
        }
        otp = body.authUrl && body.doneUrl ? await webAuth(body, headers) : await ask(`\n  ${otp ? '验证码已过期，' : ''}输入验证器 App 里的 npm 6 位验证码：`);
      }
    } catch (error) {
      if (!(error instanceof ReleaseError)) throw error;
      console.log(`\n  ${red('!')} ${error.message}\n  改由 npm 自己批准剩下的 ${staged.length - index} 个包（每个包各验证一次）：`);
      return approveWithNpm(staged.slice(index));
    }
  }
}

/** 续跑：只批准暂存区里本仓库的包，按依赖顺序。 */
async function approveStaged() {
  const order = [...config.platforms.map(platformPackageName), config.cliPackage, config.sdkPackage, config.createPackage];
  const staged = stagedItems()
    .filter((item) => order.includes(item.packageName))
    .filter((item) => !published(item.packageName, item.version))
    .map((item) => ({ id: item.id, name: item.packageName, version: item.version }))
    .sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
  if (staged.length === 0) {
    console.log('暂存区里没有待批准的包。');
    return;
  }
  step(`批准上线（${staged.length} 个，按依赖顺序）`);
  for (const item of staged) console.log(dim(`  ${item.name}@${item.version}  ${item.id}`));
  await approveAll(staged);
  await verify(staged);
}

async function waitLive(name, version) {
  for (let i = 0; i < 12; i++) {
    if (published(name, version)) return true;
    await sleep(5000);
  }
  return false;
}

async function verify(targets) {
  step('核对 registry');
  let missing = 0;
  for (const target of targets) {
    const live = await waitLive(target.name, target.version);
    if (!live) missing++;
    console.log(`  ${live ? green('✔') : red('…')} ${target.name}@${target.version}${live ? '' : ' 暂时还查不到（registry 有延迟，稍后 npm view 再看）'}`);
  }
  console.log(`\n${missing ? '发布请求都已完成，部分版本 registry 还在处理。' : green('全部发布完成。')}记得提交 kit.config.json 等改动并推送 GitHub。`);
}

// ───────────────────────── 主流程 ─────────────────────────

async function main() {
  if (approveOnly) return approveStaged();
  if (!existsSync(join(source, 'cmd', 'zleap-app', 'main.go'))) throw new ReleaseError(`找不到 zleap-service：${source}（用 --source 指定）`);

  step('同步 skills 与包信息');
  if (existsSync(join(docs, '.vitepress'))) {
    const drift = spawnSync(process.execPath, [join(paths.root, 'scripts', 'sync-skill-references.mjs'), '--docs', docs, '--check'], { encoding: 'utf8' });
    if (drift.status !== 0) {
      console.log(dim(drift.stderr.trim()));
      if (!dryRun && (flag('refs') || (!yes && (await confirm('文档站有改动还没同步进 skills，要一起发布吗？'))))) {
        node('sync-skill-references.mjs', '--docs', docs);
      } else console.log('  不同步，skills 沿用当前内容');
    } else console.log('  skills 参考资料与文档站一致');
  } else console.log(dim(`  没找到文档站 ${docs}，跳过 skills 参考资料核对`));
  if (dryRun) {
    const check = spawnSync(process.execPath, [join(paths.root, 'scripts', 'sync.mjs'), '--check'], { encoding: 'utf8' });
    if (check.status !== 0) console.log(dim(`  （dry-run 不写文件）${check.stderr.trim()}`));
  } else node('sync.mjs');

  step('对比 npm 上的 latest');
  const lines = [
    { id: 'cli', label: 'CLI', key: 'cliVersion', name: config.cliPackage, ...detectCli() },
    { id: 'sdk', label: 'SDK', key: 'sdkVersion', name: config.sdkPackage, ...detectSdk() },
  ];
  for (const line of lines) if (force.has(line.id)) line.reasons.push('--force');
  const dependents = lines.filter((line) => line.reasons.length).map((line) => line.label);
  const create = { id: 'create', label: '脚手架', key: 'createVersion', name: config.createPackage, ...detectCreate(dependents) };
  if (force.has('create')) create.reasons.push('--force');
  lines.push(create);

  const versions = {};
  for (const line of lines) {
    line.release = line.reasons.length > 0;
    line.version = line.release ? nextVersion(line.name, config[line.key], line.latest) : line.latest;
    versions[line.key] = line.version;
    const head = `  ${line.name.padEnd(20)} npm ${String(line.latest ?? '—').padEnd(8)}`;
    console.log(line.release ? `${head} → ${green(`发布 ${line.version}`)}  ${dim(line.reasons.join('；'))}` : `${head}   ${dim('无变化，不发布')}`);
  }

  const targets = [];
  for (const line of lines.filter((item) => item.release)) {
    if (line.id === 'cli') {
      for (const platform of config.platforms) targets.push({ name: platformPackageName(platform), version: line.version, dir: platformDir(platform) });
      targets.push({ name: config.cliPackage, version: line.version, dir: paths.cli });
    }
    if (line.id === 'sdk') targets.push({ name: config.sdkPackage, version: line.version, dir: paths.sdk });
    if (line.id === 'create') targets.push({ name: config.createPackage, version: line.version, dir: paths.create });
  }
  if (targets.length === 0) {
    console.log(`\n${green('都和 npm 上一致，没有要发布的包。')}`);
    return;
  }
  console.log(`\n  将发布 ${targets.length} 个包：${targets.map((target) => `${target.name}@${target.version}`).join('、')}`);
  const pinned = lines.filter((line) => !line.release && line.version !== config[line.key]);
  if (pinned.length) console.log(dim(`  不发布的线把 kit.config.json 对齐到 npm 上的版本：${pinned.map((line) => `${line.key} ${config[line.key]} → ${line.version}`).join('，')}`));
  if (dryRun) {
    console.log(`\n${dim('dry-run：没有改任何文件。去掉 --dry-run 正式发布。')}`);
    return;
  }
  if (!(await confirm('\n按上面的计划发布？'))) return;

  step('写入版本并构建');
  writeVersions(versions);
  node('sync.mjs');
  const releasing = new Set(lines.filter((line) => line.release).map((line) => line.id));
  if (releasing.has('sdk') || releasing.has('cli')) {
    // CLI 二进制内嵌混淆后的 SDK（sdkdist），发 CLI 时也要先刷新它；sdkdist 有变化要提交到 zleap-service。
    if (!existsSync(join(paths.root, 'node_modules', 'esbuild'))) execFileSync(npmBin, ['install'], { cwd: paths.root, stdio: 'inherit', shell: win });
    node('build-sdk.mjs', '--source', source, '--embed');
  }
  if (releasing.has('cli')) node('build-cli.mjs', '--source', source);

  step('检查与测试');
  node('sync.mjs', '--check');
  execFileSync(npmBin, ['test'], { cwd: paths.root, stdio: 'inherit', shell: win });

  step('npm 登录');
  if (npm(['whoami']).status !== 0) {
    console.log('  npm 登录已失效，打开浏览器重新登录…');
    if (spawnSync(npmBin, ['login', '--auth-type=web'], { stdio: 'inherit', shell: win }).status !== 0 || npm(['whoami']).status !== 0) {
      throw new ReleaseError('npm 登录没有完成');
    }
  }
  console.log(`  已登录：${npm(['whoami']).stdout.trim()}`);

  step('上传到暂存区（不需要 2FA）');
  const pending = targets.filter((target) => {
    if (!published(target.name, target.version)) return true;
    console.log(`  · ${target.name}@${target.version} 已上线，跳过`);
    return false;
  });
  const existing = stagedItems();
  const staged = pending.map((target) => ({ ...target, id: stage(target, existing) }));

  step(`批准上线（${staged.length} 个，按依赖顺序；2FA 只需要一次）`);
  await approveAll(staged);
  await verify(targets);
}

main()
  .catch((error) => {
    console.error(`\n${red('✖')} ${error instanceof ReleaseError ? error.message : error.stack ?? error}`);
    console.error(dim('包都已上传、只是批准没完成：npm run release:approve 续跑；其他情况直接重跑 npm run release（已上线的跳过，已暂存的沿用）。'));
    process.exitCode = 1;
  })
  .finally(() => rl?.close());
