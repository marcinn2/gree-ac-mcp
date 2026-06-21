/**
 * CORS middleware for the HTTP transport.
 *
 * Needed for browser-based MCP clients. Two things matter specifically for MCP
 * over Streamable HTTP / SSE:
 *   - `Mcp-Session-Id` must be in Access-Control-Expose-Headers so client JS can
 *     read the session id returned on the initialize response.
 *   - Preflight (OPTIONS) must be answered before bearer auth, because preflight
 *     requests do not carry the Authorization header.
 *
 * Disabled by default (no `corsOrigins` configured) so non-browser deployments
 * are unaffected. Bearer auth is carried in the Authorization header (not cookies),
 * so credentialed CORS mode is not required and is intentionally not enabled.
 */
import type { NextFunction, Request, Response } from 'express';

const ALLOW_METHODS = 'GET, POST, DELETE, OPTIONS';
const ALLOW_HEADERS = 'Authorization, Content-Type, Mcp-Session-Id, Last-Event-ID, MCP-Protocol-Version';
const EXPOSE_HEADERS = 'Mcp-Session-Id, WWW-Authenticate';
const MAX_AGE = '86400'; // cache preflight for 24h

export function corsMiddleware(allowedOrigins: string[]) {
  const allowAll = allowedOrigins.includes('*');
  const allowed = new Set(allowedOrigins.map((o) => o.toLowerCase()));

  return (req: Request, res: Response, next: NextFunction): void => {
    const origin = req.headers.origin;

    if (origin) {
      if (allowAll) {
        res.setHeader('Access-Control-Allow-Origin', '*');
      } else if (allowed.has(origin.toLowerCase())) {
        // Reflect the specific allowed origin and vary the cache on it.
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
      }
      // Origin not on the allow-list -> no Allow-Origin header; the browser blocks it.
    }

    res.setHeader('Access-Control-Allow-Methods', ALLOW_METHODS);
    res.setHeader('Access-Control-Allow-Headers', ALLOW_HEADERS);
    res.setHeader('Access-Control-Expose-Headers', EXPOSE_HEADERS);
    res.setHeader('Access-Control-Max-Age', MAX_AGE);

    if (req.method === 'OPTIONS') {
      // Answer the preflight here, before auth runs.
      res.status(204).end();
      return;
    }

    next();
  };
}
