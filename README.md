# incidentrelay-mcp

An [MCP](https://modelcontextprotocol.io) server for
[IncidentRelay](https://github.com/roxy-wi/incidentrelay) — self-hosted on-call
scheduling, alert routing, and incident management.

It exposes IncidentRelay's **entire REST API (279 operations)** to MCP clients
(Claude Desktop, Claude Code, Cursor, …) through two layers:

- **3 gateway tools** that make *every* operation reachable, driven by the
  server's own OpenAPI document.
- **25 curated tools** that wrap the common on-call workflows (acknowledge/
  resolve alerts, incidents, on-call schedule, silences, maintenance windows)
  with typed, ergonomic inputs.

The server never modifies IncidentRelay. It is a pure REST client that
authenticates with a bearer token you provide.

## Run

No install needed — run it with `npx` (Node.js ≥ 20):

```bash
# from GitHub (works today)
IR_BASE_URL=https://incidentrelay.example.com IR_TOKEN=<token> \
  npx -y github:NikGariel/IncidentRelay-mcp

# from npm (after the package is published)
IR_BASE_URL=https://incidentrelay.example.com IR_TOKEN=<token> \
  npx -y incidentrelay-mcp
```

`npx` builds the package automatically on first run (a `prepare` script compiles
TypeScript), so no separate build step is required.

### From source

```bash
npm install   # runs the build via the prepare script
npm start
```

## Configure

The server needs the IncidentRelay base URL and a bearer token (a JWT access
token or a **personal API token** created in IncidentRelay under
*Profile → API tokens*, with the scopes you want to allow).

| Setting | Env | Flag | Required | Default |
|---|---|---|---|---|
| Base URL | `IR_BASE_URL` | `--base-url` | yes | — |
| Bearer token | `IR_TOKEN` | `--token` | yes¹ | — |
| Transport | `IR_TRANSPORT` | `--transport` | no | `stdio` |
| HTTP port | `IR_PORT` | `--port` | no | `3000` |
| HTTP host | `IR_HOST` | `--host` | no | `127.0.0.1` |
| Read-only | `IR_READONLY` | `--readonly` | no | `false` |
| Request timeout (ms) | `IR_TIMEOUT_MS` | — | no | `30000` |
| OpenAPI URL override | `IR_OPENAPI_URL` | — | no | `{base}/api/openapi.json` |
| TLS verification | `IR_VERIFY_TLS` | — | no | `true` |

¹ The token is optional only if you never call write operations.

At startup the server fetches `{IR_BASE_URL}/api/openapi.json` (a public
endpoint) to build its operation catalog, so it always matches the deployed
IncidentRelay version. If that fetch fails, it falls back to a bundled
snapshot and logs a warning.

## Use with Claude Desktop / Claude Code (stdio)

Add to your MCP client config (e.g. `claude_desktop_config.json`).

**Recommended — run the prebuilt binary directly** (starts in <0.5s, so it never
hits the client's startup timeout):

```json
{
  "mcpServers": {
    "incidentrelay": {
      "command": "node",
      "args": ["/absolute/path/to/incidentrelay-mcp/dist/index.js"],
      "env": {
        "IR_BASE_URL": "https://incidentrelay.example.com",
        "IR_TOKEN": "<personal-api-token>"
      }
    }
  }
}
```

Build it once with `npm install && npm run build` (or `npm install -g .`).

**Alternative — `npx`.** Once published to npm:

```json
{ "command": "npx", "args": ["-y", "incidentrelay-mcp"], "env": { "…": "…" } }
```

> ⚠️ Avoid `npx -y github:…` in a client config: its **first** run clones the
> repo, installs dependencies, and compiles TypeScript, which can exceed an MCP
> client's ~30s connection timeout on a cold cache. Use the prebuilt binary (or
> the npm form after publishing) for a client that spawns the server on demand.

The server itself starts instantly regardless of network: it loads a bundled
OpenAPI snapshot synchronously, then refreshes the catalog from the live server
in the background.

## Use over HTTP (Streamable HTTP)

```bash
IR_BASE_URL=https://incidentrelay.example.com IR_TOKEN=... \
  npx -y github:NikGariel/IncidentRelay-mcp --transport http --port 3000
# serves MCP at http://127.0.0.1:3000/mcp
```

The HTTP transport is stateless (one server per request), binds to
`127.0.0.1` by default, and has DNS-rebinding protection enabled.

## Tools

### Gateway (cover all 294 operations)

| Tool | Purpose |
|---|---|
| `ir_list_operations` | Search/list the API catalog by query, tag, or method. |
| `ir_describe_operation` | Show one operation's params and request-body schema. |
| `ir_call` | Execute any operation by `operationId` (or `method`+`path`). |

Typical flow: `ir_list_operations` → `ir_describe_operation` → `ir_call`.

### Curated (common on-call workflows)

Alerts: `ir_list_alerts`, `ir_get_alert`, `ir_ack_alert`, `ir_resolve_alert`,
`ir_comment_alert` ·
Incidents (v2.3 “first-class incidents”): `ir_list_incidents`, `ir_get_incident`,
`ir_create_incident` ·
On-call: `ir_who_is_on_call`, `ir_oncall_health`, `ir_list_rotations`,
`ir_create_rotation_override` ·
Silences: `ir_list_silences`, `ir_create_silence`, `ir_remove_silence` ·
Maintenance: `ir_list_maintenance_windows`, `ir_create_maintenance_window` ·
Context: `ir_list_teams`, `ir_list_routes`, `ir_list_channels`, `ir_whoami` ·
Heartbeats: `ir_list_heartbeats`, `ir_send_heartbeat`.

> Note: the bundled OpenAPI snapshot is regenerated from the target
> IncidentRelay's `/api/openapi.json`; on v2.3 the alert API lives under
> `/api/alert-groups` and incidents have a new “first-class” API (no responder
> or priority-write endpoints — those old `ir_*` tools were removed).

## Safety

- **Confirm-guard.** Destructive operations (`DELETE`, and paths with
  `disable`/`remove`/`delete`/`reset`/`regenerate-token`/`intake-token`/
  `cancel`/`merge`/`revoke`) do **not** run unless you pass `confirm: true`.
  Without it, the tool returns a dry-run preview.
- **Read-only mode.** Set `IR_READONLY=true` to refuse every non-`GET`
  operation at the tool layer.
- **Token redaction.** Bearer tokens are stripped from logs and error output.

## Security

`IR_VERIFY_TLS=false` disables TLS certificate verification for outbound calls
to IncidentRelay. This exposes traffic to man-in-the-middle attacks and should
only be used on a trusted network. For self-hosted self-signed certificates,
**prefer adding the server's CA to your trust store** (or use a properly-issued
certificate) instead of disabling verification. When disabled, the server
prints a warning at startup.

## Development

```bash
npm test          # run the vitest suite
npm run dev       # run from source with tsx
npm run build     # typecheck + emit dist/ + copy the OpenAPI snapshot
```

Regenerating the bundled OpenAPI snapshot: see
[`scripts/generate-snapshot.md`](scripts/generate-snapshot.md).

## Design & plan

- Design spec: [`docs/superpowers/specs/2026-08-17-incidentrelay-mcp-design.md`](docs/superpowers/specs/2026-08-17-incidentrelay-mcp-design.md)
- Implementation plan: [`docs/superpowers/plans/2026-08-17-incidentrelay-mcp.md`](docs/superpowers/plans/2026-08-17-incidentrelay-mcp.md)
