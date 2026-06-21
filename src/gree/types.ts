/** Shared GREE domain types. */

export interface OscillationPosition {
  horizontal: string;
  vertical: string;
}

export interface OscillationConfig {
  on: OscillationPosition;
  off: OscillationPosition;
}

/**
 * Per-device configuration after defaults from the top-level config have been
 * merged in. `updateInterval`, `retryInterval`, `udpPort` and `encryptionVersion`
 * are always resolved to concrete values here.
 */
export interface ResolvedDeviceConfig {
  name: string;
  room?: string;
  address?: string;
  mac: string;
  model?: string;
  nameFan?: string;
  serialNumber?: string;
  minimumTargetTemperature: number;
  maximumTargetTemperature: number;
  oscillation: OscillationConfig;
  xFan: boolean;
  lightControl: boolean;
  fakeSensor: boolean;
  sensorOffset: number;
  /** Number of physical fan speed steps (3 or 5). Used to map fan-speed requests. */
  speedSteps: 3 | 5;
  /** 0 = auto-detect, 1 = force ECB, 2 = force GCM. */
  encryptionVersion: 0 | 1 | 2;
  updateInterval: number;
  retryInterval: number;
  udpPort: number;
}

export interface ResolvedConfig {
  bearerToken: string;
  udpPort: number;
  updateInterval: number;
  retryInterval: number;
  host: string;
  port: number;
  /** Allowed CORS origins for the HTTP transport. Empty = CORS disabled. `["*"]` = any origin. */
  corsOrigins: string[];
  devices: ResolvedDeviceConfig[];
}

/** Raw status as last decoded from the device (field code -> numeric value). */
export type RawStatus = Record<string, number>;

/** Human-friendly decoded view of a device's state. */
export interface DecodedStatus {
  mac: string;
  name: string;
  room?: string;
  model?: string;
  online: boolean;
  bound: boolean;
  address?: string;
  power?: boolean;
  mode?: string;
  targetTemperature?: number;
  temperatureUnit?: string;
  currentTemperature: number | null;
  currentTemperatureEstimated: boolean;
  fanSpeed?: string;
  quiet?: boolean;
  turbo?: boolean;
  swingVertical?: string;
  swingHorizontal?: string;
  xFan?: boolean;
  light?: boolean;
  health?: boolean;
  sleep?: boolean;
  freshAir?: boolean;
  energySaving?: boolean;
  noFrost?: boolean;
  lastSeen: string | null;
}
