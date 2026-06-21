/**
 * stdio transport. The MCP protocol uses stdout; all logging goes to stderr.
 * No authentication is enforced (the process pipe is the trust boundary).
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from '../mcp/server.js';
import type { DeviceManager } from '../gree/manager.js';
import type { Logger } from '../logger.js';

export async function runStdio(manager: DeviceManager, log: Logger): Promise<void> {
  const server = createMcpServer(manager, log);
  const transport = new StdioServerTransport();

  // When the client disconnects (stdin EOF), shut down cleanly. The background
  // polling timers would otherwise keep the process alive indefinitely.
  // StdioServerTransport does not auto-close on stdin EOF, so watch stdin directly.
  const shutdown = (): void => {
    log.info('stdin closed, shutting down');
    manager.stopAll();
    process.exit(0);
  };
  process.stdin.once('end', shutdown);
  process.stdin.once('close', shutdown);

  await server.connect(transport);
  log.info('MCP server connected over stdio');
}
