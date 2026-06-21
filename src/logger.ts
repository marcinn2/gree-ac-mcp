/**
 * Minimal structured logger emitting one JSON object per line.
 *
 * IMPORTANT: all output goes to stderr. In stdio transport mode, stdout is the
 * MCP message channel and must not be polluted with log lines.
 *
 * Never pass secrets (bearer token, AES keys, device keys) to these methods.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

function createLoggerInternal(minLevel: LogLevel, bindings: Record<string, unknown>): Logger {
  const threshold = LEVEL_ORDER[minLevel];

  function emit(level: LogLevel, msg: string, fields?: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < threshold) {
      return;
    }
    const line = {
      time: new Date().toISOString(),
      level,
      msg,
      ...bindings,
      ...fields,
    };
    process.stderr.write(JSON.stringify(line) + '\n');
  }

  return {
    debug: (msg, fields) => emit('debug', msg, fields),
    info: (msg, fields) => emit('info', msg, fields),
    warn: (msg, fields) => emit('warn', msg, fields),
    error: (msg, fields) => emit('error', msg, fields),
    child: (extra) => createLoggerInternal(minLevel, { ...bindings, ...extra }),
  };
}

export function createLogger(minLevel: LogLevel = 'info'): Logger {
  return createLoggerInternal(minLevel, {});
}
