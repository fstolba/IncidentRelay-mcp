# IncidentRelay MCP Server — Design

**Date:** 2026-08-17
**Status:** Approved (design), pending implementation plan
**Owner:** nik

## 1. Purpose

Expose the full [IncidentRelay](https://github.com/roxy-wi/incidentrelay)
on-call / incident-management REST API (279 operations across 29 resource
groups) to MCP-compatible AI clients (Claude Desktop, Claude Code, Cursor, …)
as a standalone TypeScript MCP server.

The server does **not** modify IncidentRelay. It is a pure client of its REST
API, authenticating with a bearer token the operator supplies.

### Goals

- **Complete coverage** — every one of the 279 API operations is reachable.
- **Ergonomic** — the ~20 most common on-call workflows are first-class,
  typed tools, so the model does not have to discover them.
- **Client-friendly** — total tool count stays around ~25 (MCP clients
  degrade past ~50–100 tools), not 279.
- **Safe by default** — destructive operations require explicit confirmation;
  a read-only mode is available.
- **Version-adaptive** — the tool catalog is derived from the target server's
  live OpenAPI document, so it tracks the deployed IncidentRelay version.

### Non-goals

- Re-implementing IncidentRelay business logic.
- Replacing the IncidentRelay web UI or its monitoring-system webhook intake
  (those `/api/integrations/*` endpoints are reachable through the gateway but
  are not curated — they are meant for monitoring systems, not humans).
- Multi-tenant credential management (one server instance = one token).

## 2. Architecture

```
MCP client (Claude Desktop / Code / Cursor)
        │  stdio  |  streamable HTTP
   incidentrelay-mcp  (this project)
        │  Authorization: Bearer <token>
   IncidentRelay REST API  (/api/*, 279 operations)
```

At startup the server:

1. Loads config (env + CLI flags).
2. Fetches `GET {base_url}/api/openapi.json` (this endpoint is **public** — no
   auth) and parses it into an in-memory **operation catalog**:
   `operationId → { method, path, tags, summary, params, requestBody, security }`.
   `$ref`s are resolved against `components.schemas`.
3. Falls back to a **bundled snapshot** (`src/openapi/snapshot.json`, generated
   from the repo via `build_openapi_spec()`) if the live server is unreachable,
   emitting a warning to stderr.
4. Registers the gateway tools + curated tools with `McpServer`.
5. Connects the selected transport.

### 2.1 Component boundaries

| Unit | Responsibility | Depends on |
|---|---|---|
| `config` | Parse env/flags → typed `Config`. Validate required values. | — |
| `client` | One HTTP call: auth header, URL/path/query building, timeout, TLS, JSON, error normalization, token redaction. | `config` |
| `openapi/catalog` | Fetch/parse spec, resolve `$ref`, index by operationId, synthesize IDs for operations lacking one, look up operations, produce compact + detailed views. | `config`, snapshot |
| `safety` | Classify an operation (read/write/destructive), enforce confirm-guard and read-only mode. | `catalog` |
| `tools/gateway` | `ir_list_operations`, `ir_describe_operation`, `ir_call`. | `catalog`, `client`, `safety` |
| `tools/*` (curated) | Typed convenience tools; each resolves to a real operationId and calls through `client`. | `catalog`, `client`, `safety` |
| `tools/registry` | Register everything on the server; apply annotations. | all tools |
| `index` | Entry: build config, catalog, server; select transport; connect. | all |

Each unit is independently testable: `client` and `catalog` never import tool
code; tools depend on interfaces, not on transport.

## 3. Tool catalog

All tools are namespaced with the `ir_` prefix (Anthropic guidance: prefixing
by service improves tool selection).

### 3.1 Gateway tools — cover all 279 operations (3 tools)

**`ir_list_operations`** — discover operations.
- Input: `{ query?: string, tag?: string, method?: enum, limit?: number=50 }`
- Output: compact list `{ operationId, method, path, tag, summary }`, filtered
  and paginated so the model is never flooded. This is *search*, not list-all.
- Annotation: `readOnlyHint: true`.

**`ir_describe_operation`** — learn how to call one operation.
- Input: `{ operationId: string }` (or `{ method, path }`).
- Output: path/query params (name, type, required, description, enum),
  request-body JSON schema (with `$ref`s resolved), success response summary,
  required token scopes, and whether it is destructive.
- Annotation: `readOnlyHint: true`.

**`ir_call`** — execute any operation.
- Input: `{ operationId?: string, method?: enum, path?: string,
  path_params?: object, query?: object, body?: object,
  confirm?: boolean=false, response_format?: "concise"|"detailed"="concise" }`
- Resolves `operationId` (or raw `method`+`path` — needed for the 12 heartbeat
  operations that have no `operationId`), substitutes path params, appends
  query, sends body.
- **Confirm-guard**: if the op is destructive (see §5) and `confirm !== true`,
  returns a dry-run description of what *would* happen instead of executing.
- **Read-only mode**: if `IR_READONLY` and the op is not a GET, refuses.
- Annotations reflect the *maximum* danger: `readOnlyHint: false`,
  `destructiveHint: true`, `openWorldHint: true`.

The trio covers every current endpoint and any future one the server adds,
because it is driven entirely by the live OpenAPI document.

### 3.2 Curated tools — typed, first-class on-call workflows (~22 tools)

Each is a thin wrapper over `client` with an explicit Zod input schema, an
`outputSchema` where useful (returned as `structuredContent`), a `response_format`
control, and output shaped to prefer human-readable names over raw IDs.

| Group | Tool | Underlying operation(s) |
|---|---|---|
| Alerts | `ir_list_alerts` | `listAlertGroups` (filters: status, team, severity, page) |
| | `ir_get_alert` | `getAlertGroup` |
| | `ir_ack_alert` | `acknowledgeAlertGroup` |
| | `ir_resolve_alert` | `resolveAlertGroup` |
| | `ir_comment_alert` | `createAlertGroupComment` |
| Incidents | `ir_list_incidents` | `listIncidents` |
| | `ir_get_incident` | `getIncident` |
| | `ir_create_incident` | `createManualIncident` |
| | `ir_add_incident_responder` | `createIncidentResponder` |
| | `ir_set_incident_priority` | `updateIncidentPriority` |
| On-call | `ir_who_is_on_call` | `getOnCallCalendar` / rotation current on-call |
| | `ir_oncall_health` | `listTeamHealthSummaries`, `getTeamHealth` |
| | `ir_list_rotations` | `listRotations` |
| | `ir_create_rotation_override` | `createRotationOverride` |
| Silences | `ir_list_silences` | `listSilences` |
| | `ir_create_silence` | `createSilence` |
| | `ir_remove_silence` | `disableSilence` (destructive → confirm) |
| Maintenance | `ir_list_maintenance_windows` | `listMaintenanceWindows` |
| | `ir_create_maintenance_window` | `createMaintenanceWindow` |
| Context | `ir_list_teams` | `listTeams` |
| | `ir_list_routes` | `listRoutes` |
| | `ir_list_channels` | `listChannels` |
| | `ir_whoami` | `getCurrentUser` / `getProfile` |
| Heartbeats | `ir_list_heartbeats` | `GET /api/heartbeats` |
| | `ir_send_heartbeat` | `POST /api/heartbeats/ping/{token}` |

Optional: `ir_login` (`POST /api/auth/login`) to exchange username/password for
a session JWT when no token is pre-provisioned.

Curated tools **reuse** the gateway execution path (resolve operationId →
`client`), so behavior (auth, errors, guard) is identical; they only add typed
inputs and friendlier output.

## 4. Authentication & configuration

Auth model: IncidentRelay accepts `Authorization: Bearer <token>` where the
token is a JWT access token *or* a personal API token (scopes enforced
server-side per path). The MCP server just forwards the token.

| Setting | Env | Flag | Required | Default |
|---|---|---|---|---|
| Base URL | `IR_BASE_URL` | `--base-url` | yes | — |
| Bearer token | `IR_TOKEN` | `--token` | yes* | — |
| Transport | `IR_TRANSPORT` | `--transport` | no | `stdio` |
| HTTP port | `IR_PORT` | `--port` | no | `3000` |
| HTTP host | `IR_HOST` | `--host` | no | `127.0.0.1` |
| Read-only | `IR_READONLY` | `--readonly` | no | `false` |
| Request timeout | `IR_TIMEOUT_MS` | — | no | `30000` |
| OpenAPI URL override | `IR_OPENAPI_URL` | — | no | `{base}/api/openapi.json` |
| TLS verification | `IR_VERIFY_TLS` | — | no | `true` |

\* Token optional if only `ir_login` will be used to obtain one at runtime.

Tokens are never written to logs or error output (redacted).

## 5. Error handling & safety

### 5.1 Error normalization
HTTP errors → structured MCP tool errors (`isError: true`) containing:
`status`, IncidentRelay error message, `routing_error` (integration routing
failures), `error_id` (for JSON-log correlation), and `missing_scopes` on 403.
Each error ends with an **actionable suggestion** (e.g. "Token lacks
`alerts:write`. Create a token with that scope or use a different token.").

### 5.2 Destructive-operation guard
An operation is **destructive** when its method is `DELETE`, or its path/id
matches a denylist of dangerous verbs: `disable`, `remove`, `delete`, `reset`,
`regenerate-token`/`intake-token`, `cancel`, `merge`, `revoke`. Destructive ops
require `confirm: true`; otherwise the tool returns a preview of the intended
call and does not execute. `destructiveHint: true` is set on those tools.

### 5.3 Read-only mode
`IR_READONLY=true` blocks every non-`GET` operation at the `safety` layer,
before any request is sent.

### 5.4 Token efficiency (Anthropic guidance)
- List tools paginate (`page`/`page_size`, sensible defaults) and support a
  `query`/filter — search over list-all.
- `response_format: concise` (default) trims verbose fields; `detailed`
  returns the full payload.
- Responses are capped (~25k tokens); oversized responses are truncated with a
  message telling the model how to narrow the request.

## 6. Transports & security

- **stdio** (default): `StdioServerTransport`. For local clients that spawn the
  server as a subprocess.
- **Streamable HTTP** (`--transport http`): `StreamableHTTPServerTransport`
  with session IDs (`sessionIdGenerator: randomUUID`), **DNS-rebinding
  protection enabled** (`allowedHosts`/`allowedOrigins`), bound to
  `127.0.0.1` by default. Legacy SSE transport is not implemented.
- SDK pinned to `@modelcontextprotocol/sdk` **v1.x at a version past the
  April-2026 stdio RCE advisory**; dependency audit in CI.

## 7. Project structure

```
incidentrelay-mcp/
  package.json  tsconfig.json  vitest.config.ts  README.md  .gitignore
  src/
    index.ts              # entry: config → catalog → server → transport
    config.ts             # env/flags → Config
    client.ts             # HTTP client (auth, url building, errors, redaction)
    openapi/
      catalog.ts          # fetch/parse spec, $ref resolver, lookup, views
      snapshot.json       # bundled fallback spec (generated from repo)
    safety.ts             # destructive classification, confirm-guard, readonly
    format.ts             # response_format shaping, token cap/truncation
    tools/
      gateway.ts          # ir_list_operations, ir_describe_operation, ir_call
      alerts.ts incidents.ts oncall.ts silences.ts
      maintenance.ts context.ts heartbeats.ts
      registry.ts         # register all tools + annotations
  test/                   # vitest + msw (mocked IR API)
  scripts/
    generate-snapshot.md  # how to regenerate snapshot.json from the repo
  eval/                   # agentic eval tasks (realistic multi-step)
```

## 8. Testing strategy (TDD)

- **Framework:** Vitest; HTTP mocked with `msw` (or `nock`).
- **Unit:**
  - catalog: spec parse, `$ref` resolution, operationId synthesis for
    heartbeat ops, compact vs detailed views, lookup by id and by method+path.
  - client: path-param substitution, query building (incl. repeated params),
    bearer header, timeout, error normalization (`routing_error`/`error_id`/
    `missing_scopes`), token redaction.
  - safety: destructive classification table; confirm-guard preview vs execute;
    read-only blocking.
  - format: concise vs detailed; truncation over the token cap.
- **Tool tests:** each curated tool builds the expected request and shapes
  output; gateway tools resolve and execute correctly; confirm-guard path.
- **Contract test:** load the bundled snapshot; assert every curated tool maps
  to an operationId that exists, and every operation resolves — guards against
  drift when the snapshot is regenerated.
- **Eval (optional, CI-gated off by default):** ~10–20 realistic multi-step
  tasks (e.g. "acknowledge the newest critical alert for team infra and leave a
  comment") run through an agentic loop to measure tool effectiveness.
- **Integration smoke (skipped by default):** run against a live dev server
  when `IR_BASE_URL`/`IR_TOKEN` are present in the environment.

## 9. Best-practice checklist (applied)

- [x] Consolidated high-impact curated tools, not 279 wrappers.
- [x] `ir_` namespacing on every tool.
- [x] Search-style discovery (`ir_list_operations` with query/filter).
- [x] `response_format` concise/detailed + response cap.
- [x] Meaningful names in output over opaque IDs.
- [x] Actionable error messages.
- [x] Tool annotations (read-only / destructive / idempotent).
- [x] Ruthless tool descriptions incl. when-NOT-to-use.
- [x] Streamable HTTP with DNS-rebinding protection; SDK pinned past RCE.
- [x] Eval harness.

## 10. Open questions / assumptions

- Snapshot source of truth is the repo's `build_openapi_spec()`; regenerated
  manually (documented in `scripts/generate-snapshot.md`) rather than at build
  time (the MCP project does not depend on the Python app).
- `ir_who_is_on_call` exact underlying endpoint to be confirmed during
  implementation (calendar vs rotation current-on-call); both exist.
- Package name: `incidentrelay-mcp` (npm); adjust if publishing under a scope.
