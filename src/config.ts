/**
 * Configuration loading and validation.
 *
 * The config file path comes from `--config <path>` (handled in index.ts) or the
 * `GREE_MCP_CONFIG` environment variable. Validation is performed with zod and
 * fails fast with an actionable message naming the offending device.
 */
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { SWING_HORIZONTAL_NAMES, SWING_VERTICAL_NAMES } from './gree/commands.js';
import type { ResolvedConfig, ResolvedDeviceConfig } from './gree/types.js';

const verticalSwingEnum = z.enum(SWING_VERTICAL_NAMES as [string, ...string[]]);
const horizontalSwingEnum = z.enum(SWING_HORIZONTAL_NAMES as [string, ...string[]]);

const oscillationPositionSchema = z
  .object({
    horizontal: horizontalSwingEnum.default('default'),
    vertical: verticalSwingEnum.default('default'),
  })
  .strict();

const oscillationSchema = z
  .object({
    on: oscillationPositionSchema.default({ horizontal: 'full', vertical: 'full' }),
    off: oscillationPositionSchema.default({ horizontal: 'default', vertical: 'default' }),
  })
  .strict();

const macSchema = z
  .string()
  .transform((s) => s.toLowerCase().replace(/[:-]/g, ''))
  .refine((s) => /^[a-f0-9]{12}$/.test(s), {
    message: 'mac must be 12 hexadecimal characters (e.g. "502cc6aabbcc")',
  });

const deviceSchema = z
  .object({
    name: z.string().min(1),
    room: z.string().optional(),
    address: z.ipv4().optional(),
    mac: macSchema,
    model: z.string().optional(),
    nameFan: z.string().optional(),
    serialNumber: z.string().optional(),
    minimumTargetTemperature: z.number().min(8).max(30).default(16),
    maximumTargetTemperature: z.number().min(8).max(30).default(30),
    oscillation: oscillationSchema.default({
      on: { horizontal: 'full', vertical: 'full' },
      off: { horizontal: 'default', vertical: 'default' },
    }),
    xFan: z.boolean().default(false),
    lightControl: z.boolean().default(false),
    fakeSensor: z.boolean().default(false),
    sensorOffset: z.number().default(0),
    speedSteps: z.union([z.literal(3), z.literal(5)]).default(5),
    encryptionVersion: z.union([z.literal(0), z.literal(1), z.literal(2)]).default(0),
    updateInterval: z.number().int().positive().optional(),
    retryInterval: z.number().int().positive().optional(),
  })
  .strict()
  .refine((d) => d.minimumTargetTemperature <= d.maximumTargetTemperature, {
    message: 'minimumTargetTemperature must be <= maximumTargetTemperature',
    path: ['minimumTargetTemperature'],
  });

const configSchema = z
  .object({
    bearerToken: z.string().min(32, 'bearerToken must be at least 32 characters'),
    udpPort: z.number().int().min(1).max(65535).default(7000),
    updateInterval: z.number().int().positive().default(1000),
    retryInterval: z.number().int().positive().default(5000),
    host: z.string().default('0.0.0.0'),
    port: z.number().int().min(1).max(65535).default(8080),
    corsOrigins: z
      .array(z.string().min(1))
      .default([])
      .describe('Allowed CORS origins for HTTP mode. Empty disables CORS; ["*"] allows any origin.'),
    devices: z.array(deviceSchema).min(1, 'at least one device is required'),
  })
  .strict()
  .superRefine((cfg, ctx) => {
    const seenMac = new Map<string, number>();
    const seenName = new Map<string, number>();
    cfg.devices.forEach((device, index) => {
      const prevMac = seenMac.get(device.mac);
      if (prevMac !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate mac "${device.mac}" (devices "${cfg.devices[prevMac].name}" and "${device.name}")`,
          path: ['devices', index, 'mac'],
        });
      } else {
        seenMac.set(device.mac, index);
      }

      // Names resolve case-insensitively (see DeviceManager.resolve), so a
      // case-insensitive duplicate would silently shadow the earlier device.
      const nameKey = device.name.toLowerCase();
      const prevName = seenName.get(nameKey);
      if (prevName !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate device name "${device.name}" (also used by device "${cfg.devices[prevName].name}")`,
          path: ['devices', index, 'name'],
        });
      } else {
        seenName.set(nameKey, index);
      }
    });
  });

export type RawConfig = z.infer<typeof configSchema>;

/** Parse + validate an already-loaded config object. Throws ConfigError on failure. */
export function parseConfig(raw: unknown): ResolvedConfig {
  const result = configSchema.safeParse(raw);
  if (!result.success) {
    const lines = result.error.issues.map((issue) => {
      const path = issue.path.join('.');
      return `  - ${path || '<root>'}: ${issue.message}`;
    });
    throw new ConfigError(`Invalid configuration:\n${lines.join('\n')}`);
  }

  const cfg = result.data;
  const devices: ResolvedDeviceConfig[] = cfg.devices.map((d) => ({
    name: d.name,
    room: d.room,
    address: d.address,
    mac: d.mac,
    model: d.model,
    nameFan: d.nameFan,
    serialNumber: d.serialNumber,
    minimumTargetTemperature: d.minimumTargetTemperature,
    maximumTargetTemperature: d.maximumTargetTemperature,
    oscillation: d.oscillation as ResolvedDeviceConfig['oscillation'],
    xFan: d.xFan,
    lightControl: d.lightControl,
    fakeSensor: d.fakeSensor,
    sensorOffset: d.sensorOffset,
    speedSteps: d.speedSteps,
    encryptionVersion: d.encryptionVersion,
    updateInterval: d.updateInterval ?? cfg.updateInterval,
    retryInterval: d.retryInterval ?? cfg.retryInterval,
    udpPort: cfg.udpPort,
  }));

  return {
    bearerToken: cfg.bearerToken,
    udpPort: cfg.udpPort,
    updateInterval: cfg.updateInterval,
    retryInterval: cfg.retryInterval,
    host: cfg.host,
    port: cfg.port,
    corsOrigins: cfg.corsOrigins,
    devices,
  };
}

/** Load + validate a config file from disk. */
export function loadConfig(path: string): ResolvedConfig {
  let contents: string;
  try {
    contents = readFileSync(path, 'utf8');
  } catch (err) {
    throw new ConfigError(`Cannot read config file at "${path}": ${(err as Error).message}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(contents);
  } catch (err) {
    throw new ConfigError(`Config file at "${path}" is not valid JSON: ${(err as Error).message}`);
  }
  return parseConfig(json);
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}
