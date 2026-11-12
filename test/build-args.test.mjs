import assert from 'node:assert/strict';
import test from 'node:test';
import { GO_BUILD_ARGS, goBuildArgs } from '../scripts/lib/fingerprint.mjs';

test('build-cli 把 kit.config 的 cliVersion 注入 appdevcli.Version，指纹模板不随版本变', () => {
  const args = goBuildArgs('0.12.2');
  assert.ok(args.some((a) => a.includes('-X zleap-os-go/internal/appdevcli.Version=0.12.2')), args.join(' '));
  assert.ok(GO_BUILD_ARGS.some((a) => a.includes('{cliVersion}')));
  assert.ok(!args.some((a) => a.includes('appdevcli.Commit=')), '不注入 Commit');
  assert.throws(() => goBuildArgs(undefined));
});

test('build-cli 把源码提交号注入 appdevcli.SourceCommit，只用于展示（实测 #9）', () => {
  const args = goBuildArgs('0.12.2', 'bd3c8c0');
  assert.ok(args.some((a) => a.includes('-X zleap-os-go/internal/appdevcli.SourceCommit=bd3c8c0')), args.join(' '));
  assert.ok(GO_BUILD_ARGS.some((a) => a.includes('{sourceCommit}')), '指纹模板不随提交号变');
  assert.ok(goBuildArgs('0.12.2').some((a) => a.includes('SourceCommit=unknown')));
  assert.throws(() => goBuildArgs('0.12.2', 'x; rm -rf /'));
});
