import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { checkSourceFreshness } from '../scripts/lib/source-check.mjs';

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function repos() {
  const root = mkdtempSync(join(tmpdir(), 'kit-source-'));
  const origin = join(root, 'origin.git');
  const work = join(root, 'work');
  const other = join(root, 'other');
  execFileSync('git', ['init', '--quiet', '--bare', '-b', 'main', origin]);
  execFileSync('git', ['clone', '--quiet', origin, work], { stdio: 'ignore' });
  mkdirSync(join(work, 'internal', 'appdevcli'), { recursive: true });
  mkdirSync(join(work, 'internal', 'bitable'), { recursive: true });
  writeFileSync(join(work, 'internal', 'appdevcli', 'run.go'), 'package appdevcli\n');
  writeFileSync(join(work, 'internal', 'bitable', 'b.go'), 'package bitable\n');
  writeFileSync(join(work, 'go.mod'), 'module x\n');
  git(work, 'add', '.');
  git(work, 'commit', '--quiet', '-m', 'init');
  git(work, 'branch', '-M', 'main');
  git(work, 'push', '--quiet', 'origin', 'main');
  execFileSync('git', ['clone', '--quiet', origin, other], { stdio: 'ignore' });
  return { work, other };
}

const deps = ['internal/appdevcli'];

test('源码与 origin/main 一致、CLI 目录干净：可以构建', () => {
  const { work } = repos();
  const result = checkSourceFreshness(work, { dependencyDirs: deps });
  assert.equal(result.ok, true, result.reasons.join('；'));
});

test('别人推了新提交、本地检出没更新（0.12.11 的情况）：拒绝并说明缺几个提交', () => {
  const { work, other } = repos();
  writeFileSync(join(other, 'internal', 'appdevcli', 'source.go'), 'package appdevcli\n');
  git(other, 'add', '.');
  git(other, 'commit', '--quiet', '-m', 'source export');
  git(other, 'push', '--quiet', 'origin', 'main');
  // 不 fetch 时本地的 origin/main 还是旧的，看不出落后（所以检查要先 fetch）
  assert.equal(checkSourceFreshness(work, { dependencyDirs: deps, fetch: false }).ok, true);
  const result = checkSourceFreshness(work, { dependencyDirs: deps });
  assert.equal(result.ok, false);
  assert.match(result.reasons.join('\n'), /落后于 origin\/main .*缺 1 个提交/);
});

test('CLI 用到的代码有未提交改动时拒绝；无关目录、测试文件的改动不影响', () => {
  const { work } = repos();
  writeFileSync(join(work, 'internal', 'bitable', 'b.go'), 'package bitable // 别人的改动\n');
  writeFileSync(join(work, 'internal', 'appdevcli', 'run_test.go'), 'package appdevcli\n');
  assert.equal(checkSourceFreshness(work, { dependencyDirs: deps }).ok, true);
  writeFileSync(join(work, 'internal', 'appdevcli', 'fn.go'), 'package appdevcli\n');
  const result = checkSourceFreshness(work, { dependencyDirs: deps });
  assert.equal(result.ok, false);
  assert.match(result.reasons.join('\n'), /未提交的改动.*internal\/appdevcli\/fn\.go/);
});
