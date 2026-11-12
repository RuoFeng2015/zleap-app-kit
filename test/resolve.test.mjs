import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { resolveBinary, platformPackage, BinaryNotFoundError, SUPPORTED } = require('../packages/app-cli/lib/resolve.js');
const shim = fileURLToPath(new URL('../packages/app-cli/bin/zleap-app.js', import.meta.url));

function fakePlatformPackage(withBinary = true) {
  const dir = mkdtempSync(join(tmpdir(), 'zleap-cli-'));
  mkdirSync(join(dir, 'bin'));
  writeFileSync(join(dir, 'package.json'), '{}');
  if (withBinary) {
    writeFileSync(join(dir, 'bin', 'zleap-app'), '#!/bin/sh\necho "args:$*"\necho "err" >&2\nexit 3\n');
    chmodSync(join(dir, 'bin', 'zleap-app'), 0o755);
  }
  return dir;
}

test('平台包命名跟随主包名', () => {
  assert.equal(platformPackage('darwin', 'arm64'), '@zleap-ai/app-cli-darwin');
  assert.equal(platformPackage('linux', 'arm64'), '@zleap-ai/app-cli-linux-arm64');
  assert.equal(platformPackage('win32', 'x64'), '@zleap-ai/app-cli-win32-x64');
});

test('macOS 两种架构共用通用二进制，Windows on ARM 用 x64 包', () => {
  assert.equal(platformPackage('darwin', 'x64'), platformPackage('darwin', 'arm64'));
  assert.equal(platformPackage('win32', 'arm64'), '@zleap-ai/app-cli-win32-x64');
  const dir = fakePlatformPackage();
  const found = resolveBinary({
    env: {},
    platform: 'darwin',
    arch: 'x64',
    resolve: (id) => {
      assert.equal(id, '@zleap-ai/app-cli-darwin/package.json');
      return join(dir, 'package.json');
    },
  });
  assert.equal(found, join(dir, 'bin', 'zleap-app'));
});

test('主包的 optionalDependencies 覆盖每个受支持平台要用的包', () => {
  const { optionalDependencies } = require('../packages/app-cli/package.json');
  for (const key of SUPPORTED) {
    const [platform, arch] = key.split('-');
    assert.ok(platformPackage(platform, arch) in optionalDependencies, key);
  }
});

test('按平台解析二进制', () => {
  const dir = fakePlatformPackage();
  const found = resolveBinary({
    env: {},
    platform: 'linux',
    arch: 'x64',
    resolve: (id) => {
      assert.equal(id, '@zleap-ai/app-cli-linux-x64/package.json');
      return join(dir, 'package.json');
    },
  });
  assert.equal(found, join(dir, 'bin', 'zleap-app'));
});

test('缺平台包、缺二进制、不支持的平台都给出可操作的错误', () => {
  const missing = () => {
    throw new Error('not found');
  };
  assert.throws(() => resolveBinary({ env: {}, platform: 'linux', arch: 'x64', resolve: missing }), (e) => e instanceof BinaryNotFoundError && /optional/.test(e.message));
  const empty = fakePlatformPackage(false);
  assert.throws(() => resolveBinary({ env: {}, platform: 'linux', arch: 'x64', resolve: () => join(empty, 'package.json') }), /缺少可执行文件/);
  assert.throws(() => resolveBinary({ env: {}, platform: 'freebsd', arch: 'x64', resolve: missing }), /ZLEAP_APP_BINARY/);
});

test('ZLEAP_APP_BINARY 覆盖', () => {
  const dir = fakePlatformPackage();
  assert.equal(resolveBinary({ env: { ZLEAP_APP_BINARY: join(dir, 'bin', 'zleap-app') } }), join(dir, 'bin', 'zleap-app'));
  assert.throws(() => resolveBinary({ env: { ZLEAP_APP_BINARY: '/nope/zleap-app' } }), /不存在/);
});

test('入口透传参数、标准输出与退出码', { skip: process.platform === 'win32' }, () => {
  const dir = fakePlatformPackage();
  const result = spawnSync(process.execPath, [shim, 'check', '--target', 'https://os.example.com'], {
    env: { ...process.env, ZLEAP_APP_BINARY: join(dir, 'bin', 'zleap-app') },
    encoding: 'utf8',
  });
  assert.equal(result.status, 3);
  assert.equal(result.stdout.trim(), 'args:check --target https://os.example.com');
  assert.equal(result.stderr.trim(), 'err');
});

test('低于声明的 Node 版本时拒绝运行，提供升级提示且不启动二进制', () => {
  const dir = fakePlatformPackage();
  const preload = join(dir, 'old-node.cjs');
  writeFileSync(preload, "Object.defineProperty(process.versions, 'node', { value: '16.20.2' });");
  const result = spawnSync(process.execPath, ['--require', preload, shim, 'version'], {
    env: { ...process.env, ZLEAP_APP_BINARY: join(dir, 'bin', 'zleap-app') },
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /Node.js >=18.*16.20.2.*升级/);
});
