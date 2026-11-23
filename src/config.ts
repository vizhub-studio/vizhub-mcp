import { delimiter, resolve } from "node:path";

export interface BridgeConfig {
  apiToken: string;
  projectId: string;
  baseUrl: URL;
  mcpUrl: URL;
  uploadRoots: string[];
}

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export function validProjectId(id: string): boolean {
  return ID_PATTERN.test(id);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): BridgeConfig {
  const apiToken = env.VIZHUB_API_TOKEN?.trim();
  if (!apiToken) throw new Error("VIZHUB_API_TOKEN is required.");
  const projectId = env.VIZHUB_PROJECT_ID?.trim();
  if (!projectId || !validProjectId(projectId)) {
    throw new Error("VIZHUB_PROJECT_ID must be a valid project ID.");
  }
  const baseUrl = new URL(env.VIZHUB_BASE_URL || "https://vizhub.com");
  if (baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash ||
      baseUrl.pathname !== "/" || (baseUrl.protocol !== "https:" &&
      !(baseUrl.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(baseUrl.hostname)))) {
    throw new Error("VIZHUB_BASE_URL must be an HTTPS origin (HTTP is only allowed for localhost).");
  }
  const rawRoots = env.VIZHUB_UPLOAD_ROOTS
    ? env.VIZHUB_UPLOAD_ROOTS.split(delimiter).filter(Boolean)
    : [cwd];
  if (rawRoots.length === 0) throw new Error("At least one upload root is required.");
  return {
    apiToken,
    projectId,
    baseUrl,
    mcpUrl: new URL("/api/mcp", baseUrl),
    uploadRoots: rawRoots.map((root) => resolve(cwd, root)),
  };
}
