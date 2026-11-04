'use strict';
// 解析当前平台对应的 zleap-app 预编译二进制。
// 查找顺序：ZLEAP_APP_BINARY 环境变量 → 平台子包（optionalDependencies）→ 报错并给出修复建议。
// 不在安装阶段联网下载，也不回退到其他平台的二进制。

const fs = require('node:fs');
const path = require('node:path');

// 平台子包命名为「主包名-平台-架构」，主包改名（kit.config.json）时自动跟随。
const BASE = require('../package.json').name;

const SUPPORTED = new Set([
  'darwin-arm64',
  'darwin-x64',
  'linux-x64',
  'linux-arm64',
  'win32-x64',
  'win32-arm64',
]);

function platformKey(platform = process.platform, arch = process.arch) {
  return `${platform}-${arch}`;
}

function binaryName(platform = process.platform) {
  return platform === 'win32' ? 'zleap-app.exe' : 'zleap-app';
}

function platformPackage(platform = process.platform, arch = process.arch) {
  return `${BASE}-${platformKey(platform, arch)}`;
}

class BinaryNotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BinaryNotFoundError';
  }
}

function resolveBinary(options = {}) {
  const env = options.env || process.env;
  const platform = options.platform || process.platform;
  const arch = options.arch || process.arch;
  const requireResolve = options.resolve || require.resolve;

  const override = env.ZLEAP_APP_BINARY;
  if (override) {
    if (!fs.existsSync(override)) {
      throw new BinaryNotFoundError(`ZLEAP_APP_BINARY 指向的文件不存在：${override}`);
    }
    return override;
  }

  const key = platformKey(platform, arch);
  if (!SUPPORTED.has(key)) {
    throw new BinaryNotFoundError(
      `暂不提供 ${key} 平台的 zleap-app 预编译版本。` +
        '可以从源码构建（go build ./cmd/zleap-app），再通过环境变量 ZLEAP_APP_BINARY 指定路径。',
    );
  }

  const pkg = platformPackage(platform, arch);
  let manifestPath;
  try {
    manifestPath = requireResolve(`${pkg}/package.json`);
  } catch {
    throw new BinaryNotFoundError(
      `没有找到平台包 ${pkg}。\n` +
        '常见原因：安装时使用了 --no-optional / --omit=optional，或在另一个平台上安装后拷贝了 node_modules。\n' +
        `修复：重新安装依赖（不要省略 optionalDependencies），或执行 npm install ${pkg}。`,
    );
  }
  const binary = path.join(path.dirname(manifestPath), 'bin', binaryName(platform));
  if (!fs.existsSync(binary)) {
    throw new BinaryNotFoundError(`平台包 ${pkg} 已安装，但缺少可执行文件：${binary}`);
  }
  return binary;
}

module.exports = { resolveBinary, platformKey, platformPackage, binaryName, BinaryNotFoundError, SUPPORTED };
