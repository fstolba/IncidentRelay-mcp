import express from "express";
import cors from "cors";
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

  // Set after listen() so DNS-rebinding allowedHosts uses the real bound port.
  let boundPort = cfg.port;

  // Stateless: a fresh server + transport per request (recommended for API proxies).
  app.post("/mcp", async (req, res) => {
    const server = makeServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableDnsRebindingProtection: true,
      allowedHosts: [
        `127.0.0.1:${boundPort}`,
        `localhost:${boundPort}`,
        `${cfg.host}:${boundPort}`,
      ],
    });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  // GET/DELETE are not used in stateless mode.
  app.get("/mcp", (_req, res) => {
    res.status(405).json({ error: "Method Not Allowed" });
  });
  app.delete("/mcp", (_req, res) => {
    res.status(405).json({ error: "Method Not Allowed" });
  });

  return await new Promise((resolve) => {
    const httpServer = app.listen(cfg.port, cfg.host, () => {
      boundPort = (httpServer.address() as AddressInfo).port;
      resolve({
        port: boundPort,
        close: () => new Promise<void>((r) => httpServer.close(() => r())),
      });
    });
  });
}
