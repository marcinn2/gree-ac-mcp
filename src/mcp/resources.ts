/**
 * Optional MCP resources: each configured device is exposed as a readable
 * resource at `gree://device/{mac}` returning its decoded status as JSON.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DeviceManager } from '../gree/manager.js';

export function registerResources(server: McpServer, manager: DeviceManager): void {
  for (const device of manager.list()) {
    const uri = `gree://device/${device.mac}`;
    server.registerResource(
      device.mac,
      uri,
      {
        title: device.config.name,
        description: `Decoded status for ${device.config.name}${device.config.room ? ` (${device.config.room})` : ''}`,
        mimeType: 'application/json',
      },
      async (resourceUri) => ({
        contents: [
          {
            uri: resourceUri.href,
            mimeType: 'application/json',
            text: JSON.stringify(device.getDecodedStatus(), null, 2),
          },
        ],
      }),
    );
  }
}
