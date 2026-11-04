#!/usr/bin/env node
'use strict';
// zleap-app 的 npm 入口：找到当前平台的预编译二进制，原样透传参数、标准输入输出与退出码。
// MCP（zleap-app mcp serve）依赖 stdio 透传，这里不能向 stdout 写任何额外内容。

const { spawn } = require('node:child_process');
const { resolveBinary, BinaryNotFoundError } = require('../lib/resolve.js');

let binary;
try {
  binary = resolveBinary();
} catch (error) {
  if (error instanceof BinaryNotFoundError) {
    process.stderr.write(`zleap-app: ${error.message}\n`);
    process.exit(127);
  }
  throw error;
}

const child = spawn(binary, process.argv.slice(2), { stdio: 'inherit', windowsHide: true });

const forward = (signal) => {
  if (!child.killed) child.kill(signal);
};
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => forward(signal));
}

child.on('error', (error) => {
  process.stderr.write(`zleap-app: 无法启动 ${binary}：${error.message}\n`);
  process.exit(127);
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.removeAllListeners(signal);
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
