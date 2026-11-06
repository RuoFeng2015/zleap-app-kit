#!/usr/bin/env node
// 按依赖顺序发布：平台子包 → CLI 主包 → SDK → create-zleap-app。
// registry 上已有的版本直接跳过，也不要求本地有它的产物：只改了 SDK 时不用编译 CLI，只改了模板时两者都不用构建。
//
//   node scripts/publish.mjs --dry-run          # 只做 npm publish --dry-run
//   node scripts/publish.mjs --tag next         # 发布到指定 dist-tag
//   --source ../zleap-service                   # SDK 事实源（默认同级目录），用于核对 dist 是否最新
//   --otp 123456                                # 账号开了 2FA 且 token 不能绕过时，附带一次性验证码
//   --only create-zleap-app,@zleap-ai/app-sdk   # 只发布指定包（中途失败后续发）
//
// 发布前会做：sync --check；对要发布的包核对 SDK 产物（build-sdk --check）与二进制校验值。
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { arg, config, flag, paths, platformDir, platformPackageName, platformSuffix, readJSON } from './lib/config.mjs';

const dryRun = flag('dry-run');
const tag = arg('tag', 'latest');
const otp = arg('otp');
const only = arg('only') ? String(arg('only')).split(',') : null;
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function step(title, fn) {
  process.stdout.write(`• ${title}\n`);
  fn();
}

step('核对包名、版本与随附 skills', () => {
  execFileSync(process.execPath, [join(paths.root, 'scripts', 'sync.mjs'), '--check'], { stdio: 'inherit' });
});

/** 该版本是否已在 registry 上（重跑时跳过，npm 同一版本只能发布一次）。 */
function published(name, version) {
  const result = spawnSync(npm, ['view', `${name}@${version}`, 'version'], { encoding: 'utf8', shell: process.platform === 'win32' });
  return result.status === 0 && result.stdout.trim() === version;
}

// 发布清单（按依赖顺序）。平台包的 package.json 由 build-cli 生成，没构建过时按 kit.config.json 推出名称与版本。
const targets = [
  ...config.platforms.map((platform) => ({ dir: platformDir(platform), name: platformPackageName(platform), version: config.cliVersion, platform })),
  ...[paths.cli, paths.sdk, paths.create].map((dir) => ({ dir, ...readJSON(join(dir, 'package.json')) })),
].filter((target) => !only || only.includes(target.name));

let skipped = 0;
const todo = [];
for (const target of targets) {
  if (published(target.name, target.version)) {
    console.log(`• 跳过 ${target.name}@${target.version}（已发布）`);
    skipped++;
  } else todo.push(target);
}
if (todo.length === 0) {
  console.log('\n没有需要发布的包：先在 kit.config.json 里递增要发的那条版本（cliVersion / sdkVersion / createVersion），再 npm run sync。');
  process.exit(0);
}

const checksums = existsSync(join(paths.npm, 'checksums.json')) ? readJSON(join(paths.npm, 'checksums.json')) : {};
for (const { dir, platform } of todo.filter((target) => target.platform)) {
  const key = platformSuffix(platform);
  const pkg = existsSync(join(dir, 'package.json')) ? readJSON(join(dir, 'package.json')) : null;
  const exe = platform.goos === 'windows' ? 'zleap-app.exe' : 'zleap-app';
  const binary = join(dir, 'bin', exe);
  if (!pkg || !existsSync(binary)) {
    console.error(`缺少 ${key} 平台包，先运行 npm run build:cli -- --source ../zleap-service`);
    process.exit(1);
  }
  if (pkg.version !== config.cliVersion) {
    console.error(`${pkg.name} 版本 ${pkg.version} 与 kit.config.json 的 cliVersion ${config.cliVersion} 不一致，请重新构建`);
    process.exit(1);
  }
  const digest = createHash('sha256').update(readFileSync(binary)).digest('hex');
  if (checksums[key]?.sha256 !== digest) {
    console.error(`${key} 二进制与 checksums.json 不一致，请重新构建`);
    process.exit(1);
  }
}

if (todo.some((target) => target.dir === paths.sdk)) {
  step('核对 SDK 产物由当前源码构建', () => {
    const args = [join(paths.root, 'scripts', 'build-sdk.mjs'), '--check'];
    if (arg('source')) args.push('--source', String(arg('source')));
    execFileSync(process.execPath, args, { stdio: 'inherit' });
  });
  // CLI 二进制内嵌一份 SDK（MCP 的 SDK 参考、原生模板）。只发 SDK 不发 CLI 时那份会旧一版：不影响应用运行，只提示。
  const built = readJSON(join(paths.sdk, 'dist', 'build-info.json')).source;
  const embedded = new Set(config.platforms.map((platform) => checksums[platformSuffix(platform)]?.sdk));
  if (embedded.size !== 1 || !embedded.has(built)) {
    console.log(
      '  提示：CLI 内嵌的 SDK 副本与这次发布的 SDK 不是同一份（只影响 MCP 的 SDK 参考与原生模板，不影响应用运行）；' +
        '下次 CLI 有改动时一起递增 cliVersion 并 build:cli 即可。',
    );
  }
}

