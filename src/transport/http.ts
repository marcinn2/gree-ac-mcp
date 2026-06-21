/**
 * HTTP transport. Serves:
 *   - POST/GET/DELETE /mcp  — modern Streamable HTTP transport (session via Mcp-Session-Id)
 *   - GET /sse + POST /messages — legacy HTTP+SSE transport for older clients
 *   - GET /healthz — unauthenticated liveness/readiness probe
 *
 * Bearer auth is mandatory on every MCP endpoint and runs before the transport.
 */
import { randomUUID } from 'node:crypto';
import express, { type Request, type Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { createMcpServer } from '../mcp/server.js';
import { bearerAuth } from '../auth/bearer.js';
import { corsMiddleware } from './cors.js';
import type { DeviceManager } from '../gree/manager.js';
import type { ResolvedConfig } from '../gree/types.js';
import type { Logger } from '../logger.js';

export async function runHttp(config: ResolvedConfig, manager: DeviceManager, log: Logger): Promise<void> {
  const app = express();

  // CORS first (disabled unless corsOrigins is configured) so OPTIONS preflight is
  // answered before auth — preflight requests carry no Authorization header.
  if (config.corsOrigins.length > 0) {
    app.use(corsMiddleware(config.corsOrigins));
    log.info('CORS enabled', { origins: config.corsOrigins });
  }

  app.use(express.json());

  const auth = bearerAuth(config.bearerToken, log);

  // --- Health probe (no auth) ---------------------------------------------
  app.get('/healthz', (_req: Request, res: Response) => {
    res.json({ status: 'ok', ...manager.summary() });
  });

  // --- Modern Streamable HTTP transport -----------------------------------
  const streamableTransports = new Map<string, StreamableHTTPServerTransport>();

  app.post('/mcp', auth, async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    let transport = sessionId ? streamableTransports.get(sessionId) : undefined;

    if (!transport) {
      if (sessionId || !isInitializeRequest(req.body)) {
        res.status(400).json({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Bad Request: no valid session ID for a non-initialize request' },
          id: null,
        });
        return;
      }
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          streamableTransports.set(id, transport!);
          log.info('streamable session initialized', { sessionId: id });
        },
      });
      transport.onclose = () => {
        if (transport!.sessionId) {
          streamableTransports.delete(transport!.sessionId);
          log.info('streamable session closed', { sessionId: transport!.sessionId });
        }
      };
      const server = createMcpServer(manager, log);
      await server.connect(transport);
    }

    await transport.handleRequest(req, res, req.body);
  });

  const handleStreamableSessionRequest = async (req: Request, res: Response): Promise<void> => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    const transport = sessionId ? streamableTransports.get(sessionId) : undefined;
    if (!transport) {
      res.status(400).send('Invalid or missing Mcp-Session-Id header');
      return;
    }
    await transport.handleRequest(req, res);
  };

  app.get('/mcp', auth, handleStreamableSessionRequest);
  app.delete('/mcp', auth, handleStreamableSessionRequest);

  // --- Legacy HTTP+SSE transport ------------------------------------------
  const sseTransports = new Map<string, SSEServerTransport>();

  app.get('/sse', auth, async (_req: Request, res: Response) => {
    const transport = new SSEServerTransport('/messages', res);
    sseTransports.set(transport.sessionId, transport);
    log.info('sse session opened', { sessionId: transport.sessionId });
    res.on('close', () => {
      sseTransports.delete(transport.sessionId);
      log.info('sse session closed', { sessionId: transport.sessionId });
    });
    const server = createMcpServer(manager, log);
    await server.connect(transport);
  });

  app.post('/messages', auth, async (req: Request, res: Response) => {
    const sessionId = req.query.sessionId as string | undefined;
    const transport = sessionId ? sseTransports.get(sessionId) : undefined;
    if (!transport) {
      res.status(400).send('No active SSE session for the provided sessionId');
      return;
    }
    await transport.handlePostMessage(req, res, req.body);
  });

  await new Promise<void>((resolve) => {
    const httpServer = app.listen(config.port, config.host, () => {
      log.info('MCP HTTP server listening', {
        host: config.host,
        port: config.port,
        endpoints: ['/mcp', '/sse', '/messages', '/healthz'],
      });
      resolve();
    });
    httpServer.on('error', (err) => {
      log.error('HTTP server error', { error: err.message });
    });
  });
}
