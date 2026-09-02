#!/usr/bin/env node
/**
 * Entrypoint: parse CLI args, load config, start the device manager (background
 * UDP polling), and run the selected transport.
 *
 * Usage:
 *   gree-ac-mcp-server --transport stdio --config ./config.json
 *   gree-ac-mcp-server --transport http  --config ./config.json --host 0.0.0.0 --port 8080
 *
 * Config path may also come from the GREE_MCP_CONFIG environment variable.
 */
import { parseArgs } from 'node:util';
import { loadConfig, ConfigError } from './config.js';
import { createLogger, type LogLevel } from './logger.js';
import { DeviceManager } from './gree/manager.js';
import { runStdio } from './transport/stdio.js';
import { runHttp } from './transport/http.js';

interface CliOptions {
  transport: 'stdio' | 'http';
  configPath?: string;
  host?: string;
  port?: number;
  logLevel: LogLevel;
}

function parseCliOptions(): CliOptions {
  const { values } = parseArgs({
    options: {
      transport: { type: 'string', default: 'stdio' },
      config: { type: 'string' },
      host: { type: 'string' },
      port: { type: 'string' },
      'log-level': { type: 'string', default: 'info' },
    },
    allowPositionals: false,
  });

  const transport = values.transport as string;
  if (transport !== 'stdio' && transport !== 'http') {
    throw new Error(`Invalid --transport "${transport}" (expected "stdio" or "http")`);
  }

  const logLevel = values['log-level'] as string;
  if (!['debug', 'info', 'warn', 'error'].includes(logLevel)) {
    throw new Error(`Invalid --log-level "${logLevel}"`);
  }

  // CLI overrides bypass the config schema, so validate them here to the same rules.
  let port: number | undefined;
  if (values.port !== undefined) {
    port = Number(values.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`Invalid --port "${values.port}" (expected an integer 1-65535)`);
    }
  }

  const host = values.host;
  if (host !== undefined && host.trim() === '') {
    throw new Error('Invalid --host (must not be empty)');
  }

  return {
    transport,
    configPath: values.config ?? process.env.GREE_MCP_CONFIG,
    host,
    port,
    logLevel: logLevel as LogLevel,
  };
}

async function main(): Promise<void> {
  const cli = parseCliOptions();
  const log = createLogger(cli.logLevel);

  if (!cli.configPath) {
    throw new Error('No config file specified. Use --config <path> or set GREE_MCP_CONFIG.');
  }

  const config = loadConfig(cli.configPath);
  // CLI flags override config defaults for HTTP bind host/port.
  if (cli.host !== undefined) {
    config.host = cli.host;
  }
  if (cli.port !== undefined) {
    config.port = cli.port;
  }

  log.info('starting gree-ac-mcp-server', {
    transport: cli.transport,
    devices: config.devices.length,
  });

  const manager = new DeviceManager(config, log);
  manager.startAll();

  const shutdown = (signal: string): void => {
    log.info('shutting down', { signal });
    manager.stopAll();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  if (cli.transport === 'stdio') {
    await runStdio(manager, log);
  } else {
    await runHttp(config, manager, log);
  }
}

main().catch((err) => {
  if (err instanceof ConfigError) {
    process.stderr.write(`${err.message}\n`);
  } else {
    process.stderr.write(`Fatal error: ${(err as Error).message}\n`);
  }
  process.exit(1);
});
