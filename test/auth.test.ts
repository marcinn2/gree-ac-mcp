import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bearerAuth } from '../src/auth/bearer.ts';

/** Silent logger stub so tests don't emit to stderr. */
const noopLog: any = {
  debug() {}, info() {}, warn() {}, error() {},
  child() { return noopLog; },
};

function fakeReq(authorization?: string): any {
  return { path: '/mcp', headers: authorization ? { authorization } : {} };
}

function fakeRes(): any {
  return {
    headers: {} as Record<string, string>,
    statusCode: 0,
    body: undefined as unknown,
    setHeader(k: string, v: string) { this.headers[k.toLowerCase()] = v; },
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
  };
}

const TOKEN = '0123456789abcdef0123456789abcdef';

test('accepts the correct bearer token and calls next', () => {
  const mw = bearerAuth(TOKEN, noopLog);
  const res = fakeRes();
  let nexted = false;
  mw(fakeReq(`Bearer ${TOKEN}`), res, () => { nexted = true; });
  assert.equal(nexted, true);
  assert.equal(res.statusCode, 0);
});

test('rejects a wrong token of equal length with 401', () => {
  const mw = bearerAuth(TOKEN, noopLog);
  const res = fakeRes();
  let nexted = false;
  mw(fakeReq(`Bearer ${'f'.repeat(TOKEN.length)}`), res, () => { nexted = true; });
  assert.equal(nexted, false);
  assert.equal(res.statusCode, 401);
  assert.equal(res.headers['www-authenticate'], 'Bearer');
});

test('rejects a token of different length with 401 (no length short-circuit)', () => {
  const mw = bearerAuth(TOKEN, noopLog);
  for (const provided of ['', 'x', TOKEN.slice(0, 8), TOKEN + 'extra']) {
    const res = fakeRes();
    let nexted = false;
    mw(fakeReq(`Bearer ${provided}`), res, () => { nexted = true; });
    assert.equal(nexted, false, `should reject "${provided}"`);
    assert.equal(res.statusCode, 401);
  }
});

test('rejects a missing/malformed Authorization header with 401', () => {
  const mw = bearerAuth(TOKEN, noopLog);
  for (const header of [undefined, 'Basic abc', TOKEN]) {
    const res = fakeRes();
    let nexted = false;
    mw(fakeReq(header), res, () => { nexted = true; });
    assert.equal(nexted, false);
    assert.equal(res.statusCode, 401);
  }
});
