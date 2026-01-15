// vizhub-mcp-server.mjs
// Timeline Event Emitter for VizHub Studio
//
// This MCP server exposes a set of tools that create Project Timeline Events.
// Each tool:
//   - Creates exactly one timeline event via REST API
//   - Makes authenticated calls to studio.vizhub.com
//   - Logs calls to console for visibility
//   - Returns human-readable toast notifications with event links
//
// Setup:
//   1. Copy .env.example to .env and fill in VIZHUB_PROJECT_ID
//   2. npm install
//
// Run with:
//   node vizhub-mcp/server.mjs

import { config } from "dotenv";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { randomUUID } from "crypto";
import * as z from "zod";

// Load environment variables from .env file
config();

// Load environment variables
const projectId = process.env.VIZHUB_PROJECT_ID;
const baseUrl = process.env.VIZHUB_BASE_URL || "https://studio.vizhub.com";

// Validate required environment variables
if (!projectId) {
  console.error(
    "ERROR: VIZHUB_PROJECT_ID environment variable is required. Please set it in your .env file.",
  );
  process.exit(1);
}

console.log(`[VizHub MCP Server] Project ID: ${projectId}`);
console.log(`[VizHub MCP Server] Base URL: ${baseUrl}`);

// Create MCP server
const mcpServer = new McpServer({
  name: "vizhub_server",
  version: "1.0.0",
});

/**
 * Helper: Make a request to the VizHub Timeline Events API
 * @param {string} endpoint - The endpoint path (e.g., 'add-viz-from-template')
 * @param {object} payload - The request payload
 * @returns {Promise<{success: boolean, data?: object, error?: object}>}
 */
async function callVizhubApi(endpoint, payload) {
  const url = `${baseUrl}/api/timeline-events/${endpoint}`;
  const fullPayload = {
    projectId,
    ...payload,
  };

  console.log(`[API Call] POST ${url}`);
  console.log(`[API Payload]`, JSON.stringify(fullPayload, null, 2));

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(fullPayload),
    });

    const result = await response.json();

    if (result.success) {
      console.log(`[API Success] Event ID: ${result.data.eventId}`);
      return result;
    } else {
      console.error(
        `[API Error] ${result.error.code}: ${result.error.message}`,
      );
      return result;
    }
  } catch (error) {
    console.error(
      `[Network Error] Failed to reach ${baseUrl}: ${error.message}`,
    );
    return {
      success: false,
      error: {
        code: "NETWORK_ERROR",
        message: `Failed to reach VizHub backend at ${baseUrl}: ${error.message}`,
      },
    };
  }
}

/**
 * Helper: Generate event link
 * @param {string} eventId - The event ID returned from the API (not currently used since events are displayed in project timeline)
 * @returns {string} - The full URL to view the project and its timeline
 */
function getEventLink(eventId) {
  return `${baseUrl}/projects/${projectId}`;
}

// ============================================================================
// CREATION TOOLS
// Create new visualizations or branches
// ============================================================================

/**
 * Create a visualization from a template
 * Event: VIZ_ADDED_FROM_TEMPLATE
 */
mcpServer.registerTool(
  "add_viz_from_template",
  {
    description:
      "Create a new visualization in the project using a known template. This encodes best practices and creates a new timeline event.",
    inputSchema: z.object({
      template: z
        .enum(["scatter-plot", "line-chart", "choropleth", "bar-chart"])
        .describe("Template type to use for new viz"),
      viz_name: z
        .string()
        .optional()
        .describe(
          "Optional human-readable name for the viz (auto-generated if omitted)",
        ),
      target_path: z
        .string()
        .optional()
        .default("visualizations/")
        .describe("Path within project where viz will be created"),
    }),
  },
  async ({ template, viz_name, target_path }) => {
    const displayName = viz_name || `${template}-visualization`;

    const result = await callVizhubApi("add-viz-from-template", {
      template,
      vizName: displayName,
      templateTargetPath: target_path,
      content: `Created visualization '${displayName}' from ${template} template`,
    });

    if (result.success) {
      const vizId = result.data.vizId;
      const vizLink = `${baseUrl}/projects/${projectId}/${vizId}`;
      return {
        content: [
          {
            type: "text",
            text: `✅ Visualization "${displayName}" created from ${template} template`,
          },
          {
            type: "text",
            text: `🔗 ${vizLink}`,
          },
        ],
      };
    } else {
      return {
        content: [
          {
            type: "text",
            text: `❌ Error: ${result.error.message}`,
          },
        ],
      };
    }
  },
);

