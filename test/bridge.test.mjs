import test from "node:test";
import assert from "node:assert/strict";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createBridgeServer, LOCAL_UPLOAD_TOOL } from "../dist/bridge.js";

test("proxies live tool schemas, structured results and images; adds local path-only upload", async () => {
  const requests = [];
  const upstreamTool = {
    name: "query_project_dataset",
    description: "SQL",
    inputSchema: { type: "object", properties: { sql: { type: "string" } }, required: ["sql"] },
    annotations: { readOnlyHint: true },
  };
  const remote = {
    listTools: async () => ({ tools: [upstreamTool] }),
    callTool: async (args) => {
      requests.push(args);
      return {
        content: [{ type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" }],
        structuredContent: { result: "sent" },
      };
    },
    listResources: async () => ({ resources: [] }),
    listResourceTemplates: async () => ({ resourceTemplates: [] }),
    readResource: async () => ({ contents: [] }),
    listPrompts: async () => ({ prompts: [] }),
    getPrompt: async () => ({ messages: [] }),
  };
  const server = createBridgeServer(remote, async (_path, projectId) => ({
    id: "ds1", projectId: projectId ?? "p1", filename: "x.csv", sizeBytes: 5,
    mimeType: "text/csv", columnCount: 2,
  }));
  const client = new Client({ name: "test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map((t) => t.name), [LOCAL_UPLOAD_TOOL, "query_project_dataset"]);
    assert.deepEqual(listed.tools[1].inputSchema, upstreamTool.inputSchema);
    assert.deepEqual(listed.tools[1].annotations, upstreamTool.annotations);
    assert.deepEqual(listed.tools[0].inputSchema.required, ["file_path"]);
    assert.equal("content" in listed.tools[0].inputSchema.properties, false);

    const forwarded = await client.callTool({ name: "query_project_dataset", arguments: { sql: "SELECT 1" } });
    assert.deepEqual(requests, [{ name: "query_project_dataset", arguments: { sql: "SELECT 1" } }]);
    assert.equal(forwarded.content[0].type, "image");
    assert.deepEqual(forwarded.structuredContent, { result: "sent" });

    const receipt = await client.callTool({
      name: LOCAL_UPLOAD_TOOL, arguments: { file_path: "./data.csv", project_id: "p2" },
    });
    assert.deepEqual(receipt.structuredContent, {
      id: "ds1", projectId: "p2", filename: "x.csv", sizeBytes: 5,
      mimeType: "text/csv", columnCount: 2,
    });
    const invalid = await client.callTool({ name: LOCAL_UPLOAD_TOOL, arguments: {} });
    assert.equal(invalid.isError, true);
  } finally {
    await client.close();
    await server.close();
  }
});
