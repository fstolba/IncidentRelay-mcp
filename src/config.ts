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