/**
 * Fork an existing visualization within the project
 * Event: VIZ_FORKED
 */
mcpServer.registerTool(
  "fork_viz",
  {
    description:
      "Create a copy of an existing visualization for safe exploration. The server generates a new viz ID and creates a timeline event linking source to fork.",
    inputSchema: z.object({
      source_viz_id: z.string().describe("ID of the visualization to fork"),
      new_name: z
        .string()
        .optional()
        .describe("Optional name for the forked visualization"),
      new_description: z
        .string()
        .optional()
        .describe("Optional description for the forked visualization"),
      user_id: z
        .string()
        .optional()
        .describe("Optional user ID for the fork owner"),
    }),
  },
  async ({ source_viz_id, new_name, new_description, user_id }) => {
    const displayName = new_name || `fork-of-${source_viz_id}`;
    const newVizId = randomUUID().replace(/-/g, "");

    const result = await callVizhubApi("fork-viz", {
      sourceVizId: source_viz_id,
      newVizId: newVizId,
      newTitle: displayName,
      newDescription: new_description,
      userId: user_id,
      content: `Forked visualization '${displayName}' from ${source_viz_id}`,
    });

    if (result.success) {
      const forkedVizId = result.data.forkedVizId || newVizId;
      const forkedVizLink = `${baseUrl}/projects/${projectId}/${forkedVizId}`;
      return {
        content: [
          {
            type: "text",
            text: `✅ Visualization forked successfully`,
          },
          {
            type: "text",
            text: `🔗 ${forkedVizLink}`,
          },
        ],
      };
    } else {
      return {
        content: [
          {
            type: "text",
            text: `❌ Error: ${result.error.message}`,
          },
        ],
      };
    }
  },
);

// ============================================================================
// INGESTION TOOLS
// Bring external assets into the project
// ============================================================================

/**
 * Copy a file into a visualization
 * Reads the file locally and sends content to the API
 */
mcpServer.registerTool(
  "copy_file_into_viz",
  {
    description:
      "Copy a local file into a visualization. Reads file from local filesystem and uploads content to viz.",
    inputSchema: z.object({
      source_path: z.string().describe("Path to local file to copy"),
      viz_id: z.string().describe("Target visualization ID"),
      target_path: z
        .string()
        .optional()
        .default("data/")
        .describe("Path within the viz where file will be placed"),
      message: z
        .string()
        .optional()
        .describe("Optional message describing the upload"),
    }),
  },
  async ({ source_path, viz_id, target_path, message }) => {
    // Import fs at runtime for file reading
    const fs = await import("fs");
    const path = await import("path");

    try {
      // Check if file exists
      const fullSourcePath = path.resolve(source_path);
      if (!fs.existsSync(fullSourcePath)) {
        return {
          content: [
            {
              type: "text",
              text: `❌ File not found: ${fullSourcePath}`,
            },
          ],
        };
      }

      // Read file content
      const fileContent = fs.readFileSync(fullSourcePath, "utf-8");
      const fileName = path.basename(source_path);
      const fullTargetPath = `${target_path}${fileName}`;

      // Determine MIME type based on file extension
      const ext = path.extname(fileName).toLowerCase();
      let mimeType = "text/plain";
      if (ext === ".csv") mimeType = "text/csv";
      else if (ext === ".json") mimeType = "application/json";
      else if (ext === ".txt") mimeType = "text/plain";

      const defaultMessage = `Uploaded ${fileName} into visualization`;

      // Call API with file content
      const result = await callVizhubApi("copy-file-into-viz", {
        targetVizId: viz_id,
        targetFilePath: fullTargetPath,
        file: {
          content: fileContent,
          encoding: "utf-8",
          mimeType,
        },
        message: message || defaultMessage,
      });

      if (result.success) {
        const eventLink = getEventLink(result.data.eventId);
        return {
          content: [
            {
              type: "text",
              text: `✅ File uploaded: ${fileName} → ${fullTargetPath}`,
            },
            {
              type: "text",
              text: `Size: ${fileContent.length} bytes`,
            },
            {
              type: "text",
              text: `🔗 ${eventLink}`,
            },
          ],
        };
      } else {
        return {
          content: [
            {
              type: "text",
              text: `❌ Error: ${result.error.message}`,
            },
          ],
        };
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      return {
        content: [
          {
            type: "text",
            text: `❌ Failed to read file: ${msg}`,
          },
        ],
      };
    }
  },
);

/**
 * List files in a visualization
 * Returns file information (name, size) for all files in a viz
 */
mcpServer.registerTool(
  "list_files_in_viz",
  {
    description:
      "List all files in a visualization. Returns file names and sizes.",
    inputSchema: z.object({
      viz_id: z.string().describe("ID of the visualization to list files from"),
      path_filter: z
        .string()
        .optional()
        .describe("Optional: filter to specific directory (e.g., 'data/')"),
    }),
  },
  async ({ viz_id, path_filter }) => {
    const url = `${baseUrl}/api/timeline-events/list-files-in-viz?vizId=${viz_id}`;

    console.log(`[API Call] GET ${url}`);

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      const result = await response.json();

      if (result.success) {
        console.log(`[API Success] Found ${result.data.length} files`);
        const files = result.data;

        // Filter by path if specified
        let filtered = files;
        if (path_filter) {
          filtered = files.filter((f) => f.name.startsWith(path_filter));
        }

        if (filtered.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `📁 No files found in ${viz_id}${path_filter ? ` (filtered by ${path_filter})` : ""}`,
              },
            ],
          };
        }

        const fileList = filtered
          .map((f) => `  • ${f.name}${f.size ? ` (${f.size} bytes)` : ""}`)
          .join("\n");

        return {
          content: [
            {
              type: "text",
              text: `📁 Files in ${viz_id}:\n${fileList}`,
            },
          ],
        };
      } else {
        console.error(
          `[API Error] ${result.error.code}: ${result.error.message}`,
        );
        return {
          content: [
            {
              type: "text",
              text: `❌ Error: ${result.error.message}`,
            },
          ],
        };
      }
    } catch (error) {
      console.error(
        `[Network Error] Failed to reach ${baseUrl}: ${error.message}`,
      );
      return {
        content: [
          {
            type: "text",
            text: `❌ Network Error: ${error.message}`,
          },
        ],
      };
    }
  },
);

