import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkCliMCP } from '../scripts/lib/cli-mcp-check.mjs';

test('CLI 包的 MCP 握手实际检查发布必需工具', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'cli-check-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const script = join(dir, 'cli.cjs');
  writeFileSync(script, `
const { createInterface } = require('node:readline');
createInterface({ input: process.stdin }).on('line', (line) => {
  const { id, method } = JSON.parse(line);
  if (!id) return;
  const names = ['api_systems', 'api_catalog', 'api_describe', 'api_query'];
  if (process.argv[2] === 'full') names.push('api_openapi');
  const result = method === 'initialize' ? { serverInfo: { name: 'fixture' } } : { tools: names.map(name => ({ name })) };
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n');
});
`);
  await checkCliMCP(process.execPath, dir, [script, 'full']);
  await assert.rejects(checkCliMCP(process.execPath, dir, [script, 'partial']), /缺少.*api_openapi/);
});
