// 构建 CLI 前核对 Go 源码是不是最新的（2026-11-15）。
//
// npm 上的 0.12.11 用一份落后的 zleap-service 检出编译（3a40affb，比源码导出功能 89dc81bf 早一小时），
// 发出去的 CLI 没有 source 命令、deploy 也不附带快照，脚本没有任何提示。这里在编译前确认：
//   1. 源码 HEAD 包含 origin/main（先 fetch；落后时报出缺几个提交）；
//   2. CLI 依赖到的目录（go list -deps ./cmd/zleap-app）和 go.mod / go.sum 没有未提交的改动——
//      否则二进制里的代码和记录的提交号对不上。仓库里别的目录有改动不影响。
import { execFileSync } from 'node:child_process';
import { relative, sep } from 'node:path';

function git(source, ...args) {
  return execFileSync('git', ['-C', source, '--no-optional-locks', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** ./cmd/zleap-app 依赖到的本仓库目录（相对 source，/ 分隔）。 */
export function cliDependencyDirs(source, go = 'go') {
  const out = execFileSync(go, ['list', '-deps', '-f', '{{if not .Standard}}{{.Dir}}{{end}}', './cmd/zleap-app'], {
    cwd: source,
    encoding: 'utf8',
    env: { ...process.env, CGO_ENABLED: '0', GOFLAGS: '-buildvcs=false' },
  });
  return out
    .split('\n')
    .filter(Boolean)
    .map((dir) => relative(source, dir).split(sep).join('/'))
    .filter((dir) => dir !== '' && !dir.startsWith('..'));
}

/**
 * @param {string} source zleap-service 检出目录
 * @param {{ fetch?: boolean, dependencyDirs: string[], branch?: string }} options
 * @returns {{ ok: boolean, commit: string, upstream: string, reasons: string[] }}
 */
export function checkSourceFreshness(source, { fetch = true, dependencyDirs, branch = 'main' }) {
  const reasons = [];
  let commit = '';
  let upstream = '';
  try {
    commit = git(source, 'rev-parse', '--short', 'HEAD');
  } catch {
    return { ok: false, commit, upstream, reasons: [`${source} 不是 git 检出，无法确认源码版本`] };
  }
  if (fetch) {
    try {
      git(source, 'fetch', '--quiet', 'origin', branch);
    } catch (error) {
      reasons.push(`git fetch origin ${branch} 失败，无法确认源码是最新的：${String(error.stderr || error.message).trim().split('\n')[0]}`);
    }
  }
  try {
    upstream = git(source, 'rev-parse', '--short', `origin/${branch}`);
    try {
      git(source, 'merge-base', '--is-ancestor', `origin/${branch}`, 'HEAD');
    } catch {
      const missing = git(source, 'rev-list', '--count', `HEAD..origin/${branch}`);
      reasons.push(`源码 HEAD ${commit} 落后于 origin/${branch} ${upstream}（缺 ${missing} 个提交）：先更新到 origin/${branch} 再构建`);
    }
  } catch {
    reasons.push(`找不到 origin/${branch}，无法确认源码是最新的`);
  }
  const dirs = new Set(dependencyDirs);
  const dirty = git(source, 'status', '--porcelain', '--untracked-files=all')
    .split('\n')
    .filter(Boolean)
    .map((line) => line.slice(3).split(' -> ').at(-1).replace(/^"|"$/g, ''))
    .filter((file) => {
      if (file === 'go.mod' || file === 'go.sum') return true;
      const dir = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '';
      return dirs.has(dir) && !file.endsWith('_test.go');
    });
  if (dirty.length > 0) {
    reasons.push(`CLI 用到的源码有未提交的改动（二进制会和提交号 ${commit} 对不上）：${dirty.slice(0, 8).join('、')}${dirty.length > 8 ? ` 等 ${dirty.length} 个` : ''}`);
  }
  return { ok: reasons.length === 0, commit, upstream, reasons };
}
