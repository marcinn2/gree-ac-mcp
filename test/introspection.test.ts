import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// Mirrors how an MCP directory (e.g. Glama) launches the image: default stdio,
// no --config. The server must start, answer initialize + tools/list + ping, and
// must NOT advertise a `resources` capability it can't serve (no devices => no
// resources/list handler; advertising it makes a client's resources/list fail
// with -32601, which is what broke the Glama probe).
test('config-less stdio: tools + ping work and resources is not advertised', async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', 'src/index.ts'],
    cwd: process.cwd(),
    stderr: 'ignore',
  });
  const client = new Client({ name: 'introspection-test', version: '1.0.0' });
  await client.connect(transport);
  try {
    const caps = client.getServerCapabilities();
    assert.ok(caps?.tools, 'tools capability advertised');
    assert.equal(caps?.resources, undefined, 'resources capability NOT advertised with no devices');

    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    assert.equal(tools.length, 12);
    assert.ok(names.includes('list_devices'));
    assert.ok(names.includes('get_device_status'));

    await client.ping(); // resolves (empty result) or the test fails

    const res = await client.callTool({ name: 'list_devices', arguments: {} });
    const text = (res.content as Array<{ type: string; text?: string }>)[0]?.text ?? '';
    assert.deepEqual(JSON.parse(text), { devices: [] });
  } finally {
    await client.close();
  }
});