/**
 * Download a file from a visualization
 * Returns file content for writing to local filesystem
 */
mcpServer.registerTool(
  "download_file_from_viz",
  {
    description:
      "Download a file from a visualization. Returns file content that can be written to the local filesystem.",
    inputSchema: z.object({
      viz_id: z.string().describe("ID of the visualization"),
      file_name: z
        .string()
        .describe("Name of the file to download (e.g., 'data.csv')"),
      target_path: z
        .string()
        .optional()
        .describe(
          "Optional: where to save locally (default: current directory)",
        ),
    }),
  },
  async ({ viz_id, file_name, target_path }) => {
    const url = `${baseUrl}/api/timeline-events/download-file-from-viz`;
    const payload = { projectId, vizId: viz_id, fileName: file_name };

    console.log(`[API Call] POST ${url}`);
    console.log(`[API Payload]`, JSON.stringify(payload, null, 2));

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const result = await response.json();

      if (result.success) {
        console.log(`[API Success] Downloaded file: ${result.data.fileName}`);

        // Write file to filesystem
        const fs = await import("fs");
        const path = await import("path");
        const fileName = result.data.fileName;
        const content = result.data.content;

        const outputDir = target_path || ".";
        const outputPath = path.join(outputDir, fileName);

        try {
          // Ensure directory exists
          if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
          }

          fs.writeFileSync(outputPath, content, "utf-8");

          return {
            content: [
              {
                type: "text",
                text: `✅ File downloaded and saved to: ${outputPath}`,
              },
            ],
          };
        } catch (writeError) {
          const msg =
            writeError instanceof Error ? writeError.message : "Unknown error";
          console.error(`[Write Error] Failed to write file: ${msg}`);
          return {
            content: [
              {
                type: "text",
                text: `❌ Failed to write file: ${msg}`,
              },
            ],
          };
        }
      } else {
        console.error(
          `[API Error] ${result.error.code}: ${result.error.message}`,
        );
        return {
          content: [
            {
              type: "text",
              text: `❌ Error: ${result.error.message}`,
            },
          ],
        };
      }
    } catch (error) {
      console.error(
        `[Network Error] Failed to reach ${baseUrl}: ${error.message}`,
      );
      return {
        content: [
          {
            type: "text",
            text: `❌ Network Error: ${error.message}`,
          },
        ],
      };
    }
  },
);