/** 这个包在 registry 上有哪些版本（不存在返回 []）。 */
function versionsOf(name) {
  const result = spawnSync(npm, ['view', name, 'versions', '--json'], { encoding: 'utf8', shell: process.platform === 'win32' });
  if (result.status !== 0) return [];
  try {
    const value = JSON.parse(result.stdout);
    return Array.isArray(value) ? value : [value];
  } catch {
    return [];
  }
}

/** registry 读有几秒延迟：发布成功后轮询确认。 */
function waitLive(name, version) {
  for (let i = 0; i < 8; i++) {
    if (published(name, version)) return true;
    spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},2500)']);
  }
  return false;
}

/**
 * npm 自己处理两步验证：开了「Security key」时打印 Authenticate your account at <链接>、按回车打开浏览器；
 * 开了认证器时提示输入验证码。所以 stdin / stdout / stderr 全部直通终端，脚本不截获、不代答。
 *
 * 不能只看退出码：npm 10 在等网页验证时可能报「Exit handler never called!」却以 0 退出，什么都没发上去。
 * 所以每个包发完都到 registry 核对一次。
 */
function publishOnce(args, cwd) {
  return new Promise((resolvePromise) => {
    const child = spawn(npm, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('close', (status) => resolvePromise(status));
  });
}

const failureHelp =
  '常见原因：\n' +
  '  · 网页验证没完成：npm 打印「Authenticate your account at <链接>」后，按回车打开浏览器（或手动打开链接）完成验证再回到终端；\n' +
  '  · 出现「Exit handler never called!」是 npm 10 自身的问题，重跑即可；仍然出现就换新版 npm：npx -y npm@11 run release -- --source ../zleap-service；\n' +
  '  · 账号没开两步验证：npmjs.com → 头像 → Account → Two-Factor Authentication → Enable 2FA（模式选 Authorization and writes）。\n' +
  '已发布的包重跑时会自动跳过：npm run release -- --source ../zleap-service';

let done = 0;
const staged = [];
const processing = [];
for (const { dir, name, version } of todo) {
  console.log(`• ${dryRun ? '[dry-run] ' : ''}发布 ${name}@${version}（tag ${tag}）`);
  const args = ['publish', '--access', 'public', '--tag', String(tag)];
  if (dryRun) args.push('--dry-run');
  if (otp) args.push('--otp', String(otp));
  const status = await publishOnce(args, dir);
  if (dryRun) {
    if (status !== 0) {
      console.error(`\n${name} dry-run 失败`);
      process.exit(1);
    }
    done++;
    continue;
  }
  if (waitLive(name, version)) {
    console.log(`  ✔ ${name}@${version} 已上线`);
    done++;
    continue;
  }
  if (status === 0 && !versionsOf(name).includes('0.0.0-stage')) {
    // npm 11 起新版本要先过 registry 的处理（「Your package is being processed and may take a few minutes」），
    // 几分钟内查不到是正常的；npm 已经确认收下（退出码 0），继续发下一个，最后统一核对。
    console.log(`  … ${name}@${version} npm 已收下，registry 处理中（通常几分钟内可见）`);
    processing.push(`${name}@${version}`);
    done++;
    continue;
  }
  // 退出码非 0 但已有 0.0.0-stage 占位：多半是「Cannot publish over previously staged version」——
  // 这个版本已经在待批准区，重复发布只会 409，批准它即可。
  if (status === 0 || versionsOf(name).includes('0.0.0-stage')) {
    // 凭据只能暂存发布：版本在待批准区，后面的包依赖它的话也照样可以先暂存。
    console.log(`  … ${name}@${version} 进入了待批准区（暂存发布），需要用 2FA 批准后才上线`);
    staged.push(`${name}@${version}`);
    continue;
  }
  console.error(`\n✖ ${name}@${version} 没有发布成功（npm 退出码 ${status}，registry 上查不到这个版本）。\n${failureHelp}`);
  process.exit(1);
}
console.log(dryRun ? '\ndry-run 完成' : `\n完成：新上线 ${done} 个，待批准 ${staged.length} 个，跳过 ${skipped} 个已发布的包`);

// 没有直接发布权限的凭据（例如跳过 2FA 的 token）会被 npm 转成「暂存发布」：新包只出现 0.0.0-stage 占位版本，
// 真正的版本要维护者用 2FA 批准后才上线。这里逐个核对，免得以为发完了。
if (!dryRun) {
  const waiting = [];
  for (const { name, version } of todo) {
    if (!published(name, version)) waiting.push(`${name}@${version}`);
  }
  if (waiting.length) {
    console.log(
      `\n以下版本暂时还查不到：\n  ${waiting.join('\n  ')}\n` +
        '刚发布的版本 registry 要处理几分钟，过 5 分钟再运行 npm run release 核对（已上线的会跳过）；\n' +
        '仍查不到、且 npm 上显示 0.0.0-stage 占位版本的，是在「待批准」暂存区：\n' +
        '批准方式（需要 2FA；stage 命令要 npm 12）：npx -y npm@latest stage list 查看暂存编号 → 逐个 npx -y npm@latest stage approve <stage-id>；\n' +
        '或在 npmjs.com 头像 → Packages →「Staged Packages」里点 Approve。批准后再运行 npm run release 核对。',
    );
    process.exitCode = 1;
  }
}
