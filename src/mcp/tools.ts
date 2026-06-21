/**
 * MCP tool definitions and handlers. Tools are designed so an LLM client can
 * discover and drive GREE air conditioners without knowing the wire protocol.
 *
 * Every tool selects a device with `mac` (canonical) or `name` (alias). Handlers
 * return MCP content (with `isError: true` on failure) rather than throwing.
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { GreeDevice } from '../gree/device.js';
import type { DeviceManager } from '../gree/manager.js';
import type { Logger } from '../logger.js';
import {
  FIELDS,
  MODE,
  FAN_SPEED,
  QUIET,
  ON_OFF,
  TEMP_UNIT,
  SWING_VERTICAL,
  SWING_HORIZONTAL,
  type ModeName,
} from '../gree/commands.js';

const deviceSelectorShape = {
  mac: z
    .string()
    .optional()
    .describe('Device MAC (12 hex chars, the canonical identifier). Preferred selector.'),
  name: z
    .string()
    .optional()
    .describe('Device name from config, as a convenience alias for mac.'),
};

type Selector = { mac?: string; name?: string };

function ok(payload: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

function fail(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/** Resolve a device or return an error result describing what went wrong. */
function resolveOrError(
  manager: DeviceManager,
  selector: Selector,
): { device: GreeDevice } | { error: CallToolResult } {
  if (!selector.mac && !selector.name) {
    return { error: fail('Provide either "mac" or "name" to select a device.') };
  }
  const device = manager.resolve(selector);
  if (!device) {
    const key = selector.mac ?? selector.name;
    return { error: fail(`No configured device matches "${key}". Use list_devices to see available devices.`) };
  }
  return { device };
}

/** Guard for write commands: the device must be bound to accept commands. */
function ensureReachable(device: GreeDevice): CallToolResult | undefined {
  if (!device.bound) {
    return fail(
      `Device ${device.mac} (${device.config.name}) is not currently reachable (unbound/offline). ` +
        `Check that it is powered on and on the same network; the server keeps retrying in the background.`,
    );
  }
  return undefined;
}

const FAN_SPEED_NAMES = ['auto', 'quiet', 'low', 'medium-low', 'medium', 'medium-high', 'high', 'turbo'] as const;
type FanSpeedName = (typeof FAN_SPEED_NAMES)[number];

/**
 * Translate a logical fan speed into a command map, degrading gracefully on
 * 3-speed units. "quiet" and "turbo" set their dedicated flags; all other speeds
 * clear both flags and set WdSpd.
 */
function fanSpeedCommand(speed: FanSpeedName, speedSteps: 3 | 5): Record<string, number> {
  if (speed === 'quiet') {
    return { [FIELDS.quiet]: QUIET.on, [FIELDS.turbo]: ON_OFF.off, [FIELDS.fanSpeed]: FAN_SPEED.auto };
  }
  if (speed === 'turbo') {
    return { [FIELDS.turbo]: ON_OFF.on, [FIELDS.quiet]: QUIET.off };
  }

  let wd: number;
  if (speedSteps === 3) {
    // 3-speed units only support low/medium/high (1/3/5); collapse the in-between steps.
    const map3: Record<Exclude<FanSpeedName, 'quiet' | 'turbo'>, number> = {
      auto: FAN_SPEED.auto,
      low: FAN_SPEED.low,
      'medium-low': FAN_SPEED.low,
      medium: FAN_SPEED.medium,
      'medium-high': FAN_SPEED.high,
      high: FAN_SPEED.high,
    };
    wd = map3[speed];
  } else {
    const map5: Record<Exclude<FanSpeedName, 'quiet' | 'turbo'>, number> = {
      auto: FAN_SPEED.auto,
      low: FAN_SPEED.low,
      'medium-low': FAN_SPEED.mediumLow,
      medium: FAN_SPEED.medium,
      'medium-high': FAN_SPEED.mediumHigh,
      high: FAN_SPEED.high,
    };
    wd = map5[speed];
  }
  return { [FIELDS.fanSpeed]: wd, [FIELDS.quiet]: QUIET.off, [FIELDS.turbo]: ON_OFF.off };
}

