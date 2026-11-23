import { Server } from "@modelcontextprotocol/server";
import type { Client } from "@modelcontextprotocol/client";
import { uploadProjectDatasetFromFile, UploadError, type UploadReceipt } from "./upload.js";
import type { BridgeConfig } from "./config.js";
import { downloadProjectDatasetToFile, DownloadError, type DownloadReceipt } from "./download.js";

export const LOCAL_UPLOAD_TOOL = "upload_project_dataset_from_file";
export const LOCAL_DOWNLOAD_TOOL = "download_project_dataset_to_file";

export const LOCAL_UPLOAD_DEFINITION = {
  name: LOCAL_UPLOAD_TOOL,
  title: "Upload a local file to a VizHub project",
  description: "Read a CSV, TSV, JSON, GeoJSON, Parquet or reference file from the LOCAL filesystem and upload the original bytes directly to VizHub. Use this instead of passing the entire dataset as text to upload_project_dataset. Returns only dataset metadata.",
  inputSchema: {
    type: "object" as const,
    properties: {
      file_path: { type: "string", description: "Local file path (must be in an allowed upload directory)" },
      project_id: { type: "string", description: "Optional project ID; defaults to VIZHUB_PROJECT_ID" },
    },
    required: ["file_path"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
};

export const LOCAL_DOWNLOAD_DEFINITION = {
  name: LOCAL_DOWNLOAD_TOOL,
  title: "Download a project dataset directly to a local file",
  description: "Save original VizHub project dataset bytes to the LOCAL filesystem, without putting file content in the model context. The output directory must exist within allowed file roots. Existing destinations are never overwritten.",
  inputSchema: {
    type: "object" as const,
    properties: {
      dataset_id: { type: "string", description: "Dataset ID from list_project_datasets" },
      output_path: { type: "string", description: "Local output path inside allowed file roots" },
      project_id: { type: "string", description: "Optional project ID; defaults to VIZHUB_PROJECT_ID" },
    },
    required: ["dataset_id", "output_path"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
};

type Remote = Pick<Client, "listTools" | "callTool" | "listResources" | "listResourceTemplates" |
  "readResource" | "listPrompts" | "getPrompt">;
export type UploadFunction = (filePath: string, projectId?: string) => Promise<UploadReceipt>;
export type DownloadFunction = (datasetId: string, outputPath: string, projectId?: string) => Promise<DownloadReceipt>;

function toolError(message: string) {
  return { isError: true, content: [{ type: "text" as const, text: message }] };
}

export function createBridgeServer(remote: Remote, upload: UploadFunction, download: DownloadFunction): Server {
  const server = new Server(
    { name: "vizhub-local-bridge", version: "0.1.0" },
    { capabilities: { tools: {}, resources: {}, prompts: {} } },
  );

  server.setRequestHandler("tools/list", async (request) => {
    const listed = await remote.listTools(request.params?.cursor
      ? { cursor: request.params.cursor } : undefined);
    if (request.params?.cursor) return listed;
    if (listed.tools.some((tool) => tool.name === LOCAL_UPLOAD_TOOL || tool.name === LOCAL_DOWNLOAD_TOOL)) {
      throw new Error("Hosted VizHub tool name conflicts with the local upload tool.");
    }
    return { ...listed, tools: [LOCAL_UPLOAD_DEFINITION, LOCAL_DOWNLOAD_DEFINITION, ...listed.tools] };
  });

  server.setRequestHandler("tools/call", async (request) => {
    if (request.params.name === LOCAL_DOWNLOAD_TOOL) {
      const args = request.params.arguments ?? {};
      if (typeof args.dataset_id !== "string" || !args.dataset_id.trim() ||
          typeof args.output_path !== "string" || !args.output_path.trim()) {
        return toolError("dataset_id and output_path must be nonempty strings.");
      }
      if (args.project_id !== undefined && typeof args.project_id !== "string") {
        return toolError("project_id must be a string.");
      }
      try {
        const receipt = await download(
          args.dataset_id, args.output_path, args.project_id as string | undefined,
        );
        return {
          content: [{ type: "text" as const, text: JSON.stringify(receipt) }],
          structuredContent: { ...receipt },
        };
      } catch (error) {
        return toolError(error instanceof DownloadError ? error.message : "Local dataset download failed.");
      }
    }
    if (request.params.name !== LOCAL_UPLOAD_TOOL) return remote.callTool(request.params);
    const args = request.params.arguments ?? {};
    if (typeof args.file_path !== "string" || !args.file_path.trim()) {
      return toolError("file_path must be a nonempty local path.");
    }
    if (args.project_id !== undefined && typeof args.project_id !== "string") {
      return toolError("project_id must be a string.");
    }
    try {
      const receipt = await upload(args.file_path, args.project_id as string | undefined);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(receipt) }],
        structuredContent: { ...receipt },
      };
    } catch (error) {
      return toolError(error instanceof UploadError ? error.message : "Local dataset upload failed.");
    }
  });

  // MCP Apps and other remote tools may return ui:// resources. Proxy those
  // resource and prompt methods rather than limiting the bridge to plain text.
  server.setRequestHandler("resources/list", (request) =>
    remote.listResources(request.params?.cursor ? { cursor: request.params.cursor } : undefined));
  server.setRequestHandler("resources/templates/list", (request) =>
    remote.listResourceTemplates(request.params?.cursor ? { cursor: request.params.cursor } : undefined));
  server.setRequestHandler("resources/read", (request) => remote.readResource(request.params));
  server.setRequestHandler("prompts/list", (request) =>
    remote.listPrompts(request.params?.cursor ? { cursor: request.params.cursor } : undefined));
  server.setRequestHandler("prompts/get", (request) => remote.getPrompt(request.params));
  return server;
}

export function createUploader(config: BridgeConfig): UploadFunction {
  return (filePath, projectId) => uploadProjectDatasetFromFile(config, filePath, projectId);
}

export function createDownloader(config: BridgeConfig): DownloadFunction {
  return (datasetId, outputPath, projectId) =>
    downloadProjectDatasetToFile(config, datasetId, outputPath, projectId);
}
