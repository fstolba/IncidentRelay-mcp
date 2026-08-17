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
