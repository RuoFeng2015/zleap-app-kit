// 源码指纹：判断「和 npm 上已发布的版本相比，有没有真的变」，不用先编译。
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { config, sdkSourceDir } from './config.mjs';

/** build-cli 的编译参数。改了它二进制就变，所以也算进 CLI 指纹。 */
export const GO_BUILD_ARGS = ['build', '-trimpath', '-ldflags=-s -w'];

/**
 * zleap-app 的源码指纹：所有平台下 ./cmd/zleap-app 依赖到的本仓库包（源文件 + embed 文件）、第三方模块版本、Go 版本、编译参数。
 * 刻意排除内嵌的 SDK 目录：SDK 自己一条版本线，只改 SDK 不触发 CLI 发版（CLI 里那份 SDK 参考下次 CLI 发版时跟上）。
 */
export function cliSourceDigest(source, go = 'go') {
  const sdkDir = sdkSourceDir(source);
  const lines = new Set([`go ${execFileSync(go, ['env', 'GOVERSION'], { cwd: source, encoding: 'utf8' }).trim()}`, `args ${GO_BUILD_ARGS.join(' ')}`]);
  const files = new Set();
  const format = '{{.Dir}}\t{{with .Module}}{{.Path}}@{{.Version}}{{if .Main}} main{{end}}{{with .Replace}}=>{{.Path}}@{{.Version}}{{end}}{{end}}\t{{join .EmbedFiles "\\n"}}\x1e';
  for (const platform of config.platforms) {
    for (const goarch of platform.goarch) {
      const out = execFileSync(go, ['list', '-deps', '-f', `{{if not .Standard}}${format}{{end}}`, './cmd/zleap-app'], {
        cwd: source,
        encoding: 'utf8',
        env: { ...process.env, CGO_ENABLED: '0', GOOS: platform.goos, GOARCH: goarch, GOFLAGS: '-buildvcs=false' },
      });
      for (const record of out.split('\x1e')) {
        const [dir, module = '', embeds = ''] = record.trim().split('\t');
        if (!dir) continue;
        const local = module.endsWith(' main') || /=>(\.|\/)/.test(module);
        if (!local) {
          lines.add(`mod ${module}`);
          continue;
        }
        for (const name of readdirSync(dir)) {
          if (name.endsWith('_test.go') || !statSync(join(dir, name)).isFile()) continue;
          files.add(join(dir, name));
        }
        for (const name of embeds.split('\n').filter(Boolean)) files.add(join(dir, name));
      }
    }
  }
  for (const name of ['go.mod', 'go.sum']) if (existsSync(join(source, name))) files.add(join(source, name));
  const hash = createHash('sha256');
  for (const line of [...lines].sort()) hash.update(line).update('\n');
  for (const file of [...files].sort()) {
    if (file.startsWith(sdkDir + sep)) continue;
    hash.update(relative(source, file).split(sep).join('/')).update('\0').update(readFileSync(file)).update('\0');
  }
  return hash.digest('hex');
}
