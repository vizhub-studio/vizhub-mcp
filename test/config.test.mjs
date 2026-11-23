import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../dist/config.js";

test("requires API token and valid project ID", () => {
  assert.throws(() => loadConfig({}, "/tmp"), /VIZHUB_API_TOKEN/);
  assert.throws(() => loadConfig({ VIZHUB_API_TOKEN: "t", VIZHUB_PROJECT_ID: "../x" }, "/tmp"), /VIZHUB_PROJECT_ID/);
});

test("defaults to HTTPS VizHub endpoint and scopes paths to cwd", () => {
  const config = loadConfig({ VIZHUB_API_TOKEN: "t", VIZHUB_PROJECT_ID: "p1" }, "/tmp/project");
  assert.equal(String(config.mcpUrl), "https://vizhub.com/api/mcp");
  assert.deepEqual(config.uploadRoots, ["/tmp/project"]);
});

test("refuses insecure remote credentials transport and URL path", () => {
  assert.throws(() => loadConfig({ VIZHUB_API_TOKEN: "t", VIZHUB_PROJECT_ID: "p1", VIZHUB_BASE_URL: "http://example.com" }), /HTTPS/);
  assert.throws(() => loadConfig({ VIZHUB_API_TOKEN: "t", VIZHUB_PROJECT_ID: "p1", VIZHUB_BASE_URL: "https://vizhub.com/x" }), /HTTPS/);
});
