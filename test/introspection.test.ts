import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// Mirrors how an MCP directory (e.g. Glama) launches the image: default stdio,
// no --config. The server must start and answer initialize + tools/list.
test('launches over stdio with no config and serves tools/list', async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', 'src/index.ts'],
    cwd: process.cwd(),
    stderr: 'ignore',
  });
  const client = new Client({ name: 'introspection-test', version: '1.0.0' });
  await client.connect(transport);
  try {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    assert.equal(tools.length, 12);
    assert.ok(names.includes('list_devices'));
    assert.ok(names.includes('get_device_status'));

    const res = await client.callTool({ name: 'list_devices', arguments: {} });
    const text = (res.content as Array<{ type: string; text?: string }>)[0]?.text ?? '';
    assert.deepEqual(JSON.parse(text), { devices: [] });
  } finally {
    await client.close();
  }
});
