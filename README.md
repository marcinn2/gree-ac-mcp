# gree-ac-mcp-server

A [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that controls
**GREE / EWPE-compatible WiFi air conditioners** directly over their native UDP protocol.
No Homebridge, no cloud — it talks straight to the units on your LAN.

The GREE wire protocol (AES encryption, scan/bind/status/command flow) is implemented from
scratch based on [eibenp/homebridge-gree-airconditioner](https://github.com/eibenp/homebridge-gree-airconditioner)
and [tomikaa87/gree-remote](https://github.com/tomikaa87/gree-remote).

- **Two transports:** MCP `stdio` (for Claude Desktop and other local clients) and `http`
  (modern Streamable HTTP **and** legacy HTTP+SSE), with mandatory bearer auth on HTTP.
- **Both encryption schemes:** v1 (AES-128-ECB) and v2 (AES-128-GCM), auto-detected per device.
- **Background polling:** each device is bound and polled continuously; tool calls fire
  immediately and the next poll confirms the new state.

---

## Requirements

- Node.js >= 22
- The AC units must be on the same LAN/subnet as the server (UDP broadcast/unicast to port 7000).

## Install & build

```bash
npm install
npm run build
```

## Quick start

```bash
cp config.example.json config.json
# edit config.json: set bearerToken and your devices' mac/address

# stdio (local MCP clients)
npm run start:stdio -- --config ./config.json

# HTTP (network clients)
npm run start:http -- --config ./config.json --host 0.0.0.0 --port 8080
```

During development you can run the TypeScript directly with `npm run dev:stdio` / `npm run dev:http`.

## CLI flags

| Flag | Default | Description |
|------|---------|-------------|
| `--transport <stdio\|http>` | `stdio` | Transport mode. |
| `--config <path>` | `$GREE_MCP_CONFIG` | Path to the config file (required). |
| `--host <host>` | `0.0.0.0` | HTTP bind host (http mode). Overrides config. Must be non-empty. |
| `--port <port>` | `8080` | HTTP bind port (http mode). Overrides config. Must be an integer 1–65535. |
| `--log-level <debug\|info\|warn\|error>` | `info` | Log verbosity (JSON lines on **stderr**). |

The config file path may also be supplied via the `GREE_MCP_CONFIG` environment variable.

---

## Configuration

JSON file validated with [zod](https://zod.dev). On a validation error the server prints the
offending field/device and exits non-zero. **The server must be restarted to pick up config
changes** (hot-reload is not implemented).

### Top-level fields

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `bearerToken` | string | — (required) | Token required on every HTTP/SSE request. **Minimum 32 characters.** Ignored in stdio mode. |
| `udpPort` | number | `7000` | UDP port the devices listen on. |
| `updateInterval` | number (ms) | `1000` | Default status-poll interval. |
| `retryInterval` | number (ms) | `5000` | Default retry/offline-detection interval. |
| `host` | string | `0.0.0.0` | Default HTTP bind host (overridable by `--host`). |
| `port` | number | `8080` | Default HTTP bind port (overridable by `--port`). |
| `corsOrigins` | string[] | `[]` | Allowed CORS origins for HTTP mode. Empty disables CORS; `["*"]` allows any origin; otherwise an explicit allow-list. |
| `devices` | array | — (required, ≥1) | One entry per AC. Duplicate `mac` **and duplicate `name`** (case-insensitive) values are rejected. |

### Per-device fields

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `name` | string | — (required) | Friendly name; usable as a tool selector alias. |
| `room` | string | — | Optional grouping label. |
| `address` | IPv4 string | — | If set, the server unicasts to it. If omitted, it discovers the IP by MAC via UDP broadcast, then caches it. |
| `mac` | string | — (required) | 12 hex chars (separators/case are normalized). **Primary key** for all tools and binding. |
| `model` | string | — | Display only. |
| `nameFan` | string | — | Optional separate fan name (display only). |
| `serialNumber` | string | — | Optional; reserved for key-cache identity. |
| `minimumTargetTemperature` | number | `16` | Lower bound for `set_target_temperature`. |
| `maximumTargetTemperature` | number | `30` | Upper bound for `set_target_temperature`. |
| `oscillation.on/off.{horizontal,vertical}` | enum | on=`full`, off=`default` | Swing positions applied by `set_oscillation`. See enums below. |
| `xFan` | boolean | `false` | Gates the `set_xfan` tool for this device. |
| `lightControl` | boolean | `false` | Gates the `set_light` tool for this device. |
| `fakeSensor` | boolean | `false` | If the unit has no real sensor, estimate current temp from target and flag `estimated: true`. |
| `sensorOffset` | number (°C) | `0` | Calibration added to the decoded current temperature. |
| `speedSteps` | `3` \| `5` | `5` | Physical fan steps; used to map `set_fan_speed` down on 3-speed units. |
| `encryptionVersion` | `0` \| `1` \| `2` | `0` | `0` = auto-detect, `1` = force ECB, `2` = force GCM. |
| `updateInterval` | number (ms) | inherits top-level | Per-device override. |
| `retryInterval` | number (ms) | inherits top-level | Per-device override. |

> **Note on `sensorOffset` and temperature decoding.** Most GREE units report the internal
> sensor (`TemSen`) as `actual°C + 40`. The server subtracts that fixed base offset to decode,
> then adds your `sensorOffset` as a calibration on top. So `currentTemperature = TemSen − 40 + sensorOffset`.

### Swing position enums

- **Vertical (`SwUpDn`):** `default`, `full`, `fixed-top`, `fixed-upper-middle`, `fixed-middle`,
  `fixed-lower-middle`, `fixed-bottom` (plus `swing-top`/`swing-upper-middle`/`swing-middle`/`swing-lower-middle`/`swing-bottom`).
- **Horizontal (`SwingLfRig`, only on units with horizontal louvers):** `default`, `full`,
  `fixed-left`, `fixed-center-left`, `fixed-center`, `fixed-center-right`, `fixed-right`.

### How to obtain a device's MAC

The MAC is the GREE device id (a 12-hex string, e.g. `502cc6aabbcc`). Following the homebridge
plugin's documented method, the easiest way is to **run this server (or the homebridge plugin)
with debug logging on the same LAN** and watch the scan responses:

```bash
node dist/index.js --transport http --config ./config.json --log-level debug
```

Every discovered unit logs a `device discovered` line containing its `mac`, `address`, `model`
and firmware `version`. Other options:

- Check your router's DHCP client list for the AC's WiFi adapter MAC (drop the colons, lowercase it).
- Use the official GREE+ / EWPE Smart app, or any GREE scan utility, which reports the device id.

---

## MCP tools

Every tool accepts a device selector: **`mac`** (canonical) or **`name`** (alias, matched against
config). Provide one of them. `set_*` tools fire the UDP command immediately and report
`"command sent"`; the background poll loop confirms the new state shortly after. If a device is
offline/unbound, write tools return an error instead of silently succeeding.

| Tool | Input schema | Description |
|------|--------------|-------------|
| `list_devices` | `{}` | All configured devices with `online`/`bound` status and last-known mode/temp. |
| `get_device_status` | `{ mac?, name? }` | Full decoded status of one device. |
| `get_room_temperature` | `{ mac?, name? }` | Calibrated current temp (°C). Flags `estimated: true` when derived via `fakeSensor`. |
| `set_power` | `{ mac?, name?, on: boolean }` | Turn the unit on/off. |
| `set_mode` | `{ mac?, name?, mode: "auto"\|"cool"\|"dry"\|"fan"\|"heat" }` | Set mode (also powers on). |
| `set_target_temperature` | `{ mac?, name?, temperature: number }` | Set target °C. **Rejected** (not clamped) if out of the device's min/max range. |
| `set_fan_speed` | `{ mac?, name?, speed: "auto"\|"quiet"\|"low"\|"medium-low"\|"medium"\|"medium-high"\|"high"\|"turbo" }` | Set fan speed; `quiet`/`turbo` engage dedicated modes; mapped down on 3-speed units. |
| `set_oscillation` | `{ mac?, name?, on: boolean }` | Apply the configured on/off swing positions. |
| `set_xfan` | `{ mac?, name?, on: boolean }` | X-Fan / blow. Only usable when `xFan: true`. |
| `set_light` | `{ mac?, name?, on: boolean }` | Display light. Only usable when `lightControl: true`. |
| `set_quiet_mode` | `{ mac?, name?, on: boolean }` | Quiet mode (turning on disables turbo). |
| `set_turbo_mode` | `{ mac?, name?, on: boolean }` | Turbo/powerful mode (turning on disables quiet). |

Each device is also exposed as a **resource** at `gree://device/<mac>` returning its decoded
status as JSON.

---

## Using with Claude Desktop (stdio)

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "gree-ac": {
      "command": "node",
      "args": [
        "/absolute/path/to/gree-ac-mcp-server/dist/index.js",
        "--transport", "stdio",
        "--config", "/absolute/path/to/config.json"
      ]
    }
  }
}
```

No bearer token is needed in stdio mode (the process pipe is the trust boundary).

---

## HTTP usage

Bearer auth is **mandatory** on `/mcp`, `/sse` and `/messages`. Missing/invalid tokens get
`401` with a `WWW-Authenticate: Bearer` header. `/healthz` is **unauthenticated** and returns only anonymized device identifiers (vendor-prefix-only MAC, first-letter-only name).

### CORS (browser clients)

For browser-based MCP clients (e.g. the MCP Inspector) set `corsOrigins` in the config. CORS is
**disabled by default** (no headers added), so non-browser clients like Claude Desktop are
unaffected. When enabled:

- `OPTIONS` preflight is answered **before** auth (preflight carries no `Authorization` header).
- The `Mcp-Session-Id` response header is exposed so client JS can read the session id.
- Auth is still enforced on the actual request; only listed origins get an `Access-Control-Allow-Origin`.

```jsonc
// config.json
"corsOrigins": ["https://inspector.example.com"]   // or ["*"] to allow any origin
```

### Health check

```bash
curl http://localhost:8080/healthz
# {"status":"ok","total":2,"bound":1,"unbound":1,
#  "devices":[{"mac":"502cc6******","name":"T***","bound":true}]}
```

### Modern Streamable HTTP

Initialize (note the required `Accept` header and that the session id comes back in a response header):

```bash
curl -i -X POST http://localhost:8080/mcp \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1.0"}}}'
# -> response header:  Mcp-Session-Id: <uuid>
```

Then reuse that session id:

```bash
SID=<uuid-from-above>

# complete the handshake
curl -s -X POST http://localhost:8080/mcp \
  -H "Authorization: Bearer YOUR_TOKEN" -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" -H "Mcp-Session-Id: $SID" \
  -d '{"jsonrpc":"2.0","method":"notifications/initialized"}'

# list devices
curl -s -X POST http://localhost:8080/mcp \
  -H "Authorization: Bearer YOUR_TOKEN" -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" -H "Mcp-Session-Id: $SID" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_devices","arguments":{}}}'

