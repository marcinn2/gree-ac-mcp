/**
 * GreeDevice: owns a single AC unit's UDP socket and runs its lifecycle —
 * discovery (scan), binding (key handshake), background status polling, and
 * command sending.
 *
 * State machine (driven by two timers):
 *   - poll timer (updateInterval): when bound, sends a status request.
 *   - watchdog timer (retryInterval): drives handshake retries and detects when a
 *     bound device has gone silent, then re-discovers/re-binds it.
 *
 * Re-binding occurs automatically if the device stops answering (its key handshake
 * is treated as expired) — matching the reference plugin's fixed-retry behavior.
 */
import dgram from 'node:dgram';
import {
  FIELDS,
  MODE,
  FAN_SPEED,
  QUIET,
  ON_OFF,
  TEMP_UNIT,
  SWING_VERTICAL,
  SWING_HORIZONTAL,
  STATUS_COLS,
  TEMSEN_OFFSET,
  nameForValue,
} from './commands.js';
import { packMessage, unpackMessage, type EncryptionVersion } from './protocol.js';
import type { DecodedStatus, RawStatus, ResolvedDeviceConfig } from './types.js';
import type { Logger } from '../logger.js';

const BROADCAST_ADDRESS = '255.255.255.255';

interface DeviceInfo {
  brand?: string;
  model?: string;
  ver?: string;
  name?: string;
}

export class GreeDevice {
  readonly mac: string;
  readonly config: ResolvedDeviceConfig;

  address?: string;
  port: number;
  bound = false;
  lastSeen = 0;

  private readonly log: Logger;
  private socket?: dgram.Socket;
  private key?: string;
  private effectiveVersion: EncryptionVersion = 1;
  private scanned = false;
  private pendingStatusRetries = 0;
  private info: DeviceInfo = {};
  private status: RawStatus = {};

  private pollTimer?: NodeJS.Timeout;
  private watchdogTimer?: NodeJS.Timeout;
  private stopped = false;

  constructor(config: ResolvedDeviceConfig, log: Logger) {
    this.config = config;
    this.mac = config.mac;
    this.address = config.address;
    this.port = config.udpPort;
    this.log = log;
    this.resetEncryptionVersion();
  }

  // ---- lifecycle -----------------------------------------------------------

  start(): void {
    this.stopped = false;
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    this.socket = socket;
    socket.on('error', (err) => {
      this.log.error('udp socket error', { error: err.message });
    });
    socket.on('message', this.onMessage);
    socket.bind(() => {
      socket.setBroadcast(true);
      this.log.info('device handler started', {
        address: this.address ?? 'discovery',
        localPort: socket.address().port,
      });
      this.startHandshake();
      this.pollTimer = setInterval(() => this.poll(), this.config.updateInterval);
      this.watchdogTimer = setInterval(() => this.watchdog(), this.config.retryInterval);
    });
  }

