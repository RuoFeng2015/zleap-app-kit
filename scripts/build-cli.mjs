#!/usr/bin/env node
// 从 zleap-service 源码交叉编译 zleap-app，并生成各平台 npm 子包（esbuild 模式）。
//
//   node scripts/build-cli.mjs --source ../zleap-service              # kit.config.json 里的全部平台包
//   node scripts/build-cli.mjs --source ../zleap-service --only linux-x64,darwin
//   node scripts/build-cli.mjs --go /usr/local/go/bin/go               # 指定 Go
//
// 产物：npm/app-cli-<key>/{package.json,README.md,bin/zleap-app[.exe]}，以及 npm/checksums.json。
// 一个平台包有多个 goarch（darwin）时分别编译再用 lipo 合成通用二进制，所以构建 darwin 包需要在 macOS 上。
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { arg, config, paths, platformDir, platformPackageName, platformSuffix, sdkSourceDigest, sdkSourceDir } from './lib/config.mjs';

const source = resolve(arg('source', join(paths.root, '..', 'zleap-service')));
const go = arg('go', 'go');
const only = arg('only');
const selected = config.platforms.filter(
  (platform) => typeof only !== 'string' || only.split(',').includes(platformSuffix(platform)),
);

if (!existsSync(join(source, 'cmd', 'zleap-app', 'main.go'))) {
  console.error(`找不到 zleap-app 源码：${join(source, 'cmd', 'zleap-app')}（用 --source 指定 zleap-service 目录）`);
  process.exit(1);
}
if (selected.length === 0) {
  console.error(`--only 没有匹配任何平台：${only}（可选：${config.platforms.map(platformSuffix).join(', ')}）`);
  process.exit(1);
}
if (selected.some((platform) => platform.goarch.length > 1)) {
  try {
    execFileSync('lipo', ['-info', process.execPath], { stdio: 'ignore' });
  } catch {
    console.error('合成 macOS 通用二进制需要 lipo（macOS 自带）。请在 Mac 上构建，或用 --only 跳过 darwin。');
    process.exit(1);
  }
}

let commit = 'unknown';
try {
  commit = execFileSync('git', ['-C', source, '--no-optional-locks', 'rev-parse', '--short', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
} catch {
  // 非 git 目录时不阻断构建
}
// CLI 二进制内嵌了一份 SDK（MCP 的 SDK 参考、原生模板）：记下指纹，发布 SDK 时提示两者是否同一份。
const sdk = sdkSourceDigest(sdkSourceDir(source)).digest;

const checksumsFile = join(paths.npm, 'checksums.json');
const previous = existsSync(checksumsFile) ? JSON.parse(readFileSync(checksumsFile, 'utf8')) : {};
// 只保留仍在 kit.config.json 里的平台包，已合并 / 下线的平台不再留校验值。
const checksums = Object.fromEntries(
  config.platforms.map(platformSuffix).filter((key) => previous[key]).map((key) => [key, previous[key]]),
);

for (const platform of selected) {
  const dir = platformDir(platform);
  const exe = platform.goos === 'windows' ? 'zleap-app.exe' : 'zleap-app';
  rmSync(join(dir, 'bin'), { recursive: true, force: true });
  mkdirSync(join(dir, 'bin'), { recursive: true });
  const output = join(dir, 'bin', exe);

  process.stdout.write(`构建 ${platformSuffix(platform)}（${platform.goos}/${platform.goarch.join('+')}）… `);
  const slices = platform.goarch.map((goarch) => (platform.goarch.length > 1 ? `${output}-${goarch}` : output));
  platform.goarch.forEach((goarch, i) => {
    execFileSync(go, ['build', '-trimpath', '-ldflags=-s -w', '-o', slices[i], './cmd/zleap-app'], {
      cwd: source,
      stdio: ['ignore', 'inherit', 'inherit'],
      env: { ...process.env, CGO_ENABLED: '0', GOOS: platform.goos, GOARCH: goarch, GOFLAGS: '-buildvcs=false' },
    });
  });
  if (slices.length > 1) {
    execFileSync('lipo', ['-create', '-output', output, ...slices], { stdio: ['ignore', 'inherit', 'inherit'] });
    for (const slice of slices) rmSync(slice);
  }
  if (platform.goos !== 'windows') chmodSync(output, 0o755);

  const digest = createHash('sha256').update(readFileSync(output)).digest('hex');
  checksums[platformSuffix(platform)] = { file: `bin/${exe}`, sha256: digest, commit, sdk };

  const name = platformPackageName(platform);
  const arch = platform.cpu.join(' / ');
  writeFileSync(
    join(dir, 'package.json'),
    `${JSON.stringify(
      {
        name,
        version: config.cliVersion,
        description: `zleap-app 预编译二进制（${platform.os} ${arch}），由 ${config.cliPackage} 自动选用`,
        license: 'MIT',
        repository: { type: 'git', url: `git+${config.repositoryUrl}.git` },
        os: [platform.os],
        cpu: platform.cpu,
        files: ['bin'],
        preferUnplugged: true,
        zleapApp: { commit, sha256: digest },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(dir, 'README.md'),
    `# ${name}\n\n这是 \`${config.cliPackage}\` 的 ${platform.os}（${arch}）平台二进制，请直接安装主包：\n\n\`\`\`bash\nnpm i -D ${config.cliPackage}\n\`\`\`\n\n源码提交：\`${commit}\`，SHA-256：\`${digest}\`。\n`,
  );
  console.log(`完成 ${digest.slice(0, 12)}`);
}

writeFileSync(checksumsFile, `${JSON.stringify(checksums, null, 2)}\n`);
console.log(`已生成 ${selected.length} 个平台包（版本 ${config.cliVersion}），校验值写入 ${checksumsFile}`);