# turn a unit on
curl -s -X POST http://localhost:8080/mcp \
  -H "Authorization: Bearer YOUR_TOKEN" -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" -H "Mcp-Session-Id: $SID" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"set_power","arguments":{"mac":"502cc6aabbcc","on":true}}}'
```

### Legacy HTTP+SSE

```bash
# 1) open the event stream (keeps running; prints the "endpoint" event with your sessionId)
curl -N http://localhost:8080/sse -H "Authorization: Bearer YOUR_TOKEN"

# 2) post messages to the endpoint reported by the stream (sessionId from the endpoint event)
curl -X POST "http://localhost:8080/messages?sessionId=YOUR_SESSION_ID" \
  -H "Authorization: Bearer YOUR_TOKEN" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

---

## Docker

The image is multi-stage and runs as the non-root `node` user, defaulting to HTTP mode reading
`/config/config.json`.

Prebuilt multi-arch images (`linux/amd64` + `linux/arm64`) are published to GitHub Container
Registry:

```bash
docker run --rm \
  --network host \
  -v "$(pwd)/config.json:/config/config.json:ro" \
  ghcr.io/marcinn2/gree-ac-mcp:latest
```

Or build it yourself:

```bash
docker build -t gree-ac-mcp-server .
docker run --rm \
  --network host \
  -v "$(pwd)/config.json:/config/config.json:ro" \
  gree-ac-mcp-server
```

