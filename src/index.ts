#!/usr/bin/env node
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { createBridgeServer, createUploader, createDownloader } from "./bridge.js";
import { loadConfig } from "./config.js";

async function main() {
  const config = loadConfig();
  const remote = new Client({ name: "vizhub-local-bridge-upstream", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(config.mcpUrl, {
    requestInit: {
      headers: {
        Authorization: "Bearer " + config.apiToken,
        "X-VizHub-Project-ID": config.projectId,
      },
    },
  });
  await remote.connect(transport);
  const server = createBridgeServer(remote, createUploader(config), createDownloader(config));
  await server.connect(new StdioServerTransport());
  const close = async () => {
    await server.close().catch(() => undefined);
    await remote.close().catch(() => undefined);
  };
  process.once("SIGINT", () => { void close().finally(() => process.exit(0)); });
  process.once("SIGTERM", () => { void close().finally(() => process.exit(0)); });
}

main().catch(() => {
  // Do not print raw SDK/network errors, which may contain URL/token details.
  console.error("VizHub local MCP failed to start. Check API token, project ID and VizHub reachability.");
  process.exitCode = 1;
});