export function registerTools(server: McpServer, manager: DeviceManager, log: Logger): void {
  const audit = (action: string, device: GreeDevice, outcome: string, extra?: Record<string, unknown>): void => {
    log.info('tool action', { action, mac: device.mac, outcome, ...extra });
  };

  // ---- read-only tools -----------------------------------------------------

  server.registerTool(
    'list_devices',
    {
      title: 'List devices',
      description: 'List all configured GREE air conditioners with their connectivity status and last-known state.',
      inputSchema: {},
    },
    async () => {
      const devices = manager.list().map((d) => {
        const s = d.getDecodedStatus();
        return {
          mac: s.mac,
          name: s.name,
          room: s.room,
          model: s.model,
          online: s.online,
          bound: s.bound,
          power: s.power,
          mode: s.mode,
          targetTemperature: s.targetTemperature,
          currentTemperature: s.currentTemperature,
        };
      });
      return ok({ devices });
    },
  );

  server.registerTool(
    'get_device_status',
    {
      title: 'Get device status',
      description: 'Return the full decoded status of one device (power, mode, temperatures, fan, swing, xFan, light, quiet/turbo, etc).',
      inputSchema: deviceSelectorShape,
    },
    async (args) => {
      const resolved = resolveOrError(manager, args);
      if ('error' in resolved) {
        return resolved.error;
      }
      return ok(resolved.device.getDecodedStatus());
    },
  );

  server.registerTool(
    'get_room_temperature',
    {
      title: 'Get room temperature',
      description:
        'Return the calibrated current temperature in °C. If the unit lacks a real sensor and fakeSensor is enabled, ' +
        'the value is derived from the target temperature and flagged with "estimated": true.',
      inputSchema: deviceSelectorShape,
    },
    async (args) => {
      const resolved = resolveOrError(manager, args);
      if ('error' in resolved) {
        return resolved.error;
      }
      const device = resolved.device;
      const { celsius, estimated } = device.decodeCurrentTemperature();
      if (celsius === null) {
        return ok({
          mac: device.mac,
          name: device.config.name,
          temperature: null,
          estimated: false,
          note: 'Device reports no usable temperature sensor and fakeSensor is disabled.',
        });
      }
      return ok({
        mac: device.mac,
        name: device.config.name,
        temperature: Math.round(celsius * 10) / 10,
        unit: 'C',
        estimated,
      });
    },
  );

  // ---- write tools ---------------------------------------------------------

  server.registerTool(
    'set_power',
    {
      title: 'Set power',
      description: 'Turn a device on or off.',
      inputSchema: { ...deviceSelectorShape, on: z.boolean().describe('true = on, false = off') },
    },
    async (args) => {
      const resolved = resolveOrError(manager, args);
      if ('error' in resolved) {
        return resolved.error;
      }
      const device = resolved.device;
      const unreachable = ensureReachable(device);
      if (unreachable) {
        return unreachable;
      }
      device.sendCommand({ [FIELDS.power]: args.on ? ON_OFF.on : ON_OFF.off });
      audit('set_power', device, 'sent', { on: args.on });
      return ok({ mac: device.mac, power: args.on, status: 'command sent' });
    },
  );

  server.registerTool(
    'set_mode',
    {
      title: 'Set mode',
      description: 'Set the operating mode. Also powers the unit on.',
      inputSchema: {
        ...deviceSelectorShape,
        mode: z.enum(['auto', 'cool', 'dry', 'fan', 'heat']).describe('Operating mode'),
      },
    },
    async (args) => {
      const resolved = resolveOrError(manager, args);
      if ('error' in resolved) {
        return resolved.error;
      }
      const device = resolved.device;
      const unreachable = ensureReachable(device);
      if (unreachable) {
        return unreachable;
      }
      device.sendCommand({ [FIELDS.mode]: MODE[args.mode as ModeName], [FIELDS.power]: ON_OFF.on });
      audit('set_mode', device, 'sent', { mode: args.mode });
      return ok({ mac: device.mac, mode: args.mode, power: true, status: 'command sent' });
    },
  );

  server.registerTool(
    'set_target_temperature',
    {
      title: 'Set target temperature',
      description:
        'Set the target temperature in °C. Rejected (not silently clamped) if outside the device\'s configured min/max range.',
      inputSchema: {
        ...deviceSelectorShape,
        temperature: z.number().describe('Target temperature in degrees Celsius'),
      },
    },
    async (args) => {
      const resolved = resolveOrError(manager, args);
      if ('error' in resolved) {
        return resolved.error;
      }
      const device = resolved.device;
      const { minimumTargetTemperature: min, maximumTargetTemperature: max } = device.config;
      if (args.temperature < min || args.temperature > max) {
        return fail(
          `Temperature ${args.temperature}°C is out of range for ${device.mac} (allowed ${min}–${max}°C).`,
        );
      }
      const unreachable = ensureReachable(device);
      if (unreachable) {
        return unreachable;
      }
      const setTem = Math.round(args.temperature);
      device.sendCommand({ [FIELDS.targetTemp]: setTem, [FIELDS.tempUnit]: TEMP_UNIT.celsius });
      audit('set_target_temperature', device, 'sent', { temperature: setTem });
      return ok({ mac: device.mac, targetTemperature: setTem, unit: 'C', status: 'command sent' });
    },
  );

  server.registerTool(
    'set_fan_speed',
    {
      title: 'Set fan speed',
      description:
        'Set the fan speed. "quiet" and "turbo" engage the dedicated modes. On 3-speed units the intermediate steps are mapped down gracefully.',
      inputSchema: {
        ...deviceSelectorShape,
        speed: z.enum(FAN_SPEED_NAMES).describe('Fan speed level'),
      },
    },
    async (args) => {
      const resolved = resolveOrError(manager, args);
      if ('error' in resolved) {
        return resolved.error;
      }
      const device = resolved.device;
      const unreachable = ensureReachable(device);
      if (unreachable) {
        return unreachable;
      }
      device.sendCommand(fanSpeedCommand(args.speed as FanSpeedName, device.config.speedSteps));
      audit('set_fan_speed', device, 'sent', { speed: args.speed });
      return ok({ mac: device.mac, fanSpeed: args.speed, status: 'command sent' });
    },
  );

  server.registerTool(
    'set_oscillation',
    {
      title: 'Set oscillation (swing)',
      description:
        'Enable or disable louver swing. Applies the per-device configured oscillation positions (no raw swing codes required).',
      inputSchema: { ...deviceSelectorShape, on: z.boolean().describe('true = swing on, false = fixed/default') },
    },
    async (args) => {
      const resolved = resolveOrError(manager, args);
      if ('error' in resolved) {
        return resolved.error;
      }
      const device = resolved.device;
      const unreachable = ensureReachable(device);
      if (unreachable) {
        return unreachable;
      }
      const positions = args.on ? device.config.oscillation.on : device.config.oscillation.off;
      device.sendCommand({
        [FIELDS.swingVertical]: SWING_VERTICAL[positions.vertical],
        [FIELDS.swingHorizontal]: SWING_HORIZONTAL[positions.horizontal],
      });
      audit('set_oscillation', device, 'sent', { on: args.on, ...positions });
      return ok({ mac: device.mac, oscillation: args.on, positions, status: 'command sent' });
    },
  );

  server.registerTool(
    'set_xfan',
    {
      title: 'Set X-Fan (blow)',
      description: 'Enable/disable X-Fan (keeps the fan running after shutdown to dry the coil). Only usable if xFan is enabled in config.',
      inputSchema: { ...deviceSelectorShape, on: z.boolean() },
    },
    async (args) => {
      const resolved = resolveOrError(manager, args);
      if ('error' in resolved) {
        return resolved.error;
      }
      const device = resolved.device;
      if (!device.config.xFan) {
        return fail(`X-Fan is not enabled for ${device.mac} (${device.config.name}); set "xFan": true in config to use it.`);
      }
      const unreachable = ensureReachable(device);
      if (unreachable) {
        return unreachable;
      }
      device.sendCommand({ [FIELDS.xFan]: args.on ? ON_OFF.on : ON_OFF.off });
      audit('set_xfan', device, 'sent', { on: args.on });
      return ok({ mac: device.mac, xFan: args.on, status: 'command sent' });
    },
  );

  server.registerTool(
    'set_light',
    {
      title: 'Set display light',
      description: 'Turn the front-panel display light on/off. Only usable if lightControl is enabled in config.',
      inputSchema: { ...deviceSelectorShape, on: z.boolean() },
    },
    async (args) => {
      const resolved = resolveOrError(manager, args);
      if ('error' in resolved) {
        return resolved.error;
      }
      const device = resolved.device;
      if (!device.config.lightControl) {
        return fail(`Light control is not enabled for ${device.mac} (${device.config.name}); set "lightControl": true in config.`);
      }
      const unreachable = ensureReachable(device);
      if (unreachable) {
        return unreachable;
      }
      device.sendCommand({ [FIELDS.light]: args.on ? ON_OFF.on : ON_OFF.off });
      audit('set_light', device, 'sent', { on: args.on });
      return ok({ mac: device.mac, light: args.on, status: 'command sent' });
    },
  );

  server.registerTool(
    'set_quiet_mode',
    {
      title: 'Set quiet mode',
      description: 'Enable/disable quiet mode. Turning it on disables turbo mode.',
      inputSchema: { ...deviceSelectorShape, on: z.boolean() },
    },
    async (args) => {
      const resolved = resolveOrError(manager, args);
      if ('error' in resolved) {
        return resolved.error;
      }
      const device = resolved.device;
      const unreachable = ensureReachable(device);
      if (unreachable) {
        return unreachable;
      }
      const cmd: Record<string, number> = { [FIELDS.quiet]: args.on ? QUIET.on : QUIET.off };
      if (args.on) {
        cmd[FIELDS.turbo] = ON_OFF.off;
      }
      device.sendCommand(cmd);
      audit('set_quiet_mode', device, 'sent', { on: args.on });
      return ok({ mac: device.mac, quiet: args.on, status: 'command sent' });
    },
  );

  server.registerTool(
    'set_turbo_mode',
    {
      title: 'Set turbo mode',
      description: 'Enable/disable turbo (powerful) mode. Turning it on disables quiet mode.',
      inputSchema: { ...deviceSelectorShape, on: z.boolean() },
    },
    async (args) => {
      const resolved = resolveOrError(manager, args);
      if ('error' in resolved) {
        return resolved.error;
      }
      const device = resolved.device;
      const unreachable = ensureReachable(device);
      if (unreachable) {
        return unreachable;
      }
      const cmd: Record<string, number> = { [FIELDS.turbo]: args.on ? ON_OFF.on : ON_OFF.off };
      if (args.on) {
        cmd[FIELDS.quiet] = QUIET.off;
      }
      device.sendCommand(cmd);
      audit('set_turbo_mode', device, 'sent', { on: args.on });
      return ok({ mac: device.mac, turbo: args.on, status: 'command sent' });
    },
  );
}