> UDP discovery/broadcast needs L2 access to the AC's subnet. `--network host` is the simplest
> way to give the container that on Linux; otherwise set each device's `address` explicitly and
> ensure UDP/7000 routing to the units works from the container network.

The container `EXPOSE`s `8080`. Override the entrypoint args to change transport/port, e.g.
`docker run ... gree-ac-mcp-server --transport http --config /config/config.json --port 9000`.

---

## Logging & security

- Logs are JSON lines on **stderr** (stdout is reserved for the MCP channel in stdio mode),
  including device `mac`, `action`, and `outcome`.
- The bearer token and all AES/device keys are **never logged**.
- **Logs contain device identifiers (`mac`, IP address).** When running as a long-lived service
  (systemd, Docker, etc.), cap retention with normal log rotation so these don't accumulate
  indefinitely. Keep the default `--log-level info`; `debug` logs more identifiers.
- **HTTP mode uses plaintext bearer auth.** Run it only on a **trusted home LAN**, or put a
  TLS-terminating reverse proxy (Caddy, nginx, …) in front of it — otherwise the token and
  request data are exposed in transit. `stdio` mode has no network exposure.

> This is a self-hosted, personal/household tool with no analytics, no third-party services, and
> no on-disk data persistence (device state is kept in memory only). Configuration — including
> your `bearerToken` and device MACs — lives in your local `config.json`, which `.gitignore`
> already excludes from version control.

