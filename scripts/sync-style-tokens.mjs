#!/usr/bin/env node
// 把 zleapOS 平台设计 token 同步进应用官方样式 zleap.css 的 tokens 段，保证外部应用与桌面同色。
//
//   node scripts/sync-style-tokens.mjs --tokens ../zleap-web/packages/ui/src/styles/tokens.generated.css \
//        --css ../zleap-service/internal/appdevcli/sdksrc/zleap.css            # 写入
//   …同上… --check                                                                           # 只校验，不一致时退出码 1
//
// 只取应用需要的语义 token（颜色、阴影、圆角、字号），primitive 变量（--p-*）解析成具体值，应用里不依赖平台私有变量名。
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { arg, flag } from './lib/config.mjs';

/** 应用变量 → 平台 token。 */
export const MAP = {
  accent: 'accent',
  'accent-text': 'accent-text',
  'accent-subtle': 'accent-subtle',
  danger: 'danger',
  success: 'success',
  warning: 'warning',
  bg: 'surface-panel',
  surface: 'surface-2',
  ink: 'ink',
  'ink-muted': 'ink-muted',
  'ink-faint': 'ink-faint',
  line: 'line',
  'line-strong': 'line-strong',
  shadow: 'shadow-widget',
  'radius-sm': 'radius-sm',
  'radius-md': 'radius-md',
  'radius-lg': 'radius-lg',
  'radius-xl': 'radius-xl',
  'font-xs': 'font-xs',
  'font-sm': 'font-sm',
  'font-base': 'font-base',
  'font-lg': 'font-lg',
  'font-xl': 'font-xl',
};

/** 取某个选择器块里的 --name: value。 */
function block(css, selector) {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`token 文件里没有 ${selector}`);
  const end = css.indexOf('\n}', start);
  const out = {};
  for (const m of css.slice(start, end).matchAll(/--([\w-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

export function buildTokens(tokenCss) {
  const light = block(tokenCss, ':root');
  const dark = { ...light, ...block(tokenCss, ":root[data-theme='dark']") };
  const resolveValue = (value, scope) =>
    value.replace(/var\(--([\w-]+)\)/g, (all, name) => {
      if (scope[name] === undefined) throw new Error(`无法解析 ${all}`);
      return resolveValue(scope[name], scope);
    });
  const pick = (scope, onlyChanged) =>
    Object.entries(MAP)
      .filter(([, token]) => {
        if (scope[`ds-${token}`] === undefined) throw new Error(`平台 token 缺少 --ds-${token}`);
        return !onlyChanged || resolveValue(scope[`ds-${token}`], scope) !== resolveValue(light[`ds-${token}`], light);
      })
      .map(([name, token]) => `  --zl-${name}: ${resolveValue(scope[`ds-${token}`], scope)};`);
  const darkLines = pick(dark, true);
  return [
    '/* tokens:begin */',
    ':root {',
    ...pick(light, false),
    '}',
    "/* 暗色：跟随 zleapOS（宿主把主题设到应用窗口，prefers-color-scheme 随之变化）；页面也可以自己设 data-theme。 */",
    "@media (prefers-color-scheme: dark) {",
    "  :root:not([data-theme='light']) {",
    ...darkLines.map((line) => `  ${line}`),
    '  }',
    '}',
    ":root[data-theme='dark'] {",
    ...darkLines,
    '}',
    '/* tokens:end */',
  ].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const tokensPath = arg('tokens');
  const cssPath = arg('css');
  if (!tokensPath || !cssPath) {
    console.error('用法：node scripts/sync-style-tokens.mjs --tokens <tokens.generated.css> --css <zleap.css> [--check]');
    process.exit(1);
  }
  const css = readFileSync(resolve(cssPath), 'utf8');
  const next = css.replace(/\/\* tokens:begin \*\/[\s\S]*?\/\* tokens:end \*\//, buildTokens(readFileSync(resolve(tokensPath), 'utf8')));
  if (!next.includes('/* tokens:begin */')) throw new Error('zleap.css 缺少 tokens:begin / tokens:end 标记');
  if (flag('check')) {
    if (next !== css) {
      console.error('zleap.css 的 tokens 段与平台设计 token 不一致，运行 node scripts/sync-style-tokens.mjs（去掉 --check）同步。');
      process.exit(1);
    }
    console.log('zleap.css 与平台设计 token 一致');
  } else {
    writeFileSync(resolve(cssPath), next);
    console.log(next === css ? 'zleap.css 已是最新' : '已同步 zleap.css 的 tokens 段');
  }
}
