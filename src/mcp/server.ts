/**
 * MCP server construction. A fresh McpServer is built per transport session (so
 * concurrent HTTP/SSE sessions are isolated), but all instances share the same
 * DeviceManager and its background UDP state.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTools } from './tools.js';
import { registerResources } from './resources.js';
import type { DeviceManager } from '../gree/manager.js';
import type { Logger } from '../logger.js';

export const SERVER_NAME = 'gree-ac-mcp-server';
export const SERVER_VERSION = '0.1.0';

export function createMcpServer(manager: DeviceManager, log: Logger): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      capabilities: { tools: {}, resources: {} },
      instructions:
        'Controls GREE/EWPE WiFi air conditioners over their native UDP protocol. ' +
        'Select a device by its "mac" (preferred) or "name". Use list_devices to discover devices, ' +
        'get_device_status for full state, and the set_* tools to control units.',
    },
  );

  registerTools(server, manager, log);
  registerResources(server, manager);

  return server;
}
