import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const required = ['api_systems', 'api_catalog', 'api_describe', 'api_query', 'api_openapi'];

export function runnablePlatform(platform) {
  const os = process.platform === 'win32' ? 'windows' : process.platform;
  return platform.goos === os && platform.cpu.includes(process.arch);
}

export async function checkCliMCP(binary, workspace, prefix = []) {
  const home = mkdtempSync(join(tmpdir(), 'zleap-cli-smoke-'));
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(binary, [...prefix, 'mcp', 'serve', '--workspace', workspace, '--target', 'https://example.com'], {
        env: { ...process.env, ZLEAP_APP_HOME: home, ZLEAP_APP_REMOTE_CONFIG: '' },
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      const lines = createInterface({ input: child.stdout });
      let finished = false;
      const timer = setTimeout(() => finish(new Error('MCP 工具握手超时')), 10_000);
      function finish(error) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        lines.close();
        child.stdin.destroy();
        child.kill();
        if (error) reject(error);
        else resolve();
      }
      function send(message) {
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
      }
      child.on('error', finish);
      child.stdin.on('error', finish);
      child.on('exit', (code) => finish(new Error(`CLI 在返回 MCP 工具列表前退出（${code}）`)));
      lines.on('line', (line) => {
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          finish(new Error('CLI 的 MCP stdout 包含非 JSON 内容'));
          return;
        }
        if (message.id === 1) {
          if (!message.result) return finish(new Error('CLI 初始化 MCP 失败'));
          send({ method: 'notifications/initialized' });
          send({ id: 2, method: 'tools/list', params: {} });
        } else if (message.id === 2) {
          const tools = new Set((message.result?.tools ?? []).map((tool) => tool.name));
          const missing = required.filter((name) => !tools.has(name));
          finish(missing.length ? new Error(`CLI 二进制缺少第三方 API MCP 工具：${missing.join('、')}`) : undefined);
        }
      });
      send({ id: 1, method: 'initialize', params: {
        protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'cli-package-smoke', version: '1' },
      } });
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}
