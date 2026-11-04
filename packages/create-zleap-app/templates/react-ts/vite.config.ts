import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/** 列出目录下的全部文件（相对 root 的路径，用 / 分隔）。 */
function listFiles(dir: string, root: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path, root) : [relative(root, path).split('\\').join('/')];
  });
}

/**
 * 把构建产物整理成 zleapOS 应用包根目录：dist/ 下必须直接有 manifest.json、LICENSE 和入口 HTML。
 * 项目里有 cloudfunctions/（云函数源码）时原样复制进 dist/，manifest 里的 functions[].entry 按包根目录解析。
 * 同时拦截在沙箱里一定会失败的写法（外链脚本/样式/字体，CSP 只允许包内资源）。
 */
function zleapPackage(): Plugin {
  const root = process.cwd();
  return {
    name: 'zleap-package',
    apply: 'build',
    generateBundle(_options, bundle) {
      const manifestText = readFileSync(resolve(root, 'manifest.json'), 'utf8');
      const manifest = JSON.parse(manifestText) as { runtime?: { ui?: { entry?: string } } };
      const entry = manifest.runtime?.ui?.entry;
      if (entry !== 'index.html') {
        this.error(`manifest.json 的 runtime.ui.entry 应为 "index.html"（当前：${String(entry)}），与 Vite 的入口保持一致`);
      }
      this.emitFile({ type: 'asset', fileName: 'manifest.json', source: manifestText });
      this.emitFile({ type: 'asset', fileName: 'LICENSE', source: readFileSync(resolve(root, 'LICENSE'), 'utf8') });
      const functions = resolve(root, 'cloudfunctions');
      if (existsSync(functions)) {
        for (const file of listFiles(functions, root)) {
          if (file.includes('/node_modules/')) continue; // 运行时自带 @zleap/app-cloud-server，不要打包依赖
          this.emitFile({ type: 'asset', fileName: file, source: readFileSync(resolve(root, file)) });
        }
      }

      for (const file of Object.values(bundle)) {
        if (file.type !== 'asset' || !file.fileName.endsWith('.html')) continue;
        const html = String(file.source);
        const external = html.match(/<(?:script|link)[^>]+(?:src|href)=["'](?:https?:)?\/\/[^"']+/gi);
        if (external) {
          this.error(`应用运行在 connect-src 'none' 的沙箱里，不能引用外部资源：\n${external.join('\n')}`);
        }
      }
    },
  };
}

export default defineConfig({
  // 应用包通过 /app-packages/runtime/<token>/ 下的相对路径加载，必须用相对 base。
  base: './',
  plugins: [react(), zleapPackage()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    // 沙箱禁止 fetch（connect-src 'none'），不要注入用 fetch 实现的 modulepreload polyfill。
    modulePreload: { polyfill: false },
  },
});
