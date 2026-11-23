import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../dist/config.js";
import { DownloadError, downloadProjectDatasetToFile } from "../dist/download.js";
import { MAX_UPLOAD_BYTES } from "../dist/upload.js";

async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), "vizhub-mcp-download-"));
  try {
    const config = loadConfig({
      VIZHUB_API_TOKEN: "test-secret",
      VIZHUB_PROJECT_ID: "p123",
      VIZHUB_UPLOAD_ROOTS: root,
    }, root);
    await fn(root, config);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("downloads original Parquet bytes without returning data through the MCP", async () => {
  await fixture(async (root, config) => {
    const output = join(root, "data.parquet");
    const original = Uint8Array.from([80, 65, 82, 49, 0, 255, 128, 42, 80, 65, 82, 49]);
    const receipt = await downloadProjectDatasetToFile(config, "dataset-123", output, undefined, async (url, options) => {
      assert.equal(String(url), "https://vizhub.com/api/v1/projects/p123/datasets/dataset-123/content");
      assert.equal(options.method, "GET");
      assert.equal(options.headers.Authorization, "Bearer test-secret");
      assert.equal(options.redirect, "error");
      return new Response(original, {
        status: 200,
        headers: { "Content-Type": "application/vnd.apache.parquet" },
      });
    });
    assert.deepEqual(new Uint8Array(await readFile(output)), original);
    assert.deepEqual(receipt, {
      datasetId: "dataset-123",
      projectId: "p123",
      outputPath: output,
      sizeBytes: original.byteLength,
      sha256: createHash("sha256").update(original).digest("hex"),
      mimeType: "application/vnd.apache.parquet",
    });
    assert.equal(JSON.stringify(receipt).includes("test-secret"), false);
    assert.equal(JSON.stringify(receipt).includes("PAR1"), false);
    assert.deepEqual(await readdir(root), ["data.parquet"]);
  });
});

test("rejects overwrites without sending an HTTP request", async () => {
  await fixture(async (root, config) => {
    const output = join(root, "exists.csv");
    await writeFile(output, "do not replace");
    await assert.rejects(() =>
      downloadProjectDatasetToFile(config, "dataset-123", output, undefined, () => {
        throw new Error("HTTP should not be called");
      }), /already exists/);
    assert.equal(await readFile(output, "utf8"), "do not replace");
  });
});

test("refuses writes outside file roots and through symlinked destination directories", async () => {
  await fixture(async (root, config) => {
    const other = await mkdtemp(join(tmpdir(), "vizhub-mcp-outside-"));
    try {
      await symlink(other, join(root, "escape"), "dir");
      for (const output of [join(other, "bad.csv"), join(root, "escape", "bad.csv")]) {
        await assert.rejects(() => downloadProjectDatasetToFile(config, "ds", output), DownloadError);
      }
      await assert.rejects(() => downloadProjectDatasetToFile(config, "../bad", join(root, "x.csv")), DownloadError);
    } finally {
      await rm(other, { recursive: true, force: true });
    }
  });
});

test("handles denied downloads without leaving files behind", async () => {
  await fixture(async (root, config) => {
    const output = join(root, "private.csv");
    await assert.rejects(() => downloadProjectDatasetToFile(config, "dataset-123", output, undefined,
      async () => new Response('{"error":"forbidden"}', { status: 403 })), /HTTP 403/);
    assert.deepEqual(await readdir(root), []);
  });
});

test("incomplete network stream cleans up temporary and final paths", async () => {
  await fixture(async (root, config) => {
    const output = join(root, "broken.csv");
    const incomplete = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([97, 44, 98, 10]));
        controller.error(new Error("connection failed"));
      },
    });
    await assert.rejects(() => downloadProjectDatasetToFile(config, "dataset-123", output, undefined,
      async () => new Response(incomplete)), DownloadError);
    assert.deepEqual(await readdir(root), []);
  });
});

test("enforces byte limits even when Content-Length is absent or forged", async () => {
  await fixture(async (root, config) => {
    const output = join(root, "big.csv");
    await assert.rejects(() => downloadProjectDatasetToFile(config, "dataset-123", output, undefined,
      async () => new Response(new Uint8Array(MAX_UPLOAD_BYTES + 1))), /10 MiB/);
    assert.deepEqual(await readdir(root), []);
    await assert.rejects(() => downloadProjectDatasetToFile(config, "dataset-123", output, undefined,
      async () => new Response("small", {
        headers: { "Content-Length": String(MAX_UPLOAD_BYTES + 1) },
      })), /10 MiB/);
    assert.deepEqual(await readdir(root), []);
  });
});

test("refuses empty 200 responses", async () => {
  await fixture(async (root, config) => {
    await assert.rejects(() => downloadProjectDatasetToFile(config, "dataset-123", join(root, "empty.csv"),
      undefined, async () => new Response("")), /empty dataset/);
    assert.deepEqual(await readdir(root), []);
  });
});
