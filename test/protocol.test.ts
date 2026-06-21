import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  encryptV1,
  decryptV1,
  encryptV2,
  decryptV2,
  packMessage,
  unpackMessage,
  GENERIC_KEY_V1,
} from '../src/gree/protocol.ts';

// Known-answer vector: a bind request encrypted with the generic v1 key.
// (Computed from the reference AES-128-ECB/PKCS7 scheme.)
const V1_BIND = { t: 'bind', mac: '502cc6aabbcc', uid: 0 };
const V1_BIND_CIPHERTEXT = 'LbyXlIr/T0/qWhgSNSKzEjyOZIOL3U2PWgeCaEJjuzWj9mrs/0p7GUTdWxmNaBUt';

test('encryptV1 produces the known reference ciphertext', () => {
  assert.equal(encryptV1(V1_BIND), V1_BIND_CIPHERTEXT);
});

test('decryptV1 reverses the known reference ciphertext', () => {
  assert.deepEqual(decryptV1(V1_BIND_CIPHERTEXT), V1_BIND);
});

test('v1 encrypt/decrypt round-trips with the generic key', () => {
  const msg = { t: 'status', mac: 'aabbccddeeff', cols: ['Pow', 'Mod', 'SetTem'] };
  assert.deepEqual(decryptV1(encryptV1(msg)), msg);
});

test('v1 encrypt/decrypt round-trips with a device key', () => {
  const deviceKey = '1a2b3c4d5e6f7g8h'; // 16-byte device key shape
  const msg = { t: 'cmd', opt: ['Pow'], p: [1] };
  assert.deepEqual(decryptV1(encryptV1(msg, deviceKey), deviceKey), msg);
});

test('v2 (GCM) encrypt/decrypt round-trips with the generic key', () => {
  const msg = { t: 'dev', mac: '502cc6aabbcc', ver: 'V2.0.0' };
  const { pack, tag } = encryptV2(msg);
  assert.deepEqual(decryptV2(pack, tag), msg);
});

test('v2 decrypt fails on a tampered auth tag', () => {
  const { pack } = encryptV2({ t: 'bind', mac: 'x' });
  assert.throws(() => decryptV2(pack, Buffer.alloc(16).toString('base64')));
});

test('packMessage wraps with i:1 + generic key when no device key is given', () => {
  const raw = packMessage({ t: 'bind', mac: '502cc6aabbcc', uid: 0 }, '502cc6aabbcc', 1);
  const envelope = JSON.parse(raw);
  assert.equal(envelope.t, 'pack');
  assert.equal(envelope.i, 1);
  assert.equal(envelope.tcid, '502cc6aabbcc');
  assert.equal(envelope.cid, 'app');
  // The pack decrypts with the generic key.
  assert.deepEqual(decryptV1(envelope.pack, GENERIC_KEY_V1), { t: 'bind', mac: '502cc6aabbcc', uid: 0 });
});

test('packMessage/unpackMessage round-trip with a device key (i:0)', () => {
  const deviceKey = 'abcdef0123456789';
  const inner = { t: 'cmd', opt: ['Pow', 'SetTem'], p: [1, 24] };
  const raw = packMessage(inner, 'aabbccddeeff', 1, deviceKey);
  const envelope = JSON.parse(raw);
  assert.equal(envelope.i, 0);
  const parsed = unpackMessage(raw, deviceKey);
  assert.equal(parsed.version, 1);
  assert.deepEqual(parsed.pack, inner);
});

test('unpackMessage round-trips a v2 datagram', () => {
  const deviceKey = 'abcdef0123456789';
  const inner = { t: 'dat', cols: ['Pow'], dat: [1] };
  const raw = packMessage(inner, 'aabbccddeeff', 2, deviceKey);
  const parsed = unpackMessage(raw, deviceKey);
  assert.equal(parsed.version, 2);
  assert.deepEqual(parsed.pack, inner);
});

test('unpackMessage throws when there is no pack field', () => {
  assert.throws(() => unpackMessage(JSON.stringify({ t: 'scan' })));
});
