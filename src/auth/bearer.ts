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

/**
 * Constant-time string comparison. Both inputs are first hashed to a fixed-length
 * SHA-256 digest, so the comparison neither short-circuits on a length mismatch nor
 * varies its timing with the secret's length. (A raw timingSafeEqual over the plain
 * buffers would throw on unequal lengths, forcing an early length check that leaks
 * the expected token's length.) The only timing dependent on input length is the
 * hashing of the caller-supplied value, which reveals nothing about the secret.
 */
function safeEqual(a: string, b: string): boolean {
  const digestA = crypto.createHash('sha256').update(a).digest();
  const digestB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(digestA, digestB);
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
