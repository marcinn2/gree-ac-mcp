/**
 * GREE UDP wire protocol: AES encryption (v1 ECB / v2 GCM) and pack-envelope
 * (de)serialization.
 *
 * Reference: eibenp/homebridge-gree-airconditioner (src/crypto.ts, src/platform.ts)
 * and tomikaa87/gree-remote.
 */
import crypto from 'node:crypto';

/** Generic ("discovery") AES-128-ECB key used until a per-device key is obtained. */
export const GENERIC_KEY_V1 = 'a3K8Bx%2r8Y7#xDh';
/** Generic AES-128-GCM key used by v2 (newer firmware) for discovery/binding. */
export const GENERIC_KEY_V2 = '{yxAHAY_Lm6pbC/<';

const IV_V2 = Buffer.from([0x54, 0x40, 0x78, 0x44, 0x49, 0x67, 0x5a, 0x51, 0x6c, 0x5e, 0x63, 0x13]);
const AAD_V2 = Buffer.from('qualcomm-test');

/** Encrypt an object using the v1 scheme: JSON -> AES-128-ECB/PKCS7 -> base64. */
export function encryptV1(data: unknown, key: string = GENERIC_KEY_V1): string {
  const cipher = crypto.createCipheriv('aes-128-ecb', key, null);
  return cipher.update(JSON.stringify(data), 'utf8', 'base64') + cipher.final('base64');
}

/** Decrypt a v1 base64 pack back into an object. */
export function decryptV1<T = Record<string, unknown>>(data: string, key: string = GENERIC_KEY_V1): T {
  const decipher = crypto.createDecipheriv('aes-128-ecb', key, null);
  return JSON.parse(decipher.update(data, 'base64', 'utf8') + decipher.final('utf8')) as T;
}

/** Encrypt an object using the v2 scheme: JSON -> AES-128-GCM -> {pack, tag}. */
export function encryptV2(data: unknown, key: string = GENERIC_KEY_V2): { pack: string; tag: string } {
  const cipher = crypto.createCipheriv('aes-128-gcm', key, IV_V2).setAAD(AAD_V2);
  const pack = cipher.update(JSON.stringify(data), 'utf8', 'base64') + cipher.final('base64');
  const tag = cipher.getAuthTag().toString('base64');
  return { pack, tag };
}

/** Decrypt a v2 base64 pack (with auth tag) back into an object. */
export function decryptV2<T = Record<string, unknown>>(data: string, tag: string, key: string = GENERIC_KEY_V2): T {
  const decipher = crypto
    .createDecipheriv('aes-128-gcm', key, IV_V2)
    .setAuthTag(Buffer.from(tag, 'base64'))
    .setAAD(AAD_V2);
  return JSON.parse(decipher.update(data, 'base64', 'utf8') + decipher.final('utf8')) as T;
}

export type EncryptionVersion = 1 | 2;

/**
 * Build a complete UDP datagram (JSON string) wrapping an inner message in a
 * `pack` envelope. When `key` is undefined the generic key is used and `i:1`
 * signals to the device that this is a discovery/binding request.
 */
export function packMessage(
  message: unknown,
  tcid: string,
  version: EncryptionVersion,
  key?: string,
): string {
  const i = key === undefined ? 1 : 0;
  if (version === 1) {
    const pack = encryptV1(message, key);
    return JSON.stringify({ tcid, uid: 0, t: 'pack', pack, i, cid: 'app' });
  }
  const { pack, tag } = encryptV2(message, key);
  return JSON.stringify({ tcid, uid: 0, t: 'pack', pack, i, tag, cid: 'app' });
}

export interface ParsedPack {
  /** Decrypted inner pack object. */
  pack: Record<string, unknown>;
  /** Encryption version detected from the datagram (1 = ECB, 2 = GCM). */
  version: EncryptionVersion;
  /** The `i` flag from the envelope (1 => encrypted with the generic key). */
  i: number;
}

/**
 * Parse and decrypt an incoming datagram. Auto-detects the encryption version by
 * the presence of a `tag` field. When the envelope's `i === 1` the generic key is
 * used regardless of the supplied per-device `key` (this is how devices answer
 * discovery/bind requests).
 */
export function unpackMessage(raw: string, key?: string): ParsedPack {
  const message = JSON.parse(raw) as { pack?: string; tag?: string; i?: number };
  if (!message.pack) {
    throw new Error('datagram has no pack field');
  }
  const i = message.i ?? 0;
  if (message.tag === undefined) {
    const usedKey = i === 1 ? GENERIC_KEY_V1 : (key ?? GENERIC_KEY_V1);
    return { pack: decryptV1(message.pack, usedKey), version: 1, i };
  }
  const usedKey = i === 1 ? GENERIC_KEY_V2 : (key ?? GENERIC_KEY_V2);
  return { pack: decryptV2(message.pack, message.tag, usedKey), version: 2, i };
}
