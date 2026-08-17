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
