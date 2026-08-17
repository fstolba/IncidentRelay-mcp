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
        "Search the IncidentRelay API catalog (all operations). Filter by free-text query, tag, or HTTP method. " +
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
        "Execute any IncidentRelay operation. Provide operationId (preferred) or method+path. " +
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
