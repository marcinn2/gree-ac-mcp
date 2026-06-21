/**
 * Bearer-token authentication middleware for the HTTP transport.
 *
 * Runs before any MCP transport handling so unauthenticated requests never reach
 * the protocol layer. On missing/invalid credentials it returns 401 with a
 * `WWW-Authenticate: Bearer` header. The token itself is never logged.
 */
import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { Logger } from '../logger.js';

/** Constant-time string comparison that is safe against length leaks. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

export function bearerAuth(expectedToken: string, log: Logger) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      res.setHeader('WWW-Authenticate', 'Bearer');
      log.warn('rejected unauthenticated request', { path: req.path, reason: 'missing bearer token' });
      res.status(401).json({ error: 'unauthorized', message: 'Missing bearer token' });
      return;
    }
    const provided = header.slice('Bearer '.length);
    if (!safeEqual(provided, expectedToken)) {
      res.setHeader('WWW-Authenticate', 'Bearer');
      log.warn('rejected unauthenticated request', { path: req.path, reason: 'invalid bearer token' });
      res.status(401).json({ error: 'unauthorized', message: 'Invalid bearer token' });
      return;
    }
    next();
  };
}
