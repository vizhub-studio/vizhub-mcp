import { open, realpath } from "node:fs/promises";
import { basename, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { validProjectId, type BridgeConfig } from "./config.js";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MIME_TYPES: Record<string, string> = {
  ".csv": "text/csv",
  ".tsv": "text/tab-separated-values",
  ".json": "application/json",
  ".geojson": "application/geo+json",
  ".parquet": "application/vnd.apache.parquet",
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".txt": "text/plain",
};

export class UploadError extends Error {}

export interface UploadReceipt {
  id: string;
  projectId: string;
  filename: string;
  sizeBytes: number;
  mimeType: string;
  columnCount: number | null;
}

function insideRoot(file: string, root: string): boolean {
  const rel = relative(root, file);
  return rel === "" || (rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel));
}

export async function uploadProjectDatasetFromFile(
  config: BridgeConfig,
  filePath: string,
  projectId = config.projectId,
  fetchImpl: typeof fetch = fetch,
): Promise<UploadReceipt> {
  if (!validProjectId(projectId)) throw new UploadError("Invalid project ID.");
  if (!filePath || typeof filePath !== "string") throw new UploadError("file_path is required.");

  const roots = await Promise.all(config.uploadRoots.map(async (root) => {
    try { return await realpath(root); }
    catch { throw new UploadError("Configured upload directory does not exist."); }
  }));
  let source: string;
  try { source = await realpath(resolve(filePath)); }
  catch { throw new UploadError("File not found or inaccessible."); }
  if (!roots.some((root) => insideRoot(source, root))) {
    throw new UploadError("File is outside the allowed upload directories.");
  }
  const filename = basename(source);
  const mimeType = MIME_TYPES[extname(filename).toLowerCase()];
  if (!mimeType) throw new UploadError("Unsupported file extension.");

  const handle = await open(source, "r").catch(() => { throw new UploadError("File cannot be opened."); });
  let bytes: Buffer;
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size === 0) throw new UploadError("Upload source must be a nonempty regular file.");
    if (info.size > MAX_UPLOAD_BYTES) throw new UploadError("File exceeds VizHub's 10 MiB upload limit.");
    bytes = await handle.readFile();
    if (bytes.length > MAX_UPLOAD_BYTES) throw new UploadError("File exceeds VizHub's 10 MiB upload limit.");
  } finally {
    await handle.close();
  }

  const data = new FormData();
  data.append("file", new Blob([new Uint8Array(bytes)], { type: mimeType }), filename);
  const url = new URL("/api/v1/projects/" + encodeURIComponent(projectId) + "/datasets", config.baseUrl);
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { Authorization: "Bearer " + config.apiToken },
      body: data,
      redirect: "error",
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new UploadError("Could not reach VizHub upload API.");
  }

  let body: unknown;
  try { body = await response.json(); }
  catch { throw new UploadError("VizHub returned an invalid upload response."); }
  if (!response.ok) {
    const error = (body as { error?: { code?: unknown } } | null)?.error;
    const code = typeof error?.code === "string" && /^[A-Z_]{1,60}$/.test(error.code)
      ? " (" + error.code + ")" : "";
    throw new UploadError("VizHub rejected upload: HTTP " + response.status + code + ".");
  }

  const payload = body as { success?: boolean; data?: {
    id?: unknown; filename?: unknown; sizeBytes?: unknown; mimeType?: unknown;
    profile?: { columns?: unknown[] } | null;
  }} | null;
  const result = payload?.data;
  if (payload?.success !== true || typeof result?.id !== "string" ||
      typeof result?.filename !== "string" || typeof result?.sizeBytes !== "number") {
    throw new UploadError("VizHub returned an incomplete upload receipt.");
  }
  return {
    id: result.id,
    projectId,
    filename: result.filename,
    sizeBytes: result.sizeBytes,
    mimeType: typeof result.mimeType === "string" ? result.mimeType : mimeType,
    columnCount: Array.isArray(result.profile?.columns) ? result.profile.columns.length : null,
  };
}
