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
