/**
 * DeviceManager: owns the set of configured GreeDevices, starts/stops their
 * lifecycles, and resolves a device from a tool's `mac`/`name` selector.
 */
import { GreeDevice } from './device.js';
import type { ResolvedConfig } from './types.js';
import type { Logger } from '../logger.js';

export interface DeviceSelector {
  mac?: string;
  name?: string;
}

export class DeviceManager {
  private readonly devices = new Map<string, GreeDevice>();
  private readonly byName = new Map<string, GreeDevice>();

  constructor(config: ResolvedConfig, log: Logger) {
    for (const deviceConfig of config.devices) {
      const device = new GreeDevice(deviceConfig, log.child({ component: 'device', mac: deviceConfig.mac }));
      this.devices.set(device.mac, device);
      this.byName.set(deviceConfig.name.toLowerCase(), device);
    }
  }

  startAll(): void {
    for (const device of this.devices.values()) {
      device.start();
    }
  }

  stopAll(): void {
    for (const device of this.devices.values()) {
      device.stop();
    }
  }

  list(): GreeDevice[] {
    return [...this.devices.values()];
  }

  /**
   * Resolve a device from a `mac` (preferred) or `name` selector. The mac is
   * normalized the same way the config schema normalizes it.
   */
  resolve(selector: DeviceSelector): GreeDevice | undefined {
    if (selector.mac) {
      const normalized = selector.mac.toLowerCase().replace(/[:-]/g, '');
      const byMac = this.devices.get(normalized);
      if (byMac) {
        return byMac;
      }
    }
    if (selector.name) {
      const byName = this.byName.get(selector.name.toLowerCase());
      if (byName) {
        return byName;
      }
    }
    return undefined;
  }

  /** Connectivity summary for the /healthz endpoint. */
  summary(): { total: number; bound: number; unbound: number; devices: Array<{ mac: string; name: string; bound: boolean }> } {
    const devices = this.list().map((d) => ({ mac: d.mac, name: d.config.name, bound: d.bound }));
    const bound = devices.filter((d) => d.bound).length;
    return {
      total: devices.length,
      bound,
      unbound: devices.length - bound,
      devices,
    };
  }
}
