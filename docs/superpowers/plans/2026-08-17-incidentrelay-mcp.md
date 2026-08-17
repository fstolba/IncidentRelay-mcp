# IncidentRelay MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone TypeScript MCP server that exposes IncidentRelay's entire 279-operation REST API to MCP clients through 3 spec-driven gateway tools plus ~22 curated on-call tools.

**Architecture:** A pure REST client of IncidentRelay. At startup it loads IncidentRelay's public OpenAPI document (live, with a bundled snapshot fallback) into an in-memory operation catalog. Three gateway tools (`ir_list_operations`, `ir_describe_operation`, `ir_call`) make every operation reachable; ~22 declaratively-defined curated tools wrap the common on-call workflows. A shared HTTP client, a safety layer (confirm-guard + read-only), and a response formatter are reused by every tool. Runs over stdio or stateless Streamable HTTP.

**Tech Stack:** Node 20+, TypeScript (ESM, NodeNext), `@modelcontextprotocol/sdk` v1.x, `zod` v3, `express` + `cors` (HTTP transport), `undici` (TLS control), `vitest` + `msw` (tests).

**Spec:** `docs/superpowers/specs/2026-08-17-incidentrelay-mcp-design.md`

## Global Constraints

- Package name `incidentrelay-mcp`; all MCP tools are prefixed `ir_`.
- ESM only: `"type": "module"`; TS `module`/`moduleResolution` = `NodeNext`; relative imports use `.js` extensions.
- SDK pinned to `@modelcontextprotocol/sdk` **^1.x at the latest patched 1.x release** (past the April-2026 stdio RCE advisory). Do not use the 2.0 alpha.
- `zod` v3 (`^3.23.0`) — SDK v1.x expects zod v3; tool `inputSchema` is a `ZodRawShape` (a plain object of zod validators), not `z.object(...)`.
- Config values and defaults exactly as in spec §4: `IR_BASE_URL` (required), `IR_TOKEN`, `IR_TRANSPORT`=`stdio`, `IR_PORT`=`3000`, `IR_HOST`=`127.0.0.1`, `IR_READONLY`=`false`, `IR_TIMEOUT_MS`=`30000`, `IR_OPENAPI_URL`, `IR_VERIFY_TLS`=`true`.
- Bearer tokens must never appear in logs or error output — redact them.
- TLS verification is **on by default** (`IR_VERIFY_TLS=true`). Disabling it (for self-hosted self-signed certs) enables MITM risk, so it must be an explicit opt-out AND emit a loud stderr warning at startup; the README must document adding the CA to the trust store as the preferred alternative.
- Destructive verbs denylist (exact): `disable`, `remove`, `delete`, `reset`, `regenerate-token`, `intake-token`, `cancel`, `merge`, `revoke`. Method `DELETE` is always destructive.
- All test commands: `npx vitest run <file>`; the build command: `npm run build`.

---

### Task 0: Project scaffolding

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore` (exists — verify), `src/version.ts`, `test/smoke.test.ts`

**Interfaces:**
- Produces: `SERVER_NAME = "incidentrelay-mcp"`, `SERVER_VERSION: string` exported from `src/version.ts`.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "incidentrelay-mcp",
  "version": "0.1.0",
  "description": "MCP server for IncidentRelay on-call / incident management",
  "type": "module",
  "bin": { "incidentrelay-mcp": "dist/index.js" },
  "main": "dist/index.js",
  "files": ["dist", "src/openapi/snapshot.json"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "dev": "tsx src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "engines": { "node": ">=20" },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.20.0",
    "zod": "^3.23.0",
    "express": "^4.19.2",
    "cors": "^2.8.5",
    "undici": "^6.19.0"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "tsx": "^4.16.0",
    "vitest": "^2.0.0",
    "msw": "^2.3.0",
    "@types/node": "^20.14.0",
    "@types/express": "^4.17.21",
    "@types/cors": "^2.8.17"
  }
}
```

> When implementing, run `npm view @modelcontextprotocol/sdk version` and pin the caret to the latest 1.x.

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Write `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node", include: ["test/**/*.test.ts"] },
});
```

- [ ] **Step 4: Write `src/version.ts`**

```ts
export const SERVER_NAME = "incidentrelay-mcp";
export const SERVER_VERSION = "0.1.0";
```

- [ ] **Step 5: Write smoke test `test/smoke.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { SERVER_NAME, SERVER_VERSION } from "../src/version.js";

describe("scaffolding", () => {
  it("exposes server identity", () => {
    expect(SERVER_NAME).toBe("incidentrelay-mcp");
    expect(SERVER_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
```

- [ ] **Step 6: Install and verify**

Run: `npm install && npx vitest run test/smoke.test.ts && npm run build`
Expected: install succeeds, test PASSES, `dist/` is produced.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold incidentrelay-mcp TypeScript project"
```

---

### Task 1: Config module

**Files:**
- Create: `src/config.ts`
- Test: `test/config.test.ts`

**Interfaces:**
- Produces:
  - `interface Config { baseUrl: string; token?: string; transport: "stdio"|"http"; port: number; host: string; readonly: boolean; timeoutMs: number; openapiUrl: string; verifyTls: boolean }`
  - `function loadConfig(argv: string[], env: NodeJS.ProcessEnv): Config` — flags override env; throws `Error` if `baseUrl` missing.
  - `function redact(text: string, token?: string): string` — replaces the token (and any `Bearer <...>`) with `***`.

- [ ] **Step 1: Write failing test `test/config.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { loadConfig, redact } from "../src/config.js";

describe("loadConfig", () => {
  it("reads env and applies defaults", () => {
    const c = loadConfig([], { IR_BASE_URL: "https://ir.example.com", IR_TOKEN: "t" });
    expect(c.baseUrl).toBe("https://ir.example.com");
    expect(c.transport).toBe("stdio");
    expect(c.port).toBe(3000);
    expect(c.host).toBe("127.0.0.1");
    expect(c.readonly).toBe(false);
    expect(c.timeoutMs).toBe(30000);
    expect(c.verifyTls).toBe(true);
    expect(c.openapiUrl).toBe("https://ir.example.com/api/openapi.json");
  });

  it("lets flags override env", () => {
    const c = loadConfig(
      ["--transport", "http", "--port", "8080", "--readonly", "--base-url", "https://a.io"],
      { IR_BASE_URL: "https://b.io", IR_TRANSPORT: "stdio" }
    );
    expect(c.baseUrl).toBe("https://a.io");
    expect(c.transport).toBe("http");
    expect(c.port).toBe(8080);
    expect(c.readonly).toBe(true);
  });

  it("throws when base url is missing", () => {
    expect(() => loadConfig([], {})).toThrow(/IR_BASE_URL/);
  });
});