  stop(): void {
    this.stopped = true;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
    }
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
    }
    this.socket?.close();
    this.socket = undefined;
  }

  // ---- state queries -------------------------------------------------------

  get online(): boolean {
    return this.bound;
  }

  getRawStatus(): RawStatus {
    return { ...this.status };
  }

  // ---- handshake & polling -------------------------------------------------

  private resetEncryptionVersion(): void {
    // For forced versions use the configured one; for auto start at v1 and let the
    // watchdog toggle to v2 if binding times out.
    this.effectiveVersion = this.config.encryptionVersion === 2 ? 2 : 1;
  }

  private startHandshake(): void {
    this.bound = false;
    this.key = undefined;
    this.scanned = false;
    this.pendingStatusRetries = 0;
    this.resetEncryptionVersion();
    this.sendScan();
  }

  private poll(): void {
    if (this.bound && this.address) {
      this.requestStatus();
    }
  }

  private watchdog(): void {
    if (this.stopped) {
      return;
    }
    const now = Date.now();

    if (this.bound) {
      if (now - this.lastSeen > this.config.retryInterval) {
        this.log.warn('device went offline (no status response); re-binding', { mac: this.mac });
        this.bound = false;
        this.startHandshake();
      }
      return;
    }

    // Not bound yet — drive the handshake forward with fixed retries.
    if (!this.scanned || !this.address) {
      this.sendScan();
      return;
    }
    if (!this.key) {
      // No bind confirmation yet. In auto mode, alternate the encryption version
      // on each retry (the reference plugin does the same on bind timeout).
      if (this.config.encryptionVersion === 0) {
        this.effectiveVersion = this.effectiveVersion === 1 ? 2 : 1;
      }
      this.sendBind();
      return;
    }
    // We have a key but no status yet. Retry a few times, then restart the whole
    // handshake (the key may be stale).
    this.pendingStatusRetries += 1;
    if (this.pendingStatusRetries > 3) {
      this.log.warn('bound but no status; restarting handshake', { mac: this.mac });
      this.startHandshake();
    } else {
      this.requestStatus();
    }
  }

  // ---- outbound messages ---------------------------------------------------

  private sendScan(): void {
    const target = this.address ?? BROADCAST_ADDRESS;
    const datagram = Buffer.from(JSON.stringify({ t: 'scan' }));
    this.socket?.send(datagram, this.port, target, (err) => {
      if (err) {
        this.log.error('scan send failed', { error: err.message });
      }
    });
  }

  private sendBind(): void {
    if (!this.address) {
      return;
    }
    this.log.debug('binding to device', { mac: this.mac, encryptionVersion: this.effectiveVersion });
    // key undefined -> encrypted with the generic key (i:1)
    this.sendEncrypted({ mac: this.mac, t: 'bind', uid: 0 });
  }

  private requestStatus(): void {
    this.sendEncrypted({ mac: this.mac, t: 'status', cols: STATUS_COLS });
  }

  /** Public: queue a command (opt/p arrays) to the device. Fire-and-forget. */
  sendCommand(cmd: Record<string, number>): void {
    const opt = Object.keys(cmd);
    const p = opt.map((k) => cmd[k]);
    // Optimistically update local cache so reads reflect the change before the
    // next poll confirms it.
    for (const k of opt) {
      this.status[k] = cmd[k];
    }
    this.sendEncrypted({ t: 'cmd', opt, p });
  }

  private sendEncrypted(message: unknown): void {
    if (!this.address || !this.socket) {
      return;
    }
    try {
      const datagram = packMessage(message, this.mac, this.effectiveVersion, this.key);
      this.socket.send(datagram, this.port, this.address, (err) => {
        if (err) {
          this.log.error('send failed', { error: err.message });
        }
      });
    } catch (err) {
      this.log.error('failed to encode message', { error: (err as Error).message });
    }
  }

  // ---- inbound messages ----------------------------------------------------

  private onMessage = (msg: Buffer, rinfo: dgram.RemoteInfo): void => {
    let parsed;
    try {
      parsed = unpackMessage(msg.toString(), this.key);
    } catch {
      // Not for us (different key / unrelated broadcast) — ignore quietly.
      return;
    }
    const { pack, version } = parsed;
    const type = String(pack.t ?? '').toLowerCase();
    try {
      switch (type) {
        case 'dev':
          this.handleDev(pack, rinfo, version);
          break;
        case 'bindok':
          this.handleBindOk(pack);
          break;
        case 'dat':
          this.handleDat(pack);
          break;
        case 'res':
          this.handleRes(pack);
          break;
        default:
          this.log.debug('ignored packet', { type });
      }
    } catch (err) {
      this.log.error('error handling packet', { type, error: (err as Error).message });
    }
  };

  private handleDev(pack: Record<string, unknown>, rinfo: dgram.RemoteInfo, version: EncryptionVersion): void {
    const mac = String(pack.mac ?? pack.cid ?? '').toLowerCase();
    if (mac !== this.mac || this.bound) {
      return;
    }
    this.address = rinfo.address;
    this.port = rinfo.port;
    this.scanned = true;
    this.lastSeen = Date.now();
    this.info = {
      brand: pack.brand as string | undefined,
      model: pack.model as string | undefined,
      ver: pack.ver as string | undefined,
      name: pack.name as string | undefined,
    };

    if (this.config.encryptionVersion === 0) {
      // Auto-detect: scan responses come encrypted with the same scheme the device
      // expects. Some devices answer scan in v1 but require v2 for binding.
      let detected: EncryptionVersion = version;
      if (detected === 1 && this.info.ver && !String(this.info.ver).startsWith('V1.')) {
        detected = 2;
      }
      this.effectiveVersion = detected;
    }

    this.log.info('device discovered', {
      mac: this.mac,
      address: this.address,
      model: this.info.model,
      version: this.info.ver,
      encryptionVersion: this.effectiveVersion,
    });
    this.sendBind();
  }

  private handleBindOk(pack: Record<string, unknown>): void {
    if (this.bound) {
      return;
    }
    this.key = pack.key as string;
    this.lastSeen = Date.now();
    this.log.debug('bind confirmed', { mac: this.mac });
    this.requestStatus();
  }

  private handleDat(pack: Record<string, unknown>): void {
    const cols = pack.cols as string[] | undefined;
    const dat = pack.dat as number[] | undefined;
    if (!cols || !dat) {
      return;
    }
    cols.forEach((col, i) => {
      this.status[col] = dat[i];
    });
    this.markSeen();
  }

  private handleRes(pack: Record<string, unknown>): void {
    const opt = pack.opt as string[] | undefined;
    const values = (pack.p ?? pack.val) as number[] | undefined;
    if (!opt || !values) {
      return;
    }
    opt.forEach((o, i) => {
      this.status[o] = values[i];
    });
    this.markSeen();
  }

  private markSeen(): void {
    this.lastSeen = Date.now();
    this.pendingStatusRetries = 0;
    if (!this.bound) {
      this.bound = true;
      this.log.info('device bound', { mac: this.mac, address: this.address });
    }
  }

  // ---- decoding helpers ----------------------------------------------------

  /** Decode the current temperature, applying the raw offset and config calibration. */
  decodeCurrentTemperature(): { celsius: number | null; estimated: boolean } {
    const raw = this.status[FIELDS.tempSensor];
    // Valid raw range is (0, 100); outside that the unit has no usable sensor reading.
    if (raw !== undefined && raw > 0 && raw < 100) {
      return { celsius: raw - TEMSEN_OFFSET + this.config.sensorOffset, estimated: false };
    }
    if (this.config.fakeSensor) {
      const target = this.status[FIELDS.targetTemp];
      return { celsius: (target ?? 25) + this.config.sensorOffset, estimated: true };
    }
    return { celsius: null, estimated: false };
  }

  /** Build the human-friendly decoded status view. */
  getDecodedStatus(): DecodedStatus {
    const s = this.status;
    const temp = this.decodeCurrentTemperature();
    const has = (code: string): boolean => s[code] !== undefined;
    return {
      mac: this.mac,
      name: this.config.name,
      room: this.config.room,
      model: this.config.model ?? this.info.model,
      online: this.online,
      bound: this.bound,
      address: this.address,
      power: has(FIELDS.power) ? s[FIELDS.power] === ON_OFF.on : undefined,
      mode: nameForValue(MODE, s[FIELDS.mode]),
      targetTemperature: s[FIELDS.targetTemp],
      temperatureUnit: nameForValue(TEMP_UNIT, s[FIELDS.tempUnit]),
      currentTemperature: temp.celsius,
      currentTemperatureEstimated: temp.estimated,
      fanSpeed: nameForValue(FAN_SPEED, s[FIELDS.fanSpeed]),
      quiet: has(FIELDS.quiet) ? s[FIELDS.quiet] === QUIET.on : undefined,
      turbo: has(FIELDS.turbo) ? s[FIELDS.turbo] === ON_OFF.on : undefined,
      swingVertical: nameForValue(SWING_VERTICAL, s[FIELDS.swingVertical]),
      swingHorizontal: nameForValue(SWING_HORIZONTAL, s[FIELDS.swingHorizontal]),
      xFan: has(FIELDS.xFan) ? s[FIELDS.xFan] === ON_OFF.on : undefined,
      light: has(FIELDS.light) ? s[FIELDS.light] === ON_OFF.on : undefined,
      health: has(FIELDS.health) ? s[FIELDS.health] === ON_OFF.on : undefined,
      sleep: has(FIELDS.sleep) ? s[FIELDS.sleep] === ON_OFF.on : undefined,
      freshAir: has(FIELDS.freshAir) ? s[FIELDS.freshAir] === ON_OFF.on : undefined,
      energySaving: has(FIELDS.energySaving) ? s[FIELDS.energySaving] === ON_OFF.on : undefined,
      noFrost: has(FIELDS.noFrost) ? s[FIELDS.noFrost] === ON_OFF.on : undefined,
      lastSeen: this.lastSeen ? new Date(this.lastSeen).toISOString() : null,
    };
  }
}
