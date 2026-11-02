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
  // Security: `path` can come from the model (ir_call with method+path). A value
  // such as "@evil.example/x" or ".evil.example/x" would otherwise turn
  // `baseUrl + path` into a different host and leak the bearer token to it.
  if (!p.startsWith("/")) {
    throw new IRError({
      status: 0,
      message: `Refusing request: path must start with "/" (got ${JSON.stringify(path)}).`,
      suggestion: "Pass a relative API path such as /api/alerts, or use an operationId.",
    });
  }
  const base = new URL(baseUrl);
  const url = new URL(baseUrl + p);
  if (url.origin !== base.origin || url.username !== base.username || url.password !== base.password) {
    throw new IRError({
      status: 0,
      message: `Refusing request: path ${JSON.stringify(path)} would leave the configured IR_BASE_URL.`,
      suggestion: "Only paths on the configured IncidentRelay server can be called.",
    });
  }
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