describe("redact", () => {
  it("hides the token", () => {
    expect(redact("auth Bearer secret123 done", "secret123")).not.toContain("secret123");
    expect(redact("Authorization: Bearer abc.def.ghi")).toContain("***");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/config.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `src/config.ts`**

```ts
export interface Config {
  baseUrl: string;
  token?: string;
  transport: "stdio" | "http";
  port: number;
  host: string;
  readonly: boolean;
  timeoutMs: number;
  openapiUrl: string;
  verifyTls: boolean;
}

function parseFlags(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function bool(v: string | boolean | undefined, dflt: boolean): boolean {
  if (v === undefined) return dflt;
  if (typeof v === "boolean") return v;
  return !["false", "0", "no", "off"].includes(v.toLowerCase());
}

export function loadConfig(argv: string[], env: NodeJS.ProcessEnv): Config {
  const f = parseFlags(argv);
  const baseUrl = (f["base-url"] as string) ?? env.IR_BASE_URL;
  if (!baseUrl) throw new Error("IR_BASE_URL (or --base-url) is required");
  const trimmedBase = baseUrl.replace(/\/+$/, "");
  const transportRaw = (f["transport"] as string) ?? env.IR_TRANSPORT ?? "stdio";
  const transport = transportRaw === "http" ? "http" : "stdio";
  return {
    baseUrl: trimmedBase,
    token: (f["token"] as string) ?? env.IR_TOKEN,
    transport,
    port: Number((f["port"] as string) ?? env.IR_PORT ?? 3000),
    host: (f["host"] as string) ?? env.IR_HOST ?? "127.0.0.1",
    readonly: bool(f["readonly"], bool(env.IR_READONLY, false)),
    timeoutMs: Number(env.IR_TIMEOUT_MS ?? 30000),
    openapiUrl: (env.IR_OPENAPI_URL as string) ?? `${trimmedBase}/api/openapi.json`,
    verifyTls: bool(env.IR_VERIFY_TLS, true),
  };
}

export function redact(text: string, token?: string): string {
  let out = text;
  if (token) out = out.split(token).join("***");
  return out.replace(/Bearer\s+[A-Za-z0-9._\-]+/g, "Bearer ***");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts test/config.test.ts
git commit -m "feat: config loading with flag/env precedence and token redaction"
```

---

### Task 2: OpenAPI catalog

**Files:**
- Create: `src/openapi/catalog.ts`
- Test: `test/catalog.test.ts`
- Uses: `src/openapi/snapshot.json` (already committed)

**Interfaces:**
- Produces:
  - `interface OpParam { name: string; in: "path"|"query"|"header"; required: boolean; description?: string; schema?: unknown }`
  - `interface CatalogOperation { operationId: string; method: string; path: string; tags: string[]; summary: string; description?: string; parameters: OpParam[]; requestBodySchema?: unknown }`
  - `interface CompactOperation { operationId: string; method: string; path: string; tag: string; summary: string }`
  - `class Catalog { list(opts): CompactOperation[]; get(id): CatalogOperation|undefined; findByMethodPath(m, p): CatalogOperation|undefined; describe(id): object|undefined; size: number }`
  - `function buildCatalog(spec: any): Catalog`
  - `function loadSnapshotSpec(): any`
  - `async function loadSpec(cfg: { openapiUrl: string; timeoutMs: number }): Promise<{ spec: any; source: "live"|"snapshot" }>`
- Consumes: `Config` shape fields `openapiUrl`, `timeoutMs` from Task 1.

- [ ] **Step 1: Write failing test `test/catalog.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { buildCatalog } from "../src/openapi/catalog.js";

const SPEC = {
  openapi: "3.0.3",
  components: {
    schemas: {
      Ack: { type: "object", properties: { note: { type: "string" } } },
    },
  },
  paths: {
    "/api/alerts": {
      get: {
        operationId: "listAlertGroups",
        tags: ["alerts"],
        summary: "List alert groups",
        parameters: [
          { name: "status", in: "query", required: false, schema: { type: "string" } },
        ],
      },
    },
    "/api/alerts/{alert_id}/ack": {
      post: {
        operationId: "acknowledgeAlertGroup",
        tags: ["alerts"],
        summary: "Acknowledge an alert group",
        parameters: [{ name: "alert_id", in: "path", required: true, schema: { type: "integer" } }],
        requestBody: {
          content: { "application/json": { schema: { $ref: "#/components/schemas/Ack" } } },
        },
      },
    },
    "/api/heartbeats": {
      post: { tags: ["Heartbeats"], summary: "Create heartbeat" },
    },
  },
};

describe("catalog", () => {
  const cat = buildCatalog(SPEC);

  it("indexes operations by id", () => {
    expect(cat.get("listAlertGroups")?.method).toBe("GET");
    expect(cat.get("acknowledgeAlertGroup")?.path).toBe("/api/alerts/{alert_id}/ack");
  });

  it("synthesizes ids for operations without operationId", () => {
    const op = cat.findByMethodPath("POST", "/api/heartbeats");
    expect(op).toBeDefined();
    expect(cat.get(op!.operationId)).toBeDefined();
  });

  it("resolves $ref in request body", () => {
    const op = cat.get("acknowledgeAlertGroup")!;
    expect((op.requestBodySchema as any).properties.note.type).toBe("string");
  });

  it("filters list by query and tag", () => {
    expect(cat.list({ query: "acknowledge" }).map((o) => o.operationId)).toContain(
      "acknowledgeAlertGroup"
    );
    expect(cat.list({ method: "GET" }).every((o) => o.method === "GET")).toBe(true);
    expect(cat.list({ tag: "alerts" }).length).toBe(2);
  });

  it("describe returns params and body", () => {
    const d = cat.describe("acknowledgeAlertGroup") as any;
    expect(d.pathParams[0].name).toBe("alert_id");
    expect(d.requestBodySchema).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/catalog.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `src/openapi/catalog.ts`**

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;

export interface OpParam {
  name: string;
  in: "path" | "query" | "header";
  required: boolean;
  description?: string;
  schema?: unknown;
}

export interface CatalogOperation {
  operationId: string;
  method: string; // upper-case
  path: string;
  tags: string[];
  summary: string;
  description?: string;
  parameters: OpParam[];
  requestBodySchema?: unknown;
}

export interface CompactOperation {
  operationId: string;
  method: string;
  path: string;
  tag: string;
  summary: string;
}

function synthesizeId(method: string, path: string): string {
  return `${method.toLowerCase()}_${path.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "")}`;
}

function resolveRefs(node: unknown, spec: any, seen = new Set<string>()): unknown {
  if (Array.isArray(node)) return node.map((n) => resolveRefs(n, spec, seen));
  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    if (typeof obj.$ref === "string") {
      const ref = obj.$ref;
      if (seen.has(ref)) return {}; // cycle guard
      const path = ref.replace(/^#\//, "").split("/");
      let target: any = spec;
      for (const p of path) target = target?.[p];
      const nextSeen = new Set(seen).add(ref);
      return resolveRefs(target, spec, nextSeen);
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) out[k] = resolveRefs(v, spec, seen);
    return out;
  }
  return node;
}

function requestBodySchema(op: any, spec: any): unknown {
  const schema = op?.requestBody?.content?.["application/json"]?.schema;
  return schema ? resolveRefs(schema, spec) : undefined;
}

export class Catalog {
  private byId = new Map<string, CatalogOperation>();

  constructor(operations: CatalogOperation[]) {
    for (const op of operations) this.byId.set(op.operationId, op);
  }

  get size(): number {
    return this.byId.size;
  }

  get(operationId: string): CatalogOperation | undefined {
    return this.byId.get(operationId);
  }

  findByMethodPath(method: string, path: string): CatalogOperation | undefined {
    const m = method.toUpperCase();
    for (const op of this.byId.values()) {
      if (op.method === m && op.path === path) return op;
    }
    return undefined;
  }

  list(opts: { query?: string; tag?: string; method?: string; limit?: number } = {}): CompactOperation[] {
    const limit = opts.limit ?? 50;
    const q = opts.query?.toLowerCase();
    const method = opts.method?.toUpperCase();
    const results: CompactOperation[] = [];
    for (const op of this.byId.values()) {
      if (method && op.method !== method) continue;
      if (opts.tag && !op.tags.includes(opts.tag)) continue;
      if (q) {
        const hay = `${op.operationId} ${op.path} ${op.summary} ${op.tags.join(" ")}`.toLowerCase();
        if (!hay.includes(q)) continue;
      }
      results.push({
        operationId: op.operationId,
        method: op.method,
        path: op.path,
        tag: op.tags[0] ?? "",
        summary: op.summary,
      });
      if (results.length >= limit) break;
    }
    return results;
  }

  describe(operationId: string) {
    const op = this.get(operationId);
    if (!op) return undefined;
    return {
      operationId: op.operationId,
      method: op.method,
      path: op.path,
      tags: op.tags,
      summary: op.summary,
      description: op.description,
      pathParams: op.parameters.filter((p) => p.in === "path"),
      queryParams: op.parameters.filter((p) => p.in === "query"),
      requestBodySchema: op.requestBodySchema,
    };
  }
}

export function buildCatalog(spec: any): Catalog {
  const ops: CatalogOperation[] = [];
  const paths = spec.paths ?? {};
  for (const [path, item] of Object.entries<any>(paths)) {
    for (const method of HTTP_METHODS) {
      const op = item?.[method];
      if (!op) continue;
      const operationId: string = op.operationId || synthesizeId(method, path);
      const parameters: OpParam[] = (op.parameters ?? []).map((p: any) => ({
        name: p.name,
        in: p.in,
        required: !!p.required,
        description: p.description,
        schema: p.schema,
      }));
      ops.push({
        operationId,
        method: method.toUpperCase(),
        path,
        tags: op.tags ?? [],
        summary: op.summary ?? "",
        description: op.description,
        parameters,
        requestBodySchema: requestBodySchema(op, spec),
      });
    }
  }
  return new Catalog(ops);
}

export function loadSnapshotSpec(): any {
  const here = dirname(fileURLToPath(import.meta.url));
  const raw = readFileSync(join(here, "snapshot.json"), "utf8");
  return JSON.parse(raw);
}

export async function loadSpec(cfg: {
  openapiUrl: string;
  timeoutMs: number;
}): Promise<{ spec: any; source: "live" | "snapshot" }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const res = await fetch(cfg.openapiUrl, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { spec: await res.json(), source: "live" };
  } catch {
    return { spec: loadSnapshotSpec(), source: "snapshot" };
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/catalog.test.ts`
Expected: PASS.

- [ ] **Step 5: Add snapshot integrity test to the same file**

Append to `test/catalog.test.ts`:

```ts
import { loadSnapshotSpec, buildCatalog as build2 } from "../src/openapi/catalog.js";

describe("bundled snapshot", () => {
  it("parses and contains the known on-call operations", () => {
    const cat = build2(loadSnapshotSpec());
    expect(cat.size).toBeGreaterThan(250);
    for (const id of ["listAlertGroups", "acknowledgeAlertGroup", "resolveAlertGroup", "listIncidents", "createSilence"]) {
      expect(cat.get(id), id).toBeDefined();
    }
  });
});
```

- [ ] **Step 6: Run and verify**

Run: `npx vitest run test/catalog.test.ts`
Expected: PASS (snapshot has >250 ops).

- [ ] **Step 7: Commit**

```bash
git add src/openapi/catalog.ts test/catalog.test.ts
git commit -m "feat: OpenAPI catalog with ref resolution, id synthesis, search"
```

---

### Task 3: HTTP client

**Files:**
- Create: `src/client.ts`
- Test: `test/client.test.ts`

**Interfaces:**
- Consumes: `Config` (Task 1), `redact` (Task 1).
- Produces:
  - `interface CallRequest { method: string; path: string; pathParams?: Record<string, string|number>; query?: Record<string, unknown>; body?: unknown }`
  - `interface CallResult { status: number; ok: boolean; data: unknown }`
  - `class IRError extends Error { status: number; routing_error?: string; error_id?: string; missing_scopes?: string[]; suggestion: string; toJSON(): object }`
  - `class IRClient { constructor(cfg: Config); call(req: CallRequest): Promise<CallResult> }` — throws `IRError` on non-2xx or network failure.
  - `function buildUrl(baseUrl: string, path: string, pathParams?, query?): string` (exported for tests).

- [ ] **Step 1: Write failing test `test/client.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { IRClient, IRError, buildUrl } from "../src/client.js";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const cfg = {
  baseUrl: "https://ir.example.com",
  token: "tok123",
  transport: "stdio" as const,
  port: 3000,
  host: "127.0.0.1",
  readonly: false,
  timeoutMs: 5000,
  openapiUrl: "https://ir.example.com/api/openapi.json",
  verifyTls: true,
};

describe("buildUrl", () => {
  it("substitutes path params and appends query incl. arrays", () => {
    const url = buildUrl("https://ir.example.com", "/api/alerts/{alert_id}/ack", { alert_id: 7 }, {
      status: ["firing", "acknowledged"],
      q: "disk",
    });
    expect(url).toBe(
      "https://ir.example.com/api/alerts/7/ack?status=firing&status=acknowledged&q=disk"
    );
  });
});

describe("IRClient", () => {
  it("sends bearer auth and returns parsed data", async () => {
    server.use(
      http.get("https://ir.example.com/api/alerts", ({ request }) => {
        expect(request.headers.get("authorization")).toBe("Bearer tok123");
        return HttpResponse.json({ items: [{ id: 1 }] });
      })
    );
    const client = new IRClient(cfg);
    const res = await client.call({ method: "GET", path: "/api/alerts" });
    expect(res.ok).toBe(true);
    expect((res.data as any).items[0].id).toBe(1);
  });

  it("normalizes a 403 scope error with suggestion", async () => {
    server.use(
      http.post("https://ir.example.com/api/alerts/1/ack", () =>
        HttpResponse.json({ error: "Missing API token scope", missing_scopes: ["alerts:write"] }, { status: 403 })
      )
    );
    const client = new IRClient(cfg);
    await expect(
      client.call({ method: "POST", path: "/api/alerts/{alert_id}/ack", pathParams: { alert_id: 1 } })
    ).rejects.toMatchObject({ status: 403, missing_scopes: ["alerts:write"] });
  });

  it("captures routing_error and error_id", async () => {
    server.use(
      http.post("https://ir.example.com/api/integrations/webhook", () =>
        HttpResponse.json({ routing_error: "no matching route", error_id: "abc-123" }, { status: 422 })
      )
    );
    const client = new IRClient(cfg);
    try {
      await client.call({ method: "POST", path: "/api/integrations/webhook", body: {} });
      throw new Error("should have thrown");
    } catch (e) {
      const err = e as IRError;
      expect(err.routing_error).toBe("no matching route");
      expect(err.error_id).toBe("abc-123");
      expect(err.suggestion.length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/client.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `src/client.ts`**

```ts
import { Agent } from "undici";
import type { Config } from "./config.js";
import { redact } from "./config.js";

export interface CallRequest {
  method: string;
  path: string;
  pathParams?: Record<string, string | number>;
  query?: Record<string, unknown>;
  body?: unknown;
}

export interface CallResult {
  status: number;
  ok: boolean;
  data: unknown;
}

export class IRError extends Error {
  status: number;
  routing_error?: string;
  error_id?: string;
  missing_scopes?: string[];
  suggestion: string;

  constructor(init: {
    status: number;
    message: string;
    routing_error?: string;
    error_id?: string;
    missing_scopes?: string[];
    suggestion: string;
  }) {
    super(init.message);
    this.name = "IRError";
    this.status = init.status;
    this.routing_error = init.routing_error;
    this.error_id = init.error_id;
    this.missing_scopes = init.missing_scopes;
    this.suggestion = init.suggestion;
  }

  toJSON() {
    return {
      error: this.message,
      status: this.status,
      routing_error: this.routing_error,
      error_id: this.error_id,
      missing_scopes: this.missing_scopes,
      suggestion: this.suggestion,
    };
  }
}

export function buildUrl(
  baseUrl: string,
  path: string,
  pathParams?: Record<string, string | number>,
  query?: Record<string, unknown>
): string {
  let p = path;
  if (pathParams) {
    for (const [k, v] of Object.entries(pathParams)) {
      p = p.replace(`{${k}}`, encodeURIComponent(String(v)));
    }
  }
  const url = new URL(baseUrl + p);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      if (Array.isArray(v)) for (const item of v) url.searchParams.append(k, String(item));
      else url.searchParams.append(k, String(v));
    }
  }
  return url.toString();
}

function suggestionFor(status: number, missingScopes?: string[]): string {
  if (status === 401) return "Authentication failed. Check IR_TOKEN is a valid, non-expired token.";
  if (status === 403)
    return missingScopes?.length
      ? `Token lacks scope(s): ${missingScopes.join(", ")}. Create a token with those scopes.`
      : "Access denied. The token is valid but not permitted for this operation or group.";
  if (status === 404) return "Not found. Verify the id/path params and that the resource exists in the active group.";
  if (status === 422) return "Validation failed. Re-check required body fields against ir_describe_operation.";
  if (status >= 500) return "Server error. Retry later or check IncidentRelay logs by error_id.";
  return "Re-check the request against ir_describe_operation.";
}

export class IRClient {
  private cfg: Config;
  private dispatcher?: Agent;

  constructor(cfg: Config) {
    this.cfg = cfg;
    if (!cfg.verifyTls) this.dispatcher = new Agent({ connect: { rejectUnauthorized: false } });
  }

  async call(req: CallRequest): Promise<CallResult> {
    const url = buildUrl(this.cfg.baseUrl, req.path, req.pathParams, req.query);
    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.cfg.token) headers.Authorization = `Bearer ${this.cfg.token}`;
    let bodyInit: string | undefined;
    if (req.body !== undefined && req.method !== "GET") {
      headers["Content-Type"] = "application/json";
      bodyInit = JSON.stringify(req.body);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs);
    let res: Response;
    try {
      res = await fetch(url, {
        method: req.method,
        headers,
        body: bodyInit,
        signal: controller.signal,
        // @ts-expect-error undici dispatcher is accepted by Node fetch
        dispatcher: this.dispatcher,
      });
    } catch (e) {
      throw new IRError({
        status: 0,
        message: redact(`Network error calling ${req.method} ${req.path}: ${(e as Error).message}`, this.cfg.token),
        suggestion: "Check IR_BASE_URL reachability, TLS settings (IR_VERIFY_TLS), and network.",
      });
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    let data: unknown = text;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      /* keep raw text */
    }

    if (!res.ok) {
      const d = (data ?? {}) as any;
      const message = redact(
        String(d.error || d.message || d.detail || `HTTP ${res.status}`),
        this.cfg.token
      );
      throw new IRError({
        status: res.status,
        message,
        routing_error: d.routing_error,
        error_id: d.error_id,
        missing_scopes: d.missing_scopes,
        suggestion: suggestionFor(res.status, d.missing_scopes),
      });
    }
    return { status: res.status, ok: true, data };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/client.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client.ts test/client.test.ts
git commit -m "feat: IncidentRelay HTTP client with url building and error normalization"
```

---

### Task 4: Safety layer

**Files:**
- Create: `src/safety.ts`
- Test: `test/safety.test.ts`

**Interfaces:**
- Consumes: `CatalogOperation` (Task 2).
- Produces:
  - `type OpClass = "read" | "write" | "destructive"`
  - `function classify(op: { method: string; path: string }): OpClass`
  - `interface GuardResult { allowed: boolean; reason?: string; preview?: string }`
  - `function guard(op: { method: string; path: string }, opts: { confirm: boolean; readonly: boolean }): GuardResult`

- [ ] **Step 1: Write failing test `test/safety.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { classify, guard } from "../src/safety.js";

describe("classify", () => {
  it("GET is read", () => {
    expect(classify({ method: "GET", path: "/api/alerts" })).toBe("read");
  });
  it("DELETE is destructive", () => {
    expect(classify({ method: "DELETE", path: "/api/routes/1" })).toBe("destructive");
  });
  it("destructive verbs in path are destructive", () => {
    expect(classify({ method: "POST", path: "/api/routes/1/intake-token" })).toBe("destructive");
    expect(classify({ method: "POST", path: "/api/silences/1/enable" })).toBe("write");
    expect(classify({ method: "POST", path: "/api/alerts/merge" })).toBe("destructive");
  });
  it("other POST/PUT are write", () => {
    expect(classify({ method: "POST", path: "/api/alerts/1/ack" })).toBe("write");
  });
});

describe("guard", () => {
  it("blocks writes in readonly mode", () => {
    const r = guard({ method: "POST", path: "/api/alerts/1/ack" }, { confirm: false, readonly: true });
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/read-only/i);
  });
  it("requires confirm for destructive ops and returns a preview", () => {
    const r = guard({ method: "DELETE", path: "/api/routes/5" }, { confirm: false, readonly: false });
    expect(r.allowed).toBe(false);
    expect(r.preview).toMatch(/confirm/i);
    expect(r.preview).toContain("DELETE /api/routes/5");
  });
  it("allows destructive ops when confirmed", () => {
    expect(guard({ method: "DELETE", path: "/api/routes/5" }, { confirm: true, readonly: false }).allowed).toBe(true);
  });
  it("allows plain writes without confirm", () => {
    expect(guard({ method: "POST", path: "/api/alerts/1/ack" }, { confirm: false, readonly: false }).allowed).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/safety.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `src/safety.ts`**

```ts
export type OpClass = "read" | "write" | "destructive";

const DESTRUCTIVE_VERBS = [
  "disable",
  "remove",
  "delete",
  "reset",
  "regenerate-token",
  "intake-token",
  "cancel",
  "merge",
  "revoke",
];

export function classify(op: { method: string; path: string }): OpClass {
  const method = op.method.toUpperCase();
  if (method === "GET") return "read";
  if (method === "DELETE") return "destructive";
  const segments = op.path.toLowerCase().split("/");
  if (DESTRUCTIVE_VERBS.some((v) => segments.includes(v))) return "destructive";
  return "write";
}

export interface GuardResult {
  allowed: boolean;
  reason?: string;
  preview?: string;
}

export function guard(
  op: { method: string; path: string },
  opts: { confirm: boolean; readonly: boolean }
): GuardResult {
  const cls = classify(op);
  if (opts.readonly && cls !== "read") {
    return { allowed: false, reason: "Server is in read-only mode; write and destructive operations are disabled." };
  }
  if (cls === "destructive" && !opts.confirm) {
    return {
      allowed: false,
      preview:
        `This is a DESTRUCTIVE operation: ${op.method} ${op.path}. ` +
        `It was NOT executed. Re-run with confirm: true to proceed.`,
    };
  }
  return { allowed: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/safety.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/safety.ts test/safety.test.ts
git commit -m "feat: safety layer with destructive classification and confirm-guard"
```

---

### Task 5: Response formatter

**Files:**
- Create: `src/format.ts`
- Test: `test/format.test.ts`

**Interfaces:**
- Produces:
  - `type ResponseFormat = "concise" | "detailed"`
  - `function shape(data: unknown, format: ResponseFormat): unknown` — in `concise` mode strips verbose keys (`payload`, `raw`, `raw_payload`, `annotations`, `labels_full`) recursively.
  - `function toToolText(data: unknown, maxChars?: number): string` — JSON-stringifies and truncates over `maxChars` (default 100000, ≈25k tokens) with a guidance suffix.

- [ ] **Step 1: Write failing test `test/format.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { shape, toToolText } from "../src/format.js";

describe("shape", () => {
  it("drops verbose keys when concise", () => {
    const out = shape({ id: 1, summary: "x", payload: { big: "data" }, raw: "..." }, "concise") as any;
    expect(out.id).toBe(1);
    expect(out.payload).toBeUndefined();
    expect(out.raw).toBeUndefined();
  });
  it("keeps everything when detailed", () => {
    const out = shape({ id: 1, payload: { big: "data" } }, "detailed") as any;
    expect(out.payload).toBeDefined();
  });
  it("recurses into arrays and nested objects", () => {
    const out = shape({ items: [{ id: 1, raw: "x" }] }, "concise") as any;
    expect(out.items[0].raw).toBeUndefined();
  });
});

describe("toToolText", () => {
  it("truncates oversized payloads with guidance", () => {
    const big = { items: Array.from({ length: 5000 }, (_, i) => ({ i, s: "x".repeat(50) })) };
    const text = toToolText(big, 1000);
    expect(text.length).toBeLessThan(1400);
    expect(text).toMatch(/truncated/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/format.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `src/format.ts`**

```ts
export type ResponseFormat = "concise" | "detailed";

const VERBOSE_KEYS = new Set(["payload", "raw", "raw_payload", "annotations", "labels_full"]);

export function shape(data: unknown, format: ResponseFormat): unknown {
  if (format === "detailed") return data;
  if (Array.isArray(data)) return data.map((d) => shape(d, format));
  if (data && typeof data === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      if (VERBOSE_KEYS.has(k)) continue;
      out[k] = shape(v, format);
    }
    return out;
  }
  return data;
}

export function toToolText(data: unknown, maxChars = 100000): string {
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  if (text.length <= maxChars) return text;
  return (
    text.slice(0, maxChars) +
    `\n\n… [truncated: response exceeded ${maxChars} chars. Narrow the request with filters, ` +
    `a smaller page_size, or response_format: "concise".]`
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/format.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/format.ts test/format.test.ts
git commit -m "feat: response formatter with concise shaping and truncation"
```

---

### Task 6: Execution core + gateway tools

**Files:**
- Create: `src/execute.ts` (shared execution used by gateway and curated tools)
- Create: `src/tools/gateway.ts`
- Test: `test/execute.test.ts`, `test/gateway.test.ts`

**Interfaces:**
- Consumes: `Catalog` (Task 2), `IRClient`/`IRError` (Task 3), `guard` (Task 4), `shape`/`toToolText`/`ResponseFormat` (Task 5).
- Produces:
  - `interface ToolCtx { catalog: Catalog; client: IRClient; readonly: boolean }`
  - `interface ToolResult { content: { type: "text"; text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean }`
  - `async function executeOperation(ctx: ToolCtx, args: { operationId?: string; method?: string; path?: string; pathParams?: Record<string,string|number>; query?: Record<string,unknown>; body?: unknown; confirm?: boolean; response_format?: ResponseFormat }): Promise<ToolResult>`
  - `function registerGatewayTools(server: McpServer, ctx: ToolCtx): void`

- [ ] **Step 1: Write failing test `test/execute.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { buildCatalog } from "../src/openapi/catalog.js";
import { IRClient } from "../src/client.js";
import { executeOperation, type ToolCtx } from "../src/execute.js";

const SPEC = {
  paths: {
    "/api/alerts/{alert_id}/ack": {
      post: { operationId: "acknowledgeAlertGroup", tags: ["alerts"], summary: "Ack", parameters: [{ name: "alert_id", in: "path", required: true, schema: { type: "integer" } }] },
    },
    "/api/routes/{route_id}": { delete: { operationId: "deleteRoute", tags: ["routes"], summary: "Delete route", parameters: [{ name: "route_id", in: "path", required: true, schema: { type: "integer" } }] } },
  },
};

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function ctx(readonly = false): ToolCtx {
  const cfg = { baseUrl: "https://ir.example.com", token: "t", transport: "stdio" as const, port: 3000, host: "127.0.0.1", readonly, timeoutMs: 5000, openapiUrl: "x", verifyTls: true };
  return { catalog: buildCatalog(SPEC), client: new IRClient(cfg), readonly };
}

describe("executeOperation", () => {
  it("executes a known operation by id", async () => {
    server.use(http.post("https://ir.example.com/api/alerts/9/ack", () => HttpResponse.json({ ok: true })));
    const r = await executeOperation(ctx(), { operationId: "acknowledgeAlertGroup", pathParams: { alert_id: 9 } });
    expect(r.isError).toBeFalsy();
    expect(r.content[0].text).toContain("ok");
  });

  it("blocks destructive op without confirm", async () => {
    const r = await executeOperation(ctx(), { operationId: "deleteRoute", pathParams: { route_id: 5 } });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/confirm: true/);
  });

  it("executes destructive op with confirm", async () => {
    server.use(http.delete("https://ir.example.com/api/routes/5", () => HttpResponse.json({ deleted: true })));
    const r = await executeOperation(ctx(), { operationId: "deleteRoute", pathParams: { route_id: 5 }, confirm: true });
    expect(r.isError).toBeFalsy();
    expect(r.content[0].text).toContain("deleted");
  });

  it("blocks writes in readonly mode", async () => {
    const r = await executeOperation(ctx(true), { operationId: "acknowledgeAlertGroup", pathParams: { alert_id: 9 } });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/read-only/i);
  });

  it("errors on unknown operationId", async () => {
    const r = await executeOperation(ctx(), { operationId: "nope" });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/unknown operation/i);
  });

  it("supports raw method+path", async () => {
    server.use(http.get("https://ir.example.com/api/ping", () => HttpResponse.json({ pong: 1 })));
    const r = await executeOperation(ctx(), { method: "GET", path: "/api/ping" });
    expect(r.content[0].text).toContain("pong");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/execute.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `src/execute.ts`**

```ts
import type { Catalog } from "./openapi/catalog.js";
import { IRClient, IRError } from "./client.js";
import { guard } from "./safety.js";
import { shape, toToolText, type ResponseFormat } from "./format.js";

export interface ToolCtx {
  catalog: Catalog;
  client: IRClient;
  readonly: boolean;
}

export interface ToolResult {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export interface ExecuteArgs {
  operationId?: string;
  method?: string;
  path?: string;
  pathParams?: Record<string, string | number>;
  query?: Record<string, unknown>;
  body?: unknown;
  confirm?: boolean;
  response_format?: ResponseFormat;
}

function textResult(text: string, isError = false): ToolResult {
  return { content: [{ type: "text", text }], isError };
}

export async function executeOperation(ctx: ToolCtx, args: ExecuteArgs): Promise<ToolResult> {
  let method = args.method?.toUpperCase();
  let path = args.path;

  if (args.operationId) {
    const op = ctx.catalog.get(args.operationId);
    if (!op) return textResult(`Unknown operation: ${args.operationId}. Use ir_list_operations to discover valid ids.`, true);
    method = op.method;
    path = op.path;
  }
  if (!method || !path) {
    return textResult("Provide either operationId, or both method and path.", true);
  }

  const g = guard({ method, path }, { confirm: !!args.confirm, readonly: ctx.readonly });
  if (!g.allowed) return textResult(g.preview ?? g.reason ?? "Operation not permitted.", true);

  try {
    const res = await ctx.client.call({
      method,
      path,
      pathParams: args.pathParams,
      query: args.query,
      body: args.body,
    });
    const shaped = shape(res.data, args.response_format ?? "concise");
    return {
      content: [{ type: "text", text: toToolText(shaped) }],
      structuredContent: shaped && typeof shaped === "object" && !Array.isArray(shaped)
        ? (shaped as Record<string, unknown>)
        : { result: shaped },
    };
  } catch (e) {
    if (e instanceof IRError) return textResult(toToolText(e.toJSON()), true);
    return textResult(`Unexpected error: ${(e as Error).message}`, true);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/execute.test.ts`
Expected: PASS.

- [ ] **Step 5: Write failing test `test/gateway.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildCatalog } from "../src/openapi/catalog.js";
import { IRClient } from "../src/client.js";
import { registerGatewayTools } from "../src/tools/gateway.js";
import type { ToolCtx } from "../src/execute.js";

const SPEC = {
  paths: {
    "/api/alerts": { get: { operationId: "listAlertGroups", tags: ["alerts"], summary: "List alerts" } },
  },
};

function makeCtx(): ToolCtx {
  const cfg = { baseUrl: "https://ir.example.com", token: "t", transport: "stdio" as const, port: 3000, host: "127.0.0.1", readonly: false, timeoutMs: 5000, openapiUrl: "x", verifyTls: true };
  return { catalog: buildCatalog(SPEC), client: new IRClient(cfg), readonly: false };
}

describe("gateway registration", () => {
  it("registers the three gateway tools", () => {
    const server = new McpServer({ name: "t", version: "0.0.0" });
    registerGatewayTools(server, makeCtx());
    // McpServer keeps tools privately; assert registration does not throw and returns void
    expect(() => registerGatewayTools(new McpServer({ name: "t2", version: "0.0.0" }), makeCtx())).not.toThrow();
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `npx vitest run test/gateway.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 7: Write `src/tools/gateway.ts`**

```ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { executeOperation, type ToolCtx } from "../execute.js";
import { toToolText } from "../format.js";

const METHOD = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]);

export function registerGatewayTools(server: McpServer, ctx: ToolCtx): void {
  server.registerTool(
    "ir_list_operations",
    {
      title: "List / search IncidentRelay API operations",
      description:
        "Search the IncidentRelay API catalog (279 operations). Filter by free-text query, tag, or HTTP method. " +
        "Use this first to find the operationId you need, then ir_describe_operation, then ir_call. " +
        "Do NOT use for actually reading/changing data — use ir_call or a curated ir_* tool for that.",
      inputSchema: {
        query: z.string().optional().describe("Free-text filter over id, path, summary, tag"),
        tag: z.string().optional().describe("Exact tag, e.g. 'alerts', 'incidents', 'rotations'"),
        method: METHOD.optional(),
        limit: z.number().int().min(1).max(200).optional().describe("Max results (default 50)"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      const ops = ctx.catalog.list(args);
      return { content: [{ type: "text", text: toToolText(ops) }] };
    }
  );

  server.registerTool(
    "ir_describe_operation",
    {
      title: "Describe one IncidentRelay API operation",
      description:
        "Return the full signature of one operation: path params, query params, request-body JSON schema, and summary. " +
        "Call this before ir_call to learn exactly which arguments to pass.",
      inputSchema: {
        operationId: z.string().describe("operationId from ir_list_operations"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ operationId }) => {
      const d = ctx.catalog.describe(operationId);
      if (!d) return { content: [{ type: "text", text: `Unknown operation: ${operationId}` }], isError: true };
      return { content: [{ type: "text", text: toToolText(d) }] };
    }
  );

  server.registerTool(
    "ir_call",
    {
      title: "Call any IncidentRelay API operation",
      description:
        "Execute any of the 279 operations. Provide operationId (preferred) or method+path. " +
        "Destructive operations (DELETE, disable/remove/reset/regenerate-token/cancel/merge/revoke) require confirm: true; " +
        "otherwise a dry-run preview is returned. In read-only mode all non-GET calls are refused.",
      inputSchema: {
        operationId: z.string().optional(),
        method: METHOD.optional(),
        path: z.string().optional().describe("Raw path incl. {placeholders}, e.g. /api/heartbeats"),
        pathParams: z.record(z.union([z.string(), z.number()])).optional(),
        query: z.record(z.unknown()).optional(),
        body: z.unknown().optional(),
        confirm: z.boolean().optional().describe("Must be true to run destructive operations"),
        response_format: z.enum(["concise", "detailed"]).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    async (args) => executeOperation(ctx, args)
  );
}
```

- [ ] **Step 8: Run to verify it passes**

Run: `npx vitest run test/gateway.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/execute.ts src/tools/gateway.ts test/execute.test.ts test/gateway.test.ts
git commit -m "feat: execution core and three gateway tools covering all operations"
```

---

### Task 7: Curated tool framework + curated tools

**Files:**
- Create: `src/tools/curated.ts`
- Test: `test/curated.test.ts`

**Interfaces:**
- Consumes: `ToolCtx`, `executeOperation`, `ExecuteArgs` (Task 6); `Catalog` (Task 2).
- Produces:
  - `interface CuratedSpec { name: string; operationId: string; title: string; description: string; inputSchema: Record<string, z.ZodTypeAny>; annotations: object; map: (args: any) => ExecuteArgs }`
  - `const CURATED_TOOLS: CuratedSpec[]` — the ~22 curated definitions.
  - `function registerCuratedTools(server: McpServer, ctx: ToolCtx): void`

- [ ] **Step 1: Write failing test `test/curated.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { buildCatalog, loadSnapshotSpec } from "../src/openapi/catalog.js";
import { IRClient } from "../src/client.js";
import { CURATED_TOOLS } from "../src/tools/curated.js";
import { executeOperation, type ToolCtx } from "../src/execute.js";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const realCatalog = buildCatalog(loadSnapshotSpec());

function ctx(): ToolCtx {
  const cfg = { baseUrl: "https://ir.example.com", token: "t", transport: "stdio" as const, port: 3000, host: "127.0.0.1", readonly: false, timeoutMs: 5000, openapiUrl: "x", verifyTls: true };
  return { catalog: realCatalog, client: new IRClient(cfg), readonly: false };
}

describe("curated tool specs", () => {
  it("every curated tool maps to a real operationId in the snapshot", () => {
    for (const t of CURATED_TOOLS) {
      expect(realCatalog.get(t.operationId), `${t.name} -> ${t.operationId}`).toBeDefined();
    }
  });

  it("all curated names are ir_ prefixed and unique", () => {
    const names = CURATED_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.every((n) => n.startsWith("ir_"))).toBe(true);
  });

  it("ir_ack_alert maps args to the ack operation", async () => {
    server.use(
      http.post("https://ir.example.com/api/alerts/42/ack", () => HttpResponse.json({ status: "acknowledged" }))
    );
    const tool = CURATED_TOOLS.find((t) => t.name === "ir_ack_alert")!;
    const r = await executeOperation(ctx(), tool.map({ alert_id: 42 }));
    expect(r.content[0].text).toContain("acknowledged");
  });

  it("ir_list_alerts passes filters as query", async () => {
    server.use(
      http.get("https://ir.example.com/api/alerts", ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("status")).toBe("firing");
        return HttpResponse.json({ items: [] });
      })
    );
    const tool = CURATED_TOOLS.find((t) => t.name === "ir_list_alerts")!;
    const r = await executeOperation(ctx(), tool.map({ status: "firing" }));
    expect(r.isError).toBeFalsy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/curated.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `src/tools/curated.ts`**

> Before writing, confirm the exact operationIds and body/query field names for each tool with `ir_describe_operation` against the snapshot (or read `src/openapi/snapshot.json`). The ids below are taken from the generated spec on 2026-08-17. If `ir_who_is_on_call`'s underlying id differs in the snapshot, use `getOnCallCalendar` (calendar endpoint) — verified present.

```ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { executeOperation, type ToolCtx, type ExecuteArgs } from "../execute.js";

export interface CuratedSpec {
  name: string;
  operationId: string;
  title: string;
  description: string;
  inputSchema: Record<string, z.ZodTypeAny>;
  annotations: Record<string, boolean>;
  map: (args: any) => ExecuteArgs;
}

const RF = z.enum(["concise", "detailed"]).optional();
const READ = { readOnlyHint: true, openWorldHint: true };
const WRITE = { readOnlyHint: false, openWorldHint: true };
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, openWorldHint: true };

export const CURATED_TOOLS: CuratedSpec[] = [
  // ---- Alerts ----
  {
    name: "ir_list_alerts",
    operationId: "listAlertGroups",
    title: "List alert groups",
    description: "List/search alert groups. Filter by status (firing/acknowledged/resolved), team, severity. Paginated. Use to find alerts to act on.",
    inputSchema: {
      status: z.string().optional(),
      team_id: z.number().int().optional(),
      severity: z.string().optional(),
      page: z.number().int().min(1).optional(),
      page_size: z.number().int().min(1).max(100).optional(),
      response_format: RF,
    },
    annotations: READ,
    map: (a) => ({
      operationId: "listAlertGroups",
      query: { status: a.status, team_id: a.team_id, severity: a.severity, page: a.page, page_size: a.page_size },
      response_format: a.response_format,
    }),
  },
  {
    name: "ir_get_alert",
    operationId: "getAlertGroup",
    title: "Get an alert group",
    description: "Fetch one alert group by id, including its events and current state.",
    inputSchema: { alert_id: z.number().int(), response_format: RF },
    annotations: READ,
    map: (a) => ({ operationId: "getAlertGroup", pathParams: { alert_id: a.alert_id }, response_format: a.response_format }),
  },
  {
    name: "ir_ack_alert",
    operationId: "acknowledgeAlertGroup",
    title: "Acknowledge an alert group",
    description: "Acknowledge an alert group, stopping reminders/escalation. Optionally include a note.",
    inputSchema: { alert_id: z.number().int(), note: z.string().optional() },
    annotations: WRITE,
    map: (a) => ({ operationId: "acknowledgeAlertGroup", pathParams: { alert_id: a.alert_id }, body: a.note ? { note: a.note } : undefined }),
  },
  {
    name: "ir_resolve_alert",
    operationId: "resolveAlertGroup",
    title: "Resolve an alert group",
    description: "Resolve/close an alert group. Optionally include a note.",
    inputSchema: { alert_id: z.number().int(), note: z.string().optional() },
    annotations: WRITE,
    map: (a) => ({ operationId: "resolveAlertGroup", pathParams: { alert_id: a.alert_id }, body: a.note ? { note: a.note } : undefined }),
  },
  {
    name: "ir_comment_alert",
    operationId: "createAlertGroupComment",
    title: "Comment on an alert group",
    description: "Add a comment to an alert group's timeline.",
    inputSchema: { alert_id: z.number().int(), comment: z.string() },
    annotations: WRITE,
    map: (a) => ({ operationId: "createAlertGroupComment", pathParams: { alert_id: a.alert_id }, body: { comment: a.comment } }),
  },

  // ---- Incidents ----
  {
    name: "ir_list_incidents",
    operationId: "listIncidents",
    title: "List incidents",
    description: "List/search incidents. Paginated.",
    inputSchema: { page: z.number().int().min(1).optional(), page_size: z.number().int().min(1).max(100).optional(), response_format: RF },
    annotations: READ,
    map: (a) => ({ operationId: "listIncidents", query: { page: a.page, page_size: a.page_size }, response_format: a.response_format }),
  },
  {
    name: "ir_get_incident",
    operationId: "getIncident",
    title: "Get an incident",
    description: "Fetch one incident by id with responders and stakeholders.",
    inputSchema: { incident_id: z.number().int(), response_format: RF },
    annotations: READ,
    map: (a) => ({ operationId: "getIncident", pathParams: { incident_id: a.incident_id }, response_format: a.response_format }),
  },
  {
    name: "ir_create_incident",
    operationId: "createManualIncident",
    title: "Create a manual incident",
    description: "Open a new incident manually. Provide a title and optional description/severity/team.",
    inputSchema: { title: z.string(), description: z.string().optional(), severity: z.string().optional(), team_id: z.number().int().optional() },
    annotations: WRITE,
    map: (a) => ({ operationId: "createManualIncident", body: { title: a.title, description: a.description, severity: a.severity, team_id: a.team_id } }),
  },
  {
    name: "ir_add_incident_responder",
    operationId: "createIncidentResponder",
    title: "Add an incident responder",
    description: "Add a responder (by user id) to an incident.",
    inputSchema: { incident_id: z.number().int(), user_id: z.number().int() },
    annotations: WRITE,
    map: (a) => ({ operationId: "createIncidentResponder", pathParams: { incident_id: a.incident_id }, body: { user_id: a.user_id } }),
  },
  {
    name: "ir_set_incident_priority",
    operationId: "updateIncidentPriority",
    title: "Set incident priority",
    description: "Set/update an incident's priority by priority id.",
    inputSchema: { incident_id: z.number().int(), priority_id: z.number().int() },
    annotations: WRITE,
    map: (a) => ({ operationId: "updateIncidentPriority", pathParams: { incident_id: a.incident_id }, body: { priority_id: a.priority_id } }),
  },

  // ---- On-call ----
  {
    name: "ir_who_is_on_call",
    operationId: "getOnCallCalendar",
    title: "Who is on call",
    description: "Return current/upcoming on-call schedule from the calendar. Optionally scope by team and time range.",
    inputSchema: { team_id: z.number().int().optional(), from: z.string().optional(), to: z.string().optional(), response_format: RF },
    annotations: READ,
    map: (a) => ({ operationId: "getOnCallCalendar", query: { team_id: a.team_id, from: a.from, to: a.to }, response_format: a.response_format }),
  },
  {
    name: "ir_oncall_health",
    operationId: "listTeamHealthSummaries",
    title: "On-call health summaries",
    description: "List on-call health summaries per team (coverage gaps, rotation issues).",
    inputSchema: { response_format: RF },
    annotations: READ,
    map: (a) => ({ operationId: "listTeamHealthSummaries", response_format: a.response_format }),
  },
  {
    name: "ir_list_rotations",
    operationId: "listRotations",
    title: "List rotations",
    description: "List on-call rotations.",
    inputSchema: { response_format: RF },
    annotations: READ,
    map: (a) => ({ operationId: "listRotations", response_format: a.response_format }),
  },
  {
    name: "ir_create_rotation_override",
    operationId: "createRotationOverride",
    title: "Create a rotation override",
    description: "Override who is on call for a rotation over a time window (e.g. cover a shift).",
    inputSchema: { rotation_id: z.number().int(), user_id: z.number().int(), start: z.string(), end: z.string() },
    annotations: WRITE,
    map: (a) => ({ operationId: "createRotationOverride", pathParams: { rotation_id: a.rotation_id }, body: { user_id: a.user_id, start: a.start, end: a.end } }),
  },

  // ---- Silences ----
  {
    name: "ir_list_silences",
    operationId: "listSilences",
    title: "List silences",
    description: "List active/scheduled alert silences.",
    inputSchema: { response_format: RF },
    annotations: READ,
    map: (a) => ({ operationId: "listSilences", response_format: a.response_format }),
  },
  {
    name: "ir_create_silence",
    operationId: "createSilence",
    title: "Create a silence",
    description: "Silence alerts matching label matchers for a time window.",
    inputSchema: { matchers: z.array(z.record(z.unknown())), starts_at: z.string().optional(), ends_at: z.string(), comment: z.string().optional() },
    annotations: WRITE,
    map: (a) => ({ operationId: "createSilence", body: { matchers: a.matchers, starts_at: a.starts_at, ends_at: a.ends_at, comment: a.comment } }),
  },
  {
    name: "ir_remove_silence",
    operationId: "disableSilence",
    title: "Remove (disable) a silence",
    description: "Disable an existing silence. Destructive: requires confirm: true.",
    inputSchema: { silence_id: z.number().int(), confirm: z.boolean().optional() },
    annotations: DESTRUCTIVE,
    map: (a) => ({ operationId: "disableSilence", pathParams: { silence_id: a.silence_id }, confirm: a.confirm }),
  },

  // ---- Maintenance ----
  {
    name: "ir_list_maintenance_windows",
    operationId: "listMaintenanceWindows",
    title: "List maintenance windows",
    description: "List planned maintenance windows.",
    inputSchema: { response_format: RF },
    annotations: READ,
    map: (a) => ({ operationId: "listMaintenanceWindows", response_format: a.response_format }),
  },
  {
    name: "ir_create_maintenance_window",
    operationId: "createMaintenanceWindow",
    title: "Create a maintenance window",
    description: "Schedule a maintenance window to control alert behavior during planned work.",
    inputSchema: { title: z.string(), starts_at: z.string(), ends_at: z.string(), team_id: z.number().int().optional() },
    annotations: WRITE,
    map: (a) => ({ operationId: "createMaintenanceWindow", body: { title: a.title, starts_at: a.starts_at, ends_at: a.ends_at, team_id: a.team_id } }),
  },

  // ---- Context ----
  {
    name: "ir_list_teams",
    operationId: "listTeams",
    title: "List teams",
    description: "List teams (for resolving team_id used elsewhere).",
    inputSchema: { response_format: RF },
    annotations: READ,
    map: (a) => ({ operationId: "listTeams", response_format: a.response_format }),
  },
  {
    name: "ir_list_routes",
    operationId: "listRoutes",
    title: "List routes",
    description: "List alert intake routes.",
    inputSchema: { response_format: RF },
    annotations: READ,
    map: (a) => ({ operationId: "listRoutes", response_format: a.response_format }),
  },
  {
    name: "ir_list_channels",
    operationId: "listChannels",
    title: "List notification channels",
    description: "List notification channels (Slack/Telegram/email/etc.).",
    inputSchema: { response_format: RF },
    annotations: READ,
    map: (a) => ({ operationId: "listChannels", response_format: a.response_format }),
  },
  {
    name: "ir_whoami",
    operationId: "getCurrentUser",
    title: "Who am I",
    description: "Return the authenticated user identity and active group for the current token.",
    inputSchema: {},
    annotations: READ,
    map: () => ({ operationId: "getCurrentUser" }),
  },

  // ---- Heartbeats ----
  {
    name: "ir_list_heartbeats",
    operationId: "get_api_heartbeats",
    title: "List heartbeats",
    description: "List heartbeat monitors and their status.",
    inputSchema: { response_format: RF },
    annotations: READ,
    map: (a) => ({ operationId: "get_api_heartbeats", response_format: a.response_format }),
  },
  {
    name: "ir_send_heartbeat",
    operationId: "post_api_heartbeats_ping_token",
    title: "Send a heartbeat ping",
    description: "Send a heartbeat ping using the heartbeat's ping token.",
    inputSchema: { token: z.string() },
    annotations: WRITE,
    map: (a) => ({ operationId: "post_api_heartbeats_ping_token", pathParams: { token: a.token } }),
  },
];

export function registerCuratedTools(server: McpServer, ctx: ToolCtx): void {
  for (const spec of CURATED_TOOLS) {
    server.registerTool(
      spec.name,
      {
        title: spec.title,
        description: spec.description,
        inputSchema: spec.inputSchema,
        annotations: spec.annotations,
      },
      async (args: any) => executeOperation(ctx, spec.map(args))
    );
  }
}
```

- [ ] **Step 4: Verify synthesized heartbeat ids against the snapshot**

Run:
```bash
node -e "import('./src/openapi/catalog.js').then(m=>{const c=m.buildCatalog(m.loadSnapshotSpec());for(const id of ['get_api_heartbeats','post_api_heartbeats_ping_token']){console.log(id, !!c.get(id))}})"
```
> If either prints `false`, the id synthesis produced a different string. Inspect with:
> `node -e "import('./src/openapi/catalog.js').then(m=>{const c=m.buildCatalog(m.loadSnapshotSpec());console.log(c.list({tag:'Heartbeats'}))})"`
> and update the `operationId`/`map` values in `curated.ts` to match. This is why the contract test in Step 1 exists.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/curated.test.ts`
Expected: PASS. If the contract test fails for a specific tool, fix its `operationId` to the value found in the snapshot and re-run.

- [ ] **Step 6: Commit**

```bash
git add src/tools/curated.ts test/curated.test.ts
git commit -m "feat: 22 curated on-call tools mapped to real operationIds"
```

---

### Task 8: Server assembly + registry

**Files:**
- Create: `src/server.ts`
- Test: `test/server.test.ts`

**Interfaces:**
- Consumes: `registerGatewayTools` (Task 6), `registerCuratedTools` (Task 7), `Catalog`, `IRClient`, `Config`, `SERVER_NAME`/`SERVER_VERSION` (Task 0).
- Produces:
  - `function createServer(ctx: ToolCtx): McpServer` — builds an `McpServer` with all tools registered.
  - `async function buildContext(cfg: Config): Promise<{ ctx: ToolCtx; source: "live"|"snapshot" }>` — loads spec, builds catalog + client.

- [ ] **Step 1: Write failing test `test/server.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildCatalog, loadSnapshotSpec } from "../src/openapi/catalog.js";
import { IRClient } from "../src/client.js";
import { createServer } from "../src/server.js";
import type { ToolCtx } from "../src/execute.js";

function ctx(): ToolCtx {
  const cfg = { baseUrl: "https://ir.example.com", token: "t", transport: "stdio" as const, port: 3000, host: "127.0.0.1", readonly: false, timeoutMs: 5000, openapiUrl: "x", verifyTls: true };
  return { catalog: buildCatalog(loadSnapshotSpec()), client: new IRClient(cfg), readonly: false };
}

describe("createServer", () => {
  it("registers gateway + curated tools and lists them over MCP", async () => {
    const server = createServer(ctx());
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0.0.0" });
    await Promise.all([server.connect(serverT), client.connect(clientT)]);

    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("ir_list_operations");
    expect(names).toContain("ir_describe_operation");
    expect(names).toContain("ir_call");
    expect(names).toContain("ir_ack_alert");
    expect(names.length).toBeGreaterThanOrEqual(25);
    await client.close();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/server.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `src/server.ts`**

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SERVER_NAME, SERVER_VERSION } from "./version.js";
import type { Config } from "./config.js";
import { IRClient } from "./client.js";
import { buildCatalog, loadSpec } from "./openapi/catalog.js";
import { registerGatewayTools } from "./tools/gateway.js";
import { registerCuratedTools } from "./tools/curated.js";
import type { ToolCtx } from "./execute.js";

export function createServer(ctx: ToolCtx): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  registerGatewayTools(server, ctx);
  registerCuratedTools(server, ctx);
  return server;
}

export async function buildContext(cfg: Config): Promise<{ ctx: ToolCtx; source: "live" | "snapshot" }> {
  const { spec, source } = await loadSpec({ openapiUrl: cfg.openapiUrl, timeoutMs: cfg.timeoutMs });
  const ctx: ToolCtx = { catalog: buildCatalog(spec), client: new IRClient(cfg), readonly: cfg.readonly };
  return { ctx, source };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/server.test.ts`
Expected: PASS (snapshot yields ≥25 tools).

- [ ] **Step 5: Commit**

```bash
git add src/server.ts test/server.test.ts
git commit -m "feat: assemble McpServer with gateway + curated tools"
```

---

### Task 9: Entry point + transports

**Files:**
- Create: `src/index.ts`, `src/http.ts`
- Test: `test/http.test.ts`

**Interfaces:**
- Consumes: `loadConfig` (Task 1), `buildContext`/`createServer` (Task 8).
- Produces:
  - `function startHttp(cfg: Config, makeServer: () => McpServer): Promise<{ close: () => Promise<void>; port: number }>` in `src/http.ts` — stateless Streamable HTTP on `POST /mcp` with DNS-rebinding protection.
  - `src/index.ts` — CLI entry with `#!/usr/bin/env node` shebang; selects transport; logs `source` and tool count to stderr.

- [ ] **Step 1: Write failing test `test/http.test.ts`**

```ts
import { describe, it, expect, afterEach } from "vitest";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { buildCatalog, loadSnapshotSpec } from "../src/openapi/catalog.js";
import { IRClient } from "../src/client.js";
import { createServer } from "../src/server.js";
import { startHttp } from "../src/http.js";
import type { Config } from "../src/config.js";
import type { ToolCtx } from "../src/execute.js";

const cfg: Config = { baseUrl: "https://ir.example.com", token: "t", transport: "http", port: 0, host: "127.0.0.1", readonly: false, timeoutMs: 5000, openapiUrl: "x", verifyTls: true };

function ctx(): ToolCtx {
  return { catalog: buildCatalog(loadSnapshotSpec()), client: new IRClient(cfg), readonly: false };
}

let handle: { close: () => Promise<void>; port: number } | undefined;
afterEach(async () => { if (handle) await handle.close(); handle = undefined; });

describe("startHttp", () => {
  it("serves MCP over streamable HTTP", async () => {
    handle = await startHttp({ ...cfg, port: 0 }, () => createServer(ctx()));
    const client = new Client({ name: "test", version: "0.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${handle.port}/mcp`));
    await client.connect(transport);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain("ir_call");
    await client.close();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/http.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `src/http.ts`**

```ts
import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Config } from "./config.js";

export async function startHttp(
  cfg: Config,
  makeServer: () => McpServer
): Promise<{ close: () => Promise<void>; port: number }> {
  const app = express();
  app.use(express.json({ limit: "4mb" }));
  app.use(cors({ origin: false }));

  // Stateless: a fresh server + transport per request (recommended for API proxies).
  app.post("/mcp", async (req, res) => {
    const server = makeServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableDnsRebindingProtection: true,
      allowedHosts: [`127.0.0.1:${cfg.port}`, `localhost:${cfg.port}`, cfg.host],
    });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  // GET/DELETE are not used in stateless mode.
  app.get("/mcp", (_req, res) => res.status(405).json({ error: "Method Not Allowed" }));
  app.delete("/mcp", (_req, res) => res.status(405).json({ error: "Method Not Allowed" }));

  return await new Promise((resolve) => {
    const httpServer = app.listen(cfg.port, cfg.host, () => {
      const port = (httpServer.address() as AddressInfo).port;
      resolve({
        port,
        close: () => new Promise<void>((r) => httpServer.close(() => r())),
      });
    });
  });
}
```

> Note: `sessionIdGenerator: undefined` selects stateless mode. `randomUUID` is imported for parity with the stateful pattern; if you later add sessions, switch to `sessionIdGenerator: () => randomUUID()` and keep a transport map.

- [ ] **Step 4: Write `src/index.ts`**

```ts
#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { buildContext, createServer } from "./server.js";
import { startHttp } from "./http.js";

async function main() {
  const cfg = loadConfig(process.argv.slice(2), process.env);
  if (!cfg.verifyTls) {
    process.stderr.write(
      "[incidentrelay-mcp] WARNING: TLS verification is DISABLED (IR_VERIFY_TLS=false). " +
        "This exposes traffic to MITM attacks. Prefer adding the server CA to your trust store.\n"
    );
  }
  const { ctx, source } = await buildContext(cfg);
  process.stderr.write(
    `[incidentrelay-mcp] catalog loaded from ${source} (${ctx.catalog.size} operations); ` +
      `readonly=${cfg.readonly} transport=${cfg.transport}\n`
  );

  if (cfg.transport === "http") {
    const handle = await startHttp(cfg, () => createServer(ctx));
    process.stderr.write(`[incidentrelay-mcp] listening on http://${cfg.host}:${handle.port}/mcp\n`);
  } else {
    const server = createServer(ctx);
    await server.connect(new StdioServerTransport());
    process.stderr.write(`[incidentrelay-mcp] stdio transport connected\n`);
  }
}

main().catch((e) => {
  process.stderr.write(`[incidentrelay-mcp] fatal: ${(e as Error).message}\n`);
  process.exit(1);
});
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run test/http.test.ts`
Expected: PASS.

- [ ] **Step 6: Full build + full test suite**

Run: `npm run build && npx vitest run`
Expected: build succeeds; all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/index.ts src/http.ts test/http.test.ts
git commit -m "feat: CLI entry with stdio and streamable HTTP transports"
```

---

### Task 10: Docs, snapshot regeneration, README

**Files:**
- Create: `README.md`, `scripts/generate-snapshot.md`

**Interfaces:** none (documentation).

- [ ] **Step 1: Write `scripts/generate-snapshot.md`**

```markdown
# Regenerating src/openapi/snapshot.json

The bundled snapshot is the offline fallback catalog. Regenerate it from a
checkout of the IncidentRelay repo when its API changes.

```bash
# from the IncidentRelay repo root, in a venv with requirements installed
python3 -m venv /tmp/irvenv && /tmp/irvenv/bin/pip install -r requirements.txt
cat > /tmp/ir.conf <<'CONF'
[main]
secret_key = 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
[database]
type = sqlite
path = /tmp/ir_dummy.db
CONF
INCIDENTRELAY_CONFIG_FILE=/tmp/ir.conf /tmp/irvenv/bin/python -c \
  "import json; from app.api.openapi.spec import build_openapi_spec; \
   json.dump(build_openapi_spec(), open('snapshot.json','w'), indent=2)"
```

Copy the resulting `snapshot.json` to `src/openapi/snapshot.json` in this repo
and run `npx vitest run test/curated.test.ts` to confirm curated tools still map.
```

- [ ] **Step 2: Write `README.md`**

Include: what it is; install (`npm install`, `npm run build`); configuration table (from spec §4); Claude Desktop/Code config example; transport usage; the two tool layers (gateway + curated) with the full curated list; safety notes (confirm-guard, readonly); a **Security** section documenting that `IR_VERIFY_TLS=false` disables certificate verification and should only be used with a trusted network, with "add the CA to your trust store" as the recommended alternative for self-signed certs; how to regenerate the snapshot.

Claude Desktop config example to include:
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

- [ ] **Step 3: Commit**

```bash
git add README.md scripts/generate-snapshot.md
git commit -m "docs: README and snapshot regeneration guide"
```

---

### Task 11: Eval harness (optional, high-value)

**Files:**
- Create: `eval/tasks.json`, `eval/README.md`

**Interfaces:** none (offline eval assets).

- [ ] **Step 1: Write `eval/tasks.json`** — 12 realistic multi-step tasks with the expected tool(s), e.g.:

```json
[
  { "prompt": "Acknowledge the newest firing critical alert for team infra and add the comment 'investigating'.", "expected_tools": ["ir_list_alerts", "ir_ack_alert", "ir_comment_alert"] },
  { "prompt": "Who is on call for the payments team right now?", "expected_tools": ["ir_list_teams", "ir_who_is_on_call"] },
  { "prompt": "Silence disk-space alerts on host1 for the next 2 hours.", "expected_tools": ["ir_create_silence"] },
  { "prompt": "Open a manual incident titled 'Checkout latency spike' at high severity.", "expected_tools": ["ir_create_incident"] },
  { "prompt": "Delete route 5.", "expected_tools": ["ir_call"], "notes": "must require confirm:true" },
  { "prompt": "Show me the request body needed to create a rotation.", "expected_tools": ["ir_list_operations", "ir_describe_operation"] }
]
```
(Add 6 more covering incidents responders, maintenance windows, heartbeats, on-call health, channels test, and a gateway-only long-tail operation.)

- [ ] **Step 2: Write `eval/README.md`** describing how to run these through an agentic loop against a dev server, and that they are not part of `npm test`.

- [ ] **Step 3: Commit**

```bash
git add eval/
git commit -m "test: add agentic eval task set"
```

---

## Self-Review

**Spec coverage:**
- §2 architecture (catalog, live+snapshot, boundaries) → Tasks 2, 8, 9.
- §3.1 gateway tools (3) → Task 6.
- §3.2 curated tools (~22) → Task 7 (contract-tested against snapshot).
- §4 auth/config → Task 1; forwarded by Task 3.
- §5 error handling → Task 3; safety/confirm-guard/readonly → Task 4 + Task 6; token efficiency (response_format, truncation) → Task 5; applied in Task 6/7.
- §6 transports + HTTP security (DNS rebinding, localhost, session id) → Task 9; SDK pin → Global Constraints + Task 0.
- §7 project structure → Tasks 0–11 create exactly these files.
- §8 testing (unit/tool/contract/http) → each task's tests; contract test in Task 7; integration smoke noted (env-gated, out of `npm test` default).
- §9 best-practice checklist → namespacing (all tasks), search (Task 6), response_format (Tasks 5/7), meaningful output via concise shaping (Task 5), actionable errors (Task 3), annotations (Tasks 6/7), descriptions with when-NOT-to-use (Task 6), HTTP security (Task 9), eval (Task 11).
- §10 open questions → `ir_who_is_on_call` endpoint verified as `getOnCallCalendar` with fallback note in Task 7; heartbeat synthesized ids verified in Task 7 Step 4.

**Placeholder scan:** No "TBD/TODO/handle edge cases" left as implementation stand-ins; the two "add 6 more" / README content items in Tasks 10–11 are documentation/eval assets with concrete examples given, not code placeholders.

**Type consistency:** `ToolCtx`, `ExecuteArgs`, `ToolResult`, `executeOperation`, `Catalog` (`get`/`list`/`describe`/`findByMethodPath`/`size`), `IRClient.call`, `CallRequest`, `IRError.toJSON`, `Config` fields, `registerGatewayTools`/`registerCuratedTools`/`createServer`/`buildContext`/`startHttp` — names and signatures are used identically across Tasks 1–9. Curated `map()` returns `ExecuteArgs`; gateway and curated both funnel through `executeOperation`.
