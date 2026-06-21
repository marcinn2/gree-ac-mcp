/**
 * GREE / EWPE device parameter (field) codes and value maps.
 *
 * Cross-checked against the homebridge-gree-airconditioner plugin (src/commands.ts)
 * and the tomikaa87/gree-remote protocol documentation.
 */

/** Device parameter field codes (used in status `cols` and command `opt`). */
export const FIELDS = {
  power: 'Pow',
  mode: 'Mod',
  targetTemp: 'SetTem',
  tempUnit: 'TemUn',
  tempRec: 'TemRec', // 0.5°C correction bit when reporting in Fahrenheit
  tempSensor: 'TemSen', // internal temperature sensor (raw, offset-encoded)
  fanSpeed: 'WdSpd',
  swingHorizontal: 'SwingLfRig',
  swingVertical: 'SwUpDn',
  xFan: 'Blo', // "blow" / X-Fan: keep blowing after power-off to dry the coil
  freshAir: 'Air', // fresh air valve
  health: 'Health', // "cold plasma" / health mode
  sleep: 'SwhSlp', // sleep mode flag
  sleepMode: 'SlpMod', // sleep curve flag (kept in sync with SwhSlp)
  light: 'Lig', // display light
  quiet: 'Quiet', // quiet mode
  turbo: 'Tur', // turbo / powerful mode
  noFrost: 'StHt', // 8°C heating / anti-frost
  heatCoolType: 'HeatCoolType',
  energySaving: 'SvSt', // SE / energy saving
} as const;

export type FieldCode = (typeof FIELDS)[keyof typeof FIELDS];

/** Operating modes (Mod). */
export const MODE = {
  auto: 0,
  cool: 1,
  dry: 2,
  fan: 3,
  heat: 4,
} as const;

export type ModeName = keyof typeof MODE;

/** Fan speed steps (WdSpd). mediumLow/mediumHigh are unavailable on 3-speed units. */
export const FAN_SPEED = {
  auto: 0,
  low: 1,
  mediumLow: 2,
  medium: 3,
  mediumHigh: 4,
  high: 5,
} as const;

/** Quiet mode (Quiet) — note the "on" value is 2, not 1. */
export const QUIET = {
  off: 0,
  on: 2,
} as const;

/** Generic boolean on/off used by most flags. */
export const ON_OFF = {
  off: 0,
  on: 1,
} as const;

/** Temperature unit (TemUn). */
export const TEMP_UNIT = {
  celsius: 0,
  fahrenheit: 1,
} as const;

/**
 * Vertical swing positions (SwUpDn).
 * The config-facing enum names map to the GREE numeric codes below.
 */
export const SWING_VERTICAL: Record<string, number> = {
  default: 0,
  full: 1,
  'fixed-top': 2,
  'fixed-upper-middle': 3,
  'fixed-middle': 4,
  'fixed-lower-middle': 5,
  'fixed-bottom': 6,
  // swing-within-region codes (7-11) are also valid on some units
  'swing-bottom': 7,
  'swing-lower-middle': 8,
  'swing-middle': 9,
  'swing-upper-middle': 10,
  'swing-top': 11,
};

/**
 * Horizontal swing positions (SwingLfRig). Only on units with horizontal louver control.
 */
export const SWING_HORIZONTAL: Record<string, number> = {
  default: 0,
  full: 1,
  'fixed-left': 2,
  'fixed-center-left': 3,
  'fixed-center': 4,
  'fixed-center-right': 5,
  'fixed-right': 6,
};

/** Enum value lists for zod schema validation. */
export const SWING_VERTICAL_NAMES = Object.keys(SWING_VERTICAL);
export const SWING_HORIZONTAL_NAMES = Object.keys(SWING_HORIZONTAL);

/**
 * Raw offset applied to the TemSen field: most GREE units report the internal
 * temperature sensor as (actual°C + 40). Subtract this to decode, then apply the
 * per-device `sensorOffset` calibration on top.
 */
export const TEMSEN_OFFSET = 40;

/** Fields requested on every status poll. */
export const STATUS_COLS: string[] = [
  FIELDS.power,
  FIELDS.mode,
  FIELDS.targetTemp,
  FIELDS.tempSensor,
  FIELDS.tempUnit,
  FIELDS.tempRec,
  FIELDS.fanSpeed,
  FIELDS.swingHorizontal,
  FIELDS.swingVertical,
  FIELDS.xFan,
  FIELDS.freshAir,
  FIELDS.health,
  FIELDS.sleep,
  FIELDS.sleepMode,
  FIELDS.light,
  FIELDS.quiet,
  FIELDS.turbo,
  FIELDS.noFrost,
  FIELDS.heatCoolType,
  FIELDS.energySaving,
];

/** Reverse-lookup helper: numeric value -> enum name. */
export function nameForValue(map: Record<string, number>, value: number | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  for (const [name, v] of Object.entries(map)) {
    if (v === value) {
      return name;
    }
  }
  return undefined;
}
