#!/usr/bin/env node
// 把云开发文档站（zleap-web/apps/docs，VitePress）里已与代码核对过的页面，转换成 skills 的 references/*.md。
// 文档站是事实源；skills 只放精简工作流 + 这些参考资料，避免两份说明互相漂移。
//
//   node scripts/sync-skill-references.mjs --docs ../zleap-web/apps/docs
//   node scripts/sync-skill-references.mjs --docs ../zleap-web/apps/docs --check
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { arg, flag, paths } from './lib/config.mjs';

const docs = resolve(arg('docs', join(paths.root, '..', 'zleap-web', 'apps', 'docs')));
const check = flag('check');

/** skill → { 参考文件名: 文档站页面路径 } */
const MAP = {
  'zleap-cloud-app': {
    'manifest.md': 'reference/manifest.md',
    'sdk-database-files.md': 'reference/database-api.md',
    'cloud-functions.md': 'reference/cloud-function.md',
    'triggers.md': 'reference/triggers.md',
    'permissions.md': 'reference/permissions.md',
    'status-codes.md': 'reference/status-codes.md',
    'limits.md': 'reference/limits.md',
    'console-database.md': 'console/database.md',
    'console-members.md': 'console/members.md',
    'app-runtime.md': 'reference/app-runtime.md',
  },
  'zleap-cloud-app-release': {
    'dev-to-production.md': 'guide/dev-to-production.md',
    'console-release.md': 'console/release.md',
    'console-functions.md': 'console/functions.md',
    'console-workspace.md': 'console/workspace.md',
    'console-members.md': 'console/members.md',
    'app-center-publish.md': 'app-center/publish.md',
    'app-center-install.md': 'app-center/install.md',
    'permissions.md': 'reference/permissions.md',
    'status-codes.md': 'reference/status-codes.md',
  },
};

const LABEL = { tip: '提示', info: '说明', warning: '注意', danger: '危险', details: '详情' };

/** 站内链接 → 同一 skill 内的参考文件；不在本 skill 里的页面改成「文档站 <路径>」纯文本。 */
function rewriteLinks(text, files) {
  const byPage = Object.fromEntries(Object.entries(files).map(([ref, page]) => [page.replace(/\.md$/, ''), ref]));
  return text.replace(/\[([^\]]+)\]\(((?:\/|\.\/|\.\.\/)[^)\s]*)\)/g, (_match, label, href) => {
    const [path, hash = ''] = href.split('#');
    let page = path.replace(/^\//, '').replace(/\.md$/, '');
    if (href.startsWith('./') || href.startsWith('../')) page = null; // 相对链接在下面按文件名匹配
    const target =
      (page && byPage[page]) ||
      Object.entries(byPage).find(([key]) => key.endsWith(`/${path.replace(/^\.{1,2}\//, '').replace(/\.md$/, '')}`))?.[1];
    if (target) return `[${label}](${target}${hash ? `#${hash}` : ''})`;
    return `${label}（文档站 ${path}${hash ? `#${hash}` : ''}）`;
  });
}

/** VitePress 容器 ::: type 标题 … ::: → 引用块。 */
function rewriteContainers(text) {
  const out = [];
  let inside = false;
  let fence = false;
  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) fence = !fence;
    if (!fence) {
      const open = /^:::\s*(tip|info|warning|danger|details)\s*(.*)$/.exec(line);
      if (open && !inside) {
        inside = true;
        out.push(`> **${open[2].trim() || LABEL[open[1]]}**（${LABEL[open[1]]}）`, '>');
        continue;
      }
      if (line.trim() === ':::' && inside) {
        inside = false;
        continue;
      }
    }
    out.push(inside ? (line ? `> ${line}` : '>') : line);
  }
  return out.join('\n');
}

/** 文档截图对 AI 编程工具没有用，图片 ![说明](/images/…) 换成一行文字说明。 */
function rewriteImages(text) {
  return text.replace(/!\[([^\]]*)\]\((?:\/|\.\/|\.\.\/)[^)\s]*\)/g, (_match, alt) => `（截图：${alt || '界面截图'}，见文档站）`);
}

function convert(page, files) {
  // 先统一成 LF：Windows 上文档站或 skills 可能以 CRLF 检出
  const source = readFileSync(join(docs, page), 'utf8').replace(/\r\n/g, '\n').replace(/^---\n[\s\S]*?\n---\n/, '');
  const body = rewriteLinks(rewriteContainers(rewriteImages(source)), files);
  return `<!-- 由 zleap-app-kit/scripts/sync-skill-references.mjs 从云开发文档站 ${page} 生成，请改文档站后重新同步 -->\n\n${body.trim()}\n`;
}

if (!existsSync(join(docs, '.vitepress'))) {
  console.error(`找不到文档站：${docs}（用 --docs 指定 zleap-web/apps/docs）`);
  process.exit(1);
}

const drift = [];
for (const [skill, files] of Object.entries(MAP)) {
  const dir = join(paths.skills, skill, 'references');
  const expected = Object.fromEntries(Object.entries(files).map(([ref, page]) => [ref, convert(page, files)]));
  for (const [ref, content] of Object.entries(expected)) {
    const file = join(dir, ref);
    if (!existsSync(file) || readFileSync(file, 'utf8').replace(/\r\n/g, '\n') !== content) drift.push(`${skill}/${ref}`);
  }
  const extra = existsSync(dir) ? readdirSync(dir).filter((name) => !(name in expected)) : [];
  drift.push(...extra.map((name) => `${skill}/${name}（多余）`));
  if (!check) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    for (const [ref, content] of Object.entries(expected)) writeFileSync(join(dir, ref), content);
  }
}

if (check) {
  if (drift.length) {
    console.error(`skills 参考资料与文档站不一致：\n  ${drift.join('\n  ')}\n运行 node scripts/sync-skill-references.mjs 同步。`);
    process.exit(1);
  }
  console.log('skills 参考资料与文档站一致');
} else {
  console.log(`已同步 skills 参考资料${drift.length ? `（变更 ${drift.length} 个文件）` : '（无变化）'}`);
}
