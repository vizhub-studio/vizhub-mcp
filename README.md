# VizHub local MCP server

Run VizHub's **current hosted MCP tools** from Claude Code (or any stdio MCP client), with one extra local tool that uploads a file **without putting the file content into the model's tool arguments**.

The bridge connects over authenticated HTTPS to `https://vizhub.com/api/mcp`. It forwards the remote `tools/list`, `tools/call`, resources and prompts rather than freezing a copy of the hosted tool catalog. The additional `upload_project_dataset_from_file` tool reads from the local filesystem and uploads directly to the existing VizHub REST API.

## Requirements

- Node.js 22 or later
- A VizHub API token with appropriate read/write scopes
- A project ID and permission to edit that project
- Network access to `https://vizhub.com`

## Install in Claude Code

Once this package is published on npm:

```bash
claude mcp add --scope project vizhub-local -- \
  npx -y @vizhub/mcp-server
```

Set these environment variables in the MCP client's environment (the example below uses the Claude Code JSON configuration format):

```json
{
  "mcpServers": {
    "vizhub-local": {
      "command": "npx",
      "args": ["-y", "@vizhub/mcp-server"],
      "env": {
        "VIZHUB_API_TOKEN": "vzt_your_key",
        "VIZHUB_PROJECT_ID": "your-project-id",
        "VIZHUB_UPLOAD_ROOTS": "/absolute/path/to/your/project"
      }
    }
  }
}
```

The exact configuration file or command-line flags depend on your host. Keep the API token in a local secret store or client environment, never in a committed JSON config file. For development before publication, use `npm install`, `npm run build`, and configure `node /absolute/path/to/vizhub-mcp/dist/index.js` as the command.

`VIZHUB_BASE_URL` defaults to `https://vizhub.com`. For local development, `http://localhost:5173` is allowed. The default upload root is the MCP process's current working directory. Override with `VIZHUB_UPLOAD_ROOTS` (path-delimiter-separated on your OS) when the process starts elsewhere.

## Example: local CSV upload

Ask Claude Code:

> Upload ./data/sales.csv to my VizHub project, then inspect the dataset's columns and first 10 rows.

The local MCP tool receives only:

```json
{"file_path":"./data/sales.csv"}
```

The bridge reads the original bytes, makes an authenticated `multipart/form-data` POST to `/api/v1/projects/:projectId/datasets`, and returns an ID, name, byte size, MIME type and optional column count. Follow with the hosted `get_project_dataset_preview`, `profile_project_dataset` or `query_project_dataset` tool, passing the returned dataset ID. The CSV contents do not pass through the LLM, MCP tool arguments or tool responses.

### File support and limits

- CSV, TSV, JSON, GeoJSON, Parquet, Markdown and text are accepted under VizHub's existing upload validator. Parquet is transferred as binary without conversion.
- Per-file limit: **10 MiB**. This package does not provide chunked or resumable uploads.
- A file must resolve inside an allowed root, including after symlink resolution. Symlink escapes and traversal outside the root are refused.
- The configured API key and project authorization are enforced by VizHub. Providing another `project_id` does not bypass server permissions.
- Do not point upload roots at a whole home directory if you only intend to share one project.
- Upload operations are writes and should be user-approved. A local bridge has filesystem privileges that the hosted MCP server does not.

## Current hosted tools

Tools are not duplicated in this repository. `tools/list` forwards each upstream page with its JSON input schema, annotations and other metadata. All other `tools/call` requests are forwarded without argument rewriting, including structured output and image responses. Resource and prompt list/read calls are forwarded as well. A valid API token and reachable hosted service are required at startup.

The existing remote text-content tool `upload_project_dataset` is still available for compatibility. For local files, prefer `upload_project_dataset_from_file` to avoid including the full content in an LLM call.

The hosted MCP can evolve independently of the npm package. The exact tools available depend on credentials, feature flags and deployment. Some advanced host-specific interactions may require direct connection to the hosted MCP endpoint.

## Development

```bash
npm install
npm test
npm run check:pack
```

Tests cover forwarded tool discovery and calls, local upload metadata, binary integrity, invalid inputs, size checks and directory traversal. CI runs Node 22 and 24. The package stays private/unpublished until reviewed and released; `publishConfig.access=public` is npm metadata, not a GitHub visibility change or a publish action.

The original January 2026 timeline-event prototype remains available in Git history; it is superseded by the current API-key-authenticated hosted MCP gateway.

MIT licensed.
