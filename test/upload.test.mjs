import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../dist/config.js";
import { MAX_UPLOAD_BYTES, UploadError, uploadProjectDatasetFromFile } from "../dist/upload.js";

async function fixture(fn) {
  const dir = await mkdtemp(join(tmpdir(), "vizhub-mcp-test-"));
  try {
    const cfg = loadConfig({
      VIZHUB_API_TOKEN: "test-secret",
      VIZHUB_PROJECT_ID: "p123",
      VIZHUB_UPLOAD_ROOTS: dir,
    }, dir);
    await fn(dir, cfg);
  } finally { await rm(dir, { recursive: true, force: true }); }
}

test("sends original binary bytes and metadata only, never token or content in receipt", async () => {
  await fixture(async (dir, config) => {
    const bytes = Buffer.from([80,65,82,49,0,255,8,10,80,65,82,49]);
    const file = join(dir, "sample.parquet");
    await writeFile(file, bytes);
    let called = false;
    const response = await uploadProjectDatasetFromFile(config, file, undefined, async (url, options) => {
      called = true;
      assert.equal(String(url), "https://vizhub.com/api/v1/projects/p123/datasets");
      assert.equal(options.headers.Authorization, "Bearer test-secret");
      assert.equal(options.method, "POST");
      assert.equal(options.body.get("file").name, "sample.parquet");
      assert.deepEqual(Buffer.from(await options.body.get("file").arrayBuffer()), bytes);
      return new Response(JSON.stringify({
        success: true, data: {
          id: "new-id", filename: "sample.parquet", mimeType: "application/vnd.apache.parquet",
          sizeBytes: bytes.length, profile: { columns: [{}, {}] },
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    assert.equal(called, true);
    assert.deepEqual(response, {
      id: "new-id", projectId: "p123", filename: "sample.parquet",
      sizeBytes: bytes.length, mimeType: "application/vnd.apache.parquet", columnCount: 2,
    });
    assert.equal(JSON.stringify(response).includes("test-secret"), false);
  });
});

test("rejects traversal and symlink escapes outside configured roots", async () => {
  await fixture(async (dir, config) => {
    const other = await mkdtemp(join(tmpdir(), "vizhub-mcp-outside-"));
    try {
      const secret = join(other, "secret.csv");
      await writeFile(secret, "private,values\n1,2");
      await symlink(secret, join(dir, "sneaky.csv"));
      await assert.rejects(() => uploadProjectDatasetFromFile(config, secret), UploadError);
      await assert.rejects(() => uploadProjectDatasetFromFile(config, join(dir, "sneaky.csv")), UploadError);
    } finally { await rm(other, { recursive: true, force: true }); }
  });
});

test("enforces 10 MiB limit and file extension before sending HTTP", async () => {
  await fixture(async (dir, config) => {
    const giant = join(dir, "huge.csv");
    const bad = join(dir, "bad.exe");
    await writeFile(giant, Buffer.alloc(MAX_UPLOAD_BYTES + 1, 65));
    await writeFile(bad, "irrelevant");
    await assert.rejects(() => uploadProjectDatasetFromFile(config, giant), /10 MiB/);
    await assert.rejects(() => uploadProjectDatasetFromFile(config, bad), /Unsupported file/);
    await assert.rejects(() => uploadProjectDatasetFromFile(config, giant, "../other"), /Invalid project ID/);
  });
});

test("rejects failing API requests without returning secret or uploaded bytes", async () => {
  await fixture(async (dir, config) => {
    const file = join(dir, "small.csv");
    await writeFile(file, "secret,data\nxxx,yyy");
    await assert.rejects(() => uploadProjectDatasetFromFile(config, file, undefined,
      async () => new Response(JSON.stringify({ error: { code: "FORBIDDEN", message: "secret,data" } }), { status: 403 })),
      (error) => error instanceof UploadError && /HTTP 403/.test(error.message) &&
        !error.message.includes("secret,data") && !error.message.includes("test-secret"));
  });
});
