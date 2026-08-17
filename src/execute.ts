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
  // Index signature keeps this structurally compatible with the SDK's
  // CallToolResult (which carries an open `[x: string]: unknown`).
  [x: string]: unknown;
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
      structuredContent:
        shaped && typeof shaped === "object" && !Array.isArray(shaped)
          ? (shaped as Record<string, unknown>)
          : { result: shaped },
    };
  } catch (e) {
    if (e instanceof IRError) return textResult(toToolText(e.toJSON()), true);
    return textResult(`Unexpected error: ${(e as Error).message}`, true);
  }
}
