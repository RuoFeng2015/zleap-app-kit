import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const pkgDir = join(root, 'packages/app-sdk');
const dist = join(pkgDir, 'dist');
// dist 只在本地由私有源码构建（npm run build:sdk）；公开仓库的 CI 里没有，跳过。
const built = existsSync(join(dist, 'build-info.json'));

test('package.json 的 exports 都指向存在的产物与类型', { skip: !built }, () => {
  const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
  assert.equal(pkg.license, 'SEE LICENSE IN LICENSE');
  for (const [entry, target] of Object.entries(pkg.exports)) {
    if (typeof target === 'string') continue;
    for (const file of [target.types, target.import]) assert.ok(existsSync(join(pkgDir, file)), `${entry} → ${file}`);
  }
});

test('产物已压缩混淆、无源码映射、不触碰 CSP 禁区', { skip: !built }, () => {
  for (const name of ['index.js', 'host.js', 'workspace.js']) {
    const code = readFileSync(join(dist, name), 'utf8');
    const lines = code.split('\n').filter(Boolean);
    assert.ok(lines.length <= 3, `${name} 应是压缩后的单行产物`);
    assert.match(lines[0], /^\/\*! @zleap-ai\/app-sdk v\d+\.\d+\.\d+/);
    assert.doesNotMatch(code, /sourceMappingURL/);
    assert.doesNotMatch(code, /\beval\s*\(|new\s+Function\s*\(/);
    // 源码里的内部函数名不应出现在产物中
    for (const internal of ['parseCloudRequest', 'encodeMutation', 'decodeDates', 'boundedJson', 'connectCloudFrame']) {
      assert.ok(!code.includes(internal), `${name} 仍含内部标识符 ${internal}`);
    }
  }
});

test('公开 API 可用：导出名、错误类型与动态环境常量', { skip: !built }, async () => {
  globalThis.window ??= globalThis;
  const cloud = await import(join(dist, 'index.js'));
  assert.deepEqual(Object.keys(cloud).sort(), ['AppError', 'CloudError', 'DYNAMIC_CURRENT_ENV', 'boundedBinary', 'createCloudClient', 'writesCloud', 'zl']);
  // 2026-11-01：版本更新与授权登录（与云资源无关）
  assert.equal(typeof cloud.zl.app.getUpdateManager, 'function');
  assert.equal(typeof cloud.zl.app.checkUpdate, 'function');
  assert.equal(typeof cloud.zl.auth.authorize, 'function');
  assert.equal(typeof cloud.zl.auth.getIdentity, 'function');
  assert.equal(new cloud.AppError('AUTH_DENIED').errCode, 'AUTH_DENIED');
  const error = new cloud.CloudError('SCHEMA_INVALID');
  assert.equal(error.name, 'CloudError');
  assert.equal(error.errCode, 'SCHEMA_INVALID');
  assert.ok(error instanceof Error);
  assert.equal(typeof cloud.zl.cloud.database, 'function');
  const host = await import(join(dist, 'host.js'));
  assert.deepEqual(Object.keys(host).sort(), ['SDKError', 'connectHostCapabilities', 'connectHostedApp', 'connectZleapOs', 'describeError']);
  const workspace = await import(join(dist, 'workspace.js'));
  assert.deepEqual(Object.keys(workspace).sort(), ['WorkspaceError', 'connectWorkspace']);
});
