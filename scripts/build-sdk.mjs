#!/usr/bin/env node
// 构建 @zleap-ai/app-sdk：从 zleap-app CLI 内嵌的公开 SDK（事实源）打包、压缩、混淆标识符。
//
//   node scripts/build-sdk.mjs --source ../zleap-service           # 构建到 packages/app-sdk/dist
//   node scripts/build-sdk.mjs --source ../zleap-service --check   # 只校验 dist 是否由当前源码构建
//
// 可读源码只存在于私有仓库，本仓库（公开）只提交包壳；dist/ 不入库，发布前在本地构建。
// 混淆范围：去注释、压缩、改写局部与模块内标识符。属性名不改——它们是与宿主之间的消息协议和数据字段。
// 产物禁止 eval / new Function / 动态 import（应用沙箱 CSP 不允许），构建后自动检查。
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { arg, config, flag, paths } from './lib/config.mjs';

const source = resolve(arg('source', join(paths.root, '..', 'zleap-service')));
const from = join(source, 'internal', 'appdevcli', 'templates', 'todo', 'sdk');
const dist = join(paths.sdk, 'dist');
const check = flag('check');

/** 包入口 → 源文件。三个入口彼此独立（宿主 SDK 与工作区模块本身零 import）。 */
export const ENTRIES = { index: 'index.js', host: 'zleap-sdk.js', workspace: 'workspace.js' };

if (!existsSync(from)) {
  console.error(`找不到 SDK 源目录：${from}\n用 --source 指向 zleap-service 仓库。`);
  process.exit(1);
}

const sourceFiles = readdirSync(from)
  .filter((name) => name.endsWith('.js') || name.endsWith('.d.ts'))
  .sort();
const sourceDigest = createHash('sha256');
for (const name of sourceFiles) sourceDigest.update(name).update('\0').update(readFileSync(join(from, name)));
const digest = sourceDigest.digest('hex');

const infoFile = join(dist, 'build-info.json');
if (check) {
  const info = existsSync(infoFile) ? JSON.parse(readFileSync(infoFile, 'utf8')) : null;
  if (!info || info.source !== digest || info.version !== config.version) {
    console.error('packages/app-sdk/dist 不是由当前 SDK 源码 / 版本构建的，运行 npm run build:sdk。');
    process.exit(1);
  }
  console.log(`SDK 产物与源码一致（${sourceFiles.length} 个源文件，版本 ${config.version}）`);
  process.exit(0);
}

let esbuild;
try {
  esbuild = await import('esbuild');
} catch {
  console.error('缺少 esbuild：在 zleap-app-kit 根目录运行 npm install。');
  process.exit(1);
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, 'types'), { recursive: true });

const banner = `/*! ${config.sdkPackage} v${config.version} | (c) ${new Date().getFullYear()} Zleap | 专有许可，仅限在 zleapOS 应用中使用，见 LICENSE */`;
const result = await esbuild.build({
  entryPoints: Object.fromEntries(Object.entries(ENTRIES).map(([out, file]) => [out, join(from, file)])),
  outdir: dist,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2020',
  minify: true,
  legalComments: 'none',
  charset: 'utf8',
  sourcemap: false,
  treeShaking: true,
  banner: { js: banner },
  metafile: true,
  logLevel: 'warning',
});

// 类型声明保持可读：开发者与 AI 编程工具靠它理解 API。
for (const name of sourceFiles.filter((file) => file.endsWith('.d.ts'))) {
  copyFileSync(join(from, name), join(dist, 'types', name));
}

const forbidden = [
  [/\beval\s*\(/, 'eval('],
  [/\bnew\s+Function\s*\(/, 'new Function('],
  [/(^|[^.\w$])Function\s*\(/, 'Function('],
  [/\bimport\s*\(/, '动态 import('],
  [/sourceMappingURL/, 'sourceMappingURL'],
];
const outputs = {};
for (const out of Object.keys(ENTRIES)) {
  const file = join(dist, `${out}.js`);
  const code = readFileSync(file, 'utf8');
  for (const [pattern, label] of forbidden) {
    if (pattern.test(code)) {
      console.error(`${out}.js 含有 ${label}，不符合应用沙箱 CSP，停止。`);
      process.exit(1);
    }
  }
  if (/\/\/ |\/\*(?!!)/.test(code.replace(/(["'`])(?:\\.|(?!\1)[^\\])*\1/g, '""').replace(/\/(?![*/])(?:\\.|\[(?:\\.|[^\]])*\]|[^/\\\n])+\/[a-z]*/g, '0'))) {
    console.warn(`提示：${out}.js 里可能残留注释，请检查。`);
  }
  outputs[out] = { bytes: Buffer.byteLength(code), sha256: createHash('sha256').update(code).digest('hex') };
}

writeFileSync(
  infoFile,
  `${JSON.stringify({ package: config.sdkPackage, version: config.version, source: digest, files: sourceFiles.length, outputs }, null, 2)}\n`,
);
const inputBytes = Object.values(result.metafile.inputs).reduce((sum, input) => sum + input.bytes, 0);
const outputBytes = Object.values(outputs).reduce((sum, output) => sum + output.bytes, 0);
console.log(
  `已构建 ${config.sdkPackage}@${config.version}：${Object.keys(ENTRIES)
    .map((out) => `${out}.js ${(outputs[out].bytes / 1024).toFixed(1)}KB`)
    .join('，')}（源码 ${(inputBytes / 1024).toFixed(1)}KB → ${(outputBytes / 1024).toFixed(1)}KB）`,
);
