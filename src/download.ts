import { createHash, randomUUID } from "node:crypto";
import { link, lstat, open, realpath, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { validProjectId, type BridgeConfig } from "./config.js";
import { MAX_UPLOAD_BYTES } from "./upload.js";

export class DownloadError extends Error {}

export interface DownloadReceipt {
  datasetId: string;
  projectId: string;
  outputPath: string;
  sizeBytes: number;
  sha256: string;
  mimeType: string;
}

const DATASET_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function insideRoot(path: string, root: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel));
}

/**
 * Stream original project dataset bytes into a private temporary file, then
 * atomically publish without overwriting. The output directory must exist.
 * Neither tool arguments nor the result include file content.
 */
export async function downloadProjectDatasetToFile(
  config: BridgeConfig,
  datasetId: string,
  outputPath: string,
  projectId = config.projectId,
  fetchImpl: typeof fetch = fetch,
): Promise<DownloadReceipt> {
  if (!validProjectId(projectId)) throw new DownloadError("Invalid project ID.");
  if (!DATASET_ID_PATTERN.test(datasetId)) throw new DownloadError("Invalid dataset ID.");
  if (typeof outputPath !== "string" || !outputPath.trim()) {
    throw new DownloadError("output_path must be a nonempty local path.");
  }

  let parent: string;
  let destination: string;
  try {
    const requested = resolve(outputPath);
    parent = await realpath(dirname(requested));
    const roots = await Promise.all(config.uploadRoots.map((root) => realpath(root)));
    if (!roots.some((root) => insideRoot(parent, root))) {
      throw new DownloadError("Destination is outside the allowed file directories.");
    }
    destination = join(parent, basename(requested));
    // Early conflict check avoids a wasted network request. The atomic
    // hard-link below also handles races after this initial check.
    try {
      await lstat(destination);
      throw new DownloadError("Destination already exists; overwriting is disabled.");
    } catch (error) {
      if (error instanceof DownloadError) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  } catch (error) {
    if (error instanceof DownloadError) throw error;
    throw new DownloadError("Destination directory is missing or inaccessible.");
  }

  const url = new URL(
    "/api/v1/projects/" + encodeURIComponent(projectId) +
      "/datasets/" + encodeURIComponent(datasetId) + "/content",
    config.baseUrl,
  );
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: { Authorization: "Bearer " + config.apiToken, Accept: "application/octet-stream" },
      redirect: "error",
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new DownloadError("Could not reach VizHub dataset API.");
  }
  if (response.status !== 200 || !response.ok) {
    throw new DownloadError("VizHub rejected download: HTTP " + response.status + ".");
  }
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null && /^\d+$/.test(declaredLength) &&
      Number(declaredLength) > MAX_UPLOAD_BYTES) {
    throw new DownloadError("File exceeds VizHub's 10 MiB transfer limit.");
  }
  if (!response.body) throw new DownloadError("VizHub returned no dataset bytes.");

  const temp = join(parent, "." + basename(destination) + ".vizhub-" + randomUUID() + ".tmp");
  const reader = response.body.getReader();
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let sizeBytes = 0;
  const digest = createHash("sha256");
  try {
    handle = await open(temp, "wx", 0o600);
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      sizeBytes += value.byteLength;
      if (sizeBytes > MAX_UPLOAD_BYTES) {
        throw new DownloadError("File exceeds VizHub's 10 MiB transfer limit.");
      }
      digest.update(value);
      await handle.writeFile(value);
    }
    if (sizeBytes === 0) throw new DownloadError("VizHub returned an empty dataset.");
    await handle.sync();
    await handle.close();
    handle = undefined;
    try {
      // An atomic hard-link cannot replace a pre-existing file or symlink.
      await link(temp, destination);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new DownloadError("Destination already exists; overwriting is disabled.");
      }
      throw error;
    }
    return {
      datasetId, projectId, outputPath: destination, sizeBytes,
      sha256: digest.digest("hex"),
      mimeType: response.headers.get("content-type") || "application/octet-stream",
    };
  } catch (error) {
    if (error instanceof DownloadError) throw error;
    throw new DownloadError("Could not save downloaded dataset.");
  } finally {
    await handle?.close().catch(() => undefined);
    await reader.cancel().catch(() => undefined);
    await unlink(temp).catch(() => undefined);
  }
}
