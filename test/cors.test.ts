import { test } from 'node:test';
import assert from 'node:assert/strict';
import { corsMiddleware } from '../src/transport/cors.ts';

/** Minimal Express req/res doubles for exercising the middleware. */
function fakeReq(method: string, origin?: string): any {
  return { method, headers: origin ? { origin } : {} };
}

function fakeRes(): any {
  return {
    headers: {} as Record<string, string>,
    statusCode: 0,
    ended: false,
    setHeader(k: string, v: string) {
      this.headers[k.toLowerCase()] = v;
    },
    getHeader(k: string) {
      return this.headers[k.toLowerCase()];
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
  };
}

test('reflects an allowed origin and exposes Mcp-Session-Id', () => {
  const mw = corsMiddleware(['https://app.example.com']);
  const res = fakeRes();
  let nexted = false;
  mw(fakeReq('POST', 'https://app.example.com'), res, () => {
    nexted = true;
  });
  assert.equal(res.getHeader('access-control-allow-origin'), 'https://app.example.com');
  assert.match(res.getHeader('access-control-expose-headers'), /Mcp-Session-Id/);
  assert.match(res.getHeader('access-control-allow-headers'), /Authorization/);
  assert.equal(res.getHeader('vary'), 'Origin');
  assert.equal(nexted, true);
});

test('does not set Allow-Origin for a disallowed origin', () => {
  const mw = corsMiddleware(['https://app.example.com']);
  const res = fakeRes();
  mw(fakeReq('POST', 'https://evil.example.com'), res, () => {});
  assert.equal(res.getHeader('access-control-allow-origin'), undefined);
});

test('wildcard allows any origin', () => {
  const mw = corsMiddleware(['*']);
  const res = fakeRes();
  mw(fakeReq('GET', 'https://anything.test'), res, () => {});
  assert.equal(res.getHeader('access-control-allow-origin'), '*');
});

test('answers OPTIONS preflight with 204 and does not call next', () => {
  const mw = corsMiddleware(['*']);
  const res = fakeRes();
  let nexted = false;
  mw(fakeReq('OPTIONS', 'https://anything.test'), res, () => {
    nexted = true;
  });
  assert.equal(res.statusCode, 204);
  assert.equal(res.ended, true);
  assert.equal(nexted, false);
  assert.match(res.getHeader('access-control-allow-methods'), /POST/);
});

test('is case-insensitive when matching origins', () => {
  const mw = corsMiddleware(['https://App.Example.com']);
  const res = fakeRes();
  mw(fakeReq('POST', 'https://app.example.com'), res, () => {});
  assert.equal(res.getHeader('access-control-allow-origin'), 'https://app.example.com');
});
