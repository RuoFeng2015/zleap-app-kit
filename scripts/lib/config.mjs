// 读取 kit.config.json 及常用路径。所有构建/发布脚本共用。
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const config = JSON.parse(readFileSync(join(root, 'kit.config.json'), 'utf8'));

export const paths = {
  root,
  cli: join(root, 'packages', 'app-cli'),
  sdk: join(root, 'packages', 'app-sdk'),
  create: join(root, 'packages', 'create-zleap-app'),
  template: join(root, 'packages', 'create-zleap-app', 'templates', 'react-ts'),
  skills: join(root, 'skills'),
  npm: join(root, 'npm'),
};

export function platformSuffix(platform) {
  return platform.key;
}

export function platformPackageName(platform) {
  return `${config.cliPackage}-${platformSuffix(platform)}`;
}

export function platformDir(platform) {
  return join(paths.npm, `app-cli-${platformSuffix(platform)}`);
}

export function readJSON(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** SDK 事实源目录（CLI 内嵌的公开 SDK）。build-sdk 打包它，CLI 二进制也把它编进去。 */
export function sdkSourceDir(source) {
  return join(source, 'internal', 'appdevcli', 'templates', 'todo', 'sdk');
}

/** SDK 源码指纹：build-sdk 记进 dist/build-info.json，build-cli 记进 checksums.json，发布时用来比较两者是否同一份。 */
export function sdkSourceDigest(dir, style = 'zleap.css') {
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.js') || name.endsWith('.d.ts') || name === style)
    .sort();
  const hash = createHash('sha256');
  for (const name of files) hash.update(name).update('\0').update(readFileSync(join(dir, name)));
  return { files, digest: hash.digest('hex') };
}

/** 递归复制目录（不保留源目录权限位；某些网络/虚拟文件系统上 fs.cpSync 会因权限位失败）。 */
export function copyDir(from, to) {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const source = join(from, entry.name);
    const target = join(to, entry.name);
    if (entry.isDirectory()) copyDir(source, target);
    else if (entry.isFile()) copyFileSync(source, target);
  }
}

export function arg(name, fallback = undefined) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  return value === undefined || value.startsWith('--') ? true : value;
}

export function flag(name) {
  return process.argv.includes(`--${name}`);
}