## Testing

```bash
npm test
```

Covers the protocol crypto (v1/v2 encrypt-decrypt round-trips and a known-answer vector, plus
envelope pack/unpack), config-schema validation (defaults, MAC normalization, interval
inheritance, duplicate-MAC/duplicate-name, bad-value and short-`bearerToken` rejection), the
bearer-auth middleware (accepts the correct token; rejects wrong, mismatched-length and malformed
ones), and the CORS middleware (origin allow-listing, wildcard, and preflight handling).

## Project layout

```
src/
  index.ts            entrypoint: CLI args, config load, lifecycle
  config.ts           zod schema, validation, defaults
  logger.ts           JSON-lines logger (stderr)
  gree/
    protocol.ts       AES v1/v2 + pack envelope
    commands.ts       field codes, value maps, swing maps
    device.ts         GreeDevice: scan/bind/poll/command state machine
    manager.ts        DeviceManager: registry, resolve, health summary
    types.ts          shared types
  mcp/
    server.ts         McpServer construction
    tools.ts          tool handlers
    resources.ts      per-device resources
  transport/
    stdio.ts          stdio transport
    http.ts           Streamable HTTP + legacy SSE + /healthz
  auth/
    bearer.ts         bearer-token middleware
```

## Out of scope

- **No GCloud-bridged / sub-device (bridge) topology.** The reference plugin supports devices
  behind a bridge (`mac@bridgemac`); this server intentionally targets directly-addressable WiFi
  units only. *TODO: add bridge/sub-device discovery and the `subDev`/`sublist` handshake if needed.*
- No web UI.

---

## Disclaimer

This is an independent, unofficial project. It is **not affiliated with, endorsed by, or
supported by GREE Electric Appliances Inc.** or any of its subsidiaries. "GREE" and any related
trademarks belong to their respective owners and are used here only to describe compatibility.

I built this in my free time and maintain it as a personal hobby project. It is provided **as-is,
without any warranty**; use it at your own risk. It controls real heating/cooling hardware, so
test carefully in your own environment.

### GDPR / data protection

This is a **self-hosted, personal/household tool**. It runs entirely on your own machine/LAN, has
no analytics or third-party services, makes no external network calls, and persists nothing to
disk (device state is kept in memory; your `bearerToken` and device MACs live only in your local
`config.json`). The only personal-data-adjacent values it handles are **device identifiers (MAC
and LAN IP addresses)**, which may appear in logs.

Used for your own home, this typically falls under the GDPR **"purely personal or household
activity" exemption** (Art. 2(2)(c), Recital 18), meaning the GDPR generally does not apply. If
you instead deploy it in a context where you process other people's data (e.g. a workplace, rental
property, or any commercial setting), **you are the data controller** and are solely responsible
for your own GDPR compliance, including transport security, log retention, transparency, and any
required legal basis.

Any compliance commentary, scan, or assessment associated with this project is a **preliminary,
informational aid only — it is not legal advice and is not a substitute for a qualified legal
audit.** The authors accept no liability for how the software is deployed or used.