// ============================================================================
// AI MODIFICATION TOOLS
// Request AI-powered changes to visualizations
// ============================================================================

/**
 * Request an AI edit to a visualization
 * Event: AI_EDIT_REQUESTED
 *
 * This creates a request event for AI processing.
 */
mcpServer.registerTool(
  "request_ai_edit",
  {
    description:
      "Request an AI-powered edit to an existing visualization. AI processes the request and emits child timeline events for each change.",
    inputSchema: z.object({
      viz_id: z.string().describe("ID of the visualization to edit"),
      instruction: z
        .string()
        .describe(
          "Natural language instruction for the AI (e.g., 'Make bars taller, use blue')",
        ),
      files: z
        .array(z.string())
        .optional()
        .describe("Optional: specific files to edit within the viz"),
    }),
  },
  async ({ viz_id, instruction, files }) => {
    const result = await callVizhubApi("request-ai-edit", {
      editVizId: viz_id,
      instruction,
      files,
      content: `AI edit request for visualization '${viz_id}': "${instruction}"`,
    });

    if (result.success) {
      const eventLink = getEventLink(result.data.eventId);
      return {
        content: [
          {
            type: "text",
            text: `✅ AI edit requested for ${viz_id}`,
          },
          {
            type: "text",
            text: `🔗 ${eventLink}`,
          },
        ],
      };
    } else {
      return {
        content: [
          {
            type: "text",
            text: `❌ Error: ${result.error.message}`,
          },
        ],
      };
    }
  },
);

// ============================================================================
// METADATA & NARRATIVE TOOLS
// Manage naming and project documentation
// ============================================================================

/**
 * Rename a visualization
 * Event: VIZ_RENAMED
 */
mcpServer.registerTool(
  "rename_viz",
  {
    description:
      "Rename an existing visualization. Emits a VIZ_RENAMED timeline event.",
    inputSchema: z.object({
      viz_id: z.string().describe("ID of the visualization to rename"),
      new_name: z.string().describe("New name for the visualization"),
    }),
  },
  async ({ viz_id, new_name }) => {
    const result = await callVizhubApi("rename-viz", {
      renamedVizId: viz_id,
      newVizName: new_name,
      content: `Renamed visualization to '${new_name}'`,
    });

    if (result.success) {
      const eventLink = getEventLink(result.data.eventId);
      return {
        content: [
          {
            type: "text",
            text: `✅ Visualization renamed to "${new_name}"`,
          },
          {
            type: "text",
            text: `🔗 ${eventLink}`,
          },
        ],
      };
    } else {
      return {
        content: [
          {
            type: "text",
            text: `❌ Error: ${result.error.message}`,
          },
        ],
      };
    }
  },
);

/**
 * Add a note to the project timeline
 * Event: PROJECT_NOTE_ADDED
 *
 * This turns the timeline into a narrative log, useful for:
 * - Decision tracking
 * - Teaching artifacts
 * - Client-visible commentary
 */
mcpServer.registerTool(
  "add_project_note",
  {
    description:
      "Add a note or decision log entry to the project timeline. Creates a PROJECT_NOTE_ADDED event. Useful for teaching, decisions, and client feedback.",
    inputSchema: z.object({
      message: z.string().describe("Note text to add to the timeline"),
      related_viz_id: z
        .string()
        .optional()
        .describe("Optional reference to a specific visualization"),
    }),
  },
  async ({ message, related_viz_id }) => {
    const result = await callVizhubApi("add-project-note", {
      content: message,
      relatedVizId: related_viz_id,
    });

    if (result.success) {
      const eventLink = getEventLink(result.data.eventId);
      return {
        content: [
          {
            type: "text",
            text: `✅ Note added to project timeline`,
          },
          {
            type: "text",
            text: `🔗 ${eventLink}`,
          },
        ],
      };
    } else {
      return {
        content: [
          {
            type: "text",
            text: `❌ Error: ${result.error.message}`,
          },
        ],
      };
    }
  },
);

// ============================================================================
// SERVER STARTUP
// ============================================================================

// Connect via stdio
const transport = new StdioServerTransport();
await mcpServer.connect(transport);
