#!/usr/bin/env node
// 按 kit.config.json 统一各包的名称与版本，并把 skills 复制进 create-zleap-app（随 npm 包分发）。
//
//   node scripts/sync.mjs           # 写入
//   node scripts/sync.mjs --check   # 只检查是否一致（CI 用）
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { config, copyDir, flag, paths, platformPackageName } from './lib/config.mjs';

const check = flag('check');
const problems = [];
// 比较时忽略换行风格：Windows 上 git 可能以 CRLF 检出（仓库已用 .gitattributes 固定 LF，这里再兜一层）。
const lf = (text) => text.replace(/\r\n/g, '\n');

function updateJSON(file, mutate) {
  const before = readFileSync(file, 'utf8');
  const value = JSON.parse(before);
  mutate(value);
  const after = `${JSON.stringify(value, null, 2)}\n`;
  if (after !== lf(before)) {
    problems.push(relative(paths.root, file));
    if (!check) writeFileSync(file, after);
  }
}

const repo = { type: 'git', url: `git+${config.repositoryUrl}.git` };

updateJSON(join(paths.cli, 'package.json'), (pkg) => {
  pkg.name = config.cliPackage;
  pkg.version = config.version;
  pkg.repository = { ...repo, directory: 'packages/app-cli' };
  pkg.optionalDependencies = Object.fromEntries(config.platforms.map((p) => [platformPackageName(p), config.version]));
});

updateJSON(join(paths.sdk, 'package.json'), (pkg) => {
  pkg.name = config.sdkPackage;
  pkg.version = config.version;
  pkg.repository = { ...repo, directory: 'packages/app-sdk' };
});

// 模板代码里 SDK 的导入路径跟随包名
for (const rel of ['src/cloud/client.ts']) {
  const file = join(paths.template, rel);
  const before = readFileSync(file, 'utf8');
  const after = before.replace(/from '(@[\w-]+\/)?[\w-]*app-sdk'/g, `from '${config.sdkPackage}'`);
  if (lf(after) !== lf(before)) {
    problems.push(relative(paths.root, file));
    if (!check) writeFileSync(file, after);
  }
}

// create-zleap-app 无 scope，版本独立（createVersion，缺省跟随 version）：CLI/SDK 不重编时也能单独重发脚手架。
updateJSON(join(paths.create, 'package.json'), (pkg) => {
  pkg.name = config.createPackage;
  pkg.version = config.createVersion ?? config.version;
  pkg.repository = { ...repo, directory: 'packages/create-zleap-app' };
  pkg.zleapKit = { cliPackage: config.cliPackage, cliVersion: config.version, sdkPackage: config.sdkPackage, sdkVersion: config.version, skillsRepo: config.skillsRepo };
});

// skills → create-zleap-app/skills（npm 包里随附，脚手架离线可装）
const skillNames = readdirSync(paths.skills).filter((name) => existsSync(join(paths.skills, name, 'SKILL.md')));
const bundled = join(paths.create, 'skills');
const same = (a, b) => {
  if (!existsSync(b)) return false;
  const list = (dir) =>
    readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => relative(dir, join(entry.parentPath ?? entry.path, entry.name)))
      .sort();
  const left = list(a);
  const right = list(b);
  const content = (file) => {
    const bytes = readFileSync(file);
    return bytes.includes(0) ? bytes.toString('latin1') : lf(bytes.toString('utf8'));
  };
  return left.length === right.length && left.every((file, i) => file === right[i] && content(join(a, file)) === content(join(b, file)));
};
for (const name of skillNames) {
  if (!same(join(paths.skills, name), join(bundled, name))) {
    problems.push(`packages/create-zleap-app/skills/${name}`);
    if (!check) {
      rmSync(join(bundled, name), { recursive: true, force: true });
      copyDir(join(paths.skills, name), join(bundled, name));
    }
  }
}
if (existsSync(bundled)) {
  for (const name of readdirSync(bundled)) {
    if (!skillNames.includes(name)) {
      problems.push(`packages/create-zleap-app/skills/${name}（多余）`);
      if (!check) rmSync(join(bundled, name), { recursive: true, force: true });
    }
  }
}

// Claude Code 插件市场清单（/plugin marketplace add <repo>）
updateJSON(join(paths.root, '.claude-plugin', 'marketplace.json'), (market) => {
  market.metadata = { ...(market.metadata ?? {}), version: config.version };
  for (const plugin of market.plugins ?? []) plugin.version = config.version;
});

if (check) {
  if (problems.length) {
    console.error(`与 kit.config.json / skills 不一致：\n  ${problems.join('\n  ')}\n运行 npm run sync 修复。`);
    process.exit(1);
  }
  console.log('包名、版本与随附 skills 一致');
} else {
  console.log(problems.length ? `已更新：\n  ${problems.join('\n  ')}` : '无需更新');
}
