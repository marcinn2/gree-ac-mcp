import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConfig, ConfigError } from '../src/config.ts';

function baseDevice(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'Taras AC',
    mac: '502cc6aabbcc',
    ...overrides,
  };
}

function baseConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    bearerToken: '0123456789abcdef0123456789abcdef', // 32 chars
    devices: [baseDevice()],
    ...overrides,
  };
}

test('parses a minimal valid config and applies defaults', () => {
  const cfg = parseConfig(baseConfig());
  assert.equal(cfg.udpPort, 7000);
  assert.equal(cfg.updateInterval, 1000);
  assert.equal(cfg.retryInterval, 5000);
  assert.equal(cfg.host, '0.0.0.0');
  assert.equal(cfg.port, 8080);
  assert.equal(cfg.devices.length, 1);
  const d = cfg.devices[0];
  assert.equal(d.minimumTargetTemperature, 16);
  assert.equal(d.maximumTargetTemperature, 30);
  assert.equal(d.speedSteps, 5);
  assert.equal(d.encryptionVersion, 0);
  assert.equal(d.xFan, false);
  assert.equal(d.oscillation.on.vertical, 'full');
});

test('normalizes MAC addresses (lowercase, strips separators)', () => {
  const cfg = parseConfig(baseConfig({ devices: [baseDevice({ mac: '50:2C:C6:AA:BB:CC' })] }));
  assert.equal(cfg.devices[0].mac, '502cc6aabbcc');
});

test('per-device intervals override top-level defaults; otherwise inherit', () => {
  const cfg = parseConfig(
    baseConfig({
      updateInterval: 2000,
      retryInterval: 9000,
      devices: [baseDevice({ updateInterval: 500 }), baseDevice({ mac: 'aabbccddeeff', name: 'B' })],
    }),
  );
  assert.equal(cfg.devices[0].updateInterval, 500); // overridden
  assert.equal(cfg.devices[0].retryInterval, 9000); // inherited
  assert.equal(cfg.devices[1].updateInterval, 2000); // inherited
});

test('rejects duplicate MAC addresses', () => {
  assert.throws(
    () =>
      parseConfig(
        baseConfig({ devices: [baseDevice(), baseDevice({ name: 'Dup' })] }),
      ),
    (err: unknown) => err instanceof ConfigError && /duplicate mac/.test((err as Error).message),
  );
});

test('rejects a missing bearerToken', () => {
  const cfg = baseConfig();
  delete (cfg as Record<string, unknown>).bearerToken;
  assert.throws(() => parseConfig(cfg), ConfigError);
});

test('rejects a bearerToken shorter than 32 characters', () => {
  assert.throws(() => parseConfig(baseConfig({ bearerToken: 'too-short' })), ConfigError);
});

test('accepts a 32-character bearerToken', () => {
  const cfg = parseConfig(baseConfig({ bearerToken: 'a'.repeat(32) }));
  assert.equal(cfg.bearerToken.length, 32);
});

test('rejects duplicate device names (case-insensitive)', () => {
  assert.throws(
    () =>
      parseConfig(
        baseConfig({
          devices: [
            baseDevice({ name: 'Living Room' }),
            baseDevice({ mac: 'aabbccddeeff', name: 'living room' }),
          ],
        }),
      ),
    (err: unknown) => err instanceof ConfigError && /duplicate device name/.test((err as Error).message),
  );
});

test('rejects an invalid MAC address', () => {
  assert.throws(() => parseConfig(baseConfig({ devices: [baseDevice({ mac: 'nothex' })] })), ConfigError);
});

test('rejects an invalid swing position enum', () => {
  assert.throws(
    () =>
      parseConfig(
        baseConfig({
          devices: [baseDevice({ oscillation: { on: { vertical: 'sideways', horizontal: 'full' } } })],
        }),
      ),
    ConfigError,
  );
});

test('rejects min > max target temperature', () => {
  assert.throws(
    () => parseConfig(baseConfig({ devices: [baseDevice({ minimumTargetTemperature: 28, maximumTargetTemperature: 20 })] })),
    ConfigError,
  );
});

test('rejects an empty devices array', () => {
  assert.throws(() => parseConfig(baseConfig({ devices: [] })), ConfigError);
});

test('rejects unknown top-level keys (strict schema)', () => {
  assert.throws(() => parseConfig(baseConfig({ bogus: true })), ConfigError);
});
