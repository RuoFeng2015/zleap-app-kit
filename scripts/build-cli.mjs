#!/usr/bin/env node
// 从 zleap-service 源码交叉编译 zleap-app，并生成各平台 npm 子包（esbuild 模式）。
//
//   node scripts/build-cli.mjs --source ../zleap-service              # 全部 6 个平台
//   node scripts/build-cli.mjs --source ../zleap-service --only linux-x64,darwin-arm64
//   node scripts/build-cli.mjs --go /usr/local/go/bin/go               # 指定 Go
//
// 产物：npm/app-cli-<os>-<cpu>/{package.json,README.md,bin/zleap-app[.exe]}，以及 npm/checksums.json。
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { arg, config, paths, platformDir, platformPackageName, platformSuffix } from './lib/config.mjs';

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
  console.error(`--only 没有匹配任何平台：${only}`);
  process.exit(1);
}

let commit = 'unknown';
try {
  commit = execFileSync('git', ['-C', source, '--no-optional-locks', 'rev-parse', '--short', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
} catch {
  // 非 git 目录时不阻断构建
}

const checksumsFile = join(paths.npm, 'checksums.json');
const checksums = existsSync(checksumsFile) ? JSON.parse(readFileSync(checksumsFile, 'utf8')) : {};

for (const platform of selected) {
  const dir = platformDir(platform);
  const exe = platform.goos === 'windows' ? 'zleap-app.exe' : 'zleap-app';
  rmSync(join(dir, 'bin'), { recursive: true, force: true });
  mkdirSync(join(dir, 'bin'), { recursive: true });
  const output = join(dir, 'bin', exe);

  process.stdout.write(`构建 ${platformSuffix(platform)} … `);
  execFileSync(go, ['build', '-trimpath', '-ldflags=-s -w', '-o', output, './cmd/zleap-app'], {
    cwd: source,
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, CGO_ENABLED: '0', GOOS: platform.goos, GOARCH: platform.goarch, GOFLAGS: '-buildvcs=false' },
  });
  if (platform.goos !== 'windows') chmodSync(output, 0o755);

  const digest = createHash('sha256').update(readFileSync(output)).digest('hex');
  checksums[platformSuffix(platform)] = { file: `bin/${exe}`, sha256: digest, commit };

  const name = platformPackageName(platform);
  writeFileSync(
    join(dir, 'package.json'),
    `${JSON.stringify(
      {
        name,
        version: config.version,
        description: `zleap-app 预编译二进制（${platform.os} ${platform.cpu}），由 ${config.cliPackage} 自动选用`,
        license: 'MIT',
        repository: { type: 'git', url: `git+${config.repositoryUrl}.git` },
        os: [platform.os],
        cpu: [platform.cpu],
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
    `# ${name}\n\n这是 \`${config.cliPackage}\` 的 ${platform.os}-${platform.cpu} 平台二进制，请直接安装主包：\n\n\`\`\`bash\nnpm i -D ${config.cliPackage}\n\`\`\`\n\n源码提交：\`${commit}\`，SHA-256：\`${digest}\`。\n`,
  );
  console.log(`完成 ${digest.slice(0, 12)}`);
}

writeFileSync(checksumsFile, `${JSON.stringify(checksums, null, 2)}\n`);
console.log(`已生成 ${selected.length} 个平台包，校验值写入 ${checksumsFile}`);
