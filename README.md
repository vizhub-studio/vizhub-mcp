# VizHub MCP — earlier timeline-event server prototype

This private repository contains a single Node.js [MCP](https://modelcontextprotocol.io/) server prototype, [`vizhub-mcp-server.mjs`](vizhub-mcp-server.mjs), designed to create project timeline events against an earlier VizHub Studio API.

**Status:** Historical integration code. Do not assume it implements the current authenticated/public MCP interface at [vizhub.com](https://vizhub.com/), or that its endpoint paths, authentication contract, or tool schemas are supported today.

## What the source actually does

- Creates an MCP server using `@modelcontextprotocol/sdk` and a **stdio transport**.
- Loads `VIZHUB_PROJECT_ID` from the process environment and uses `VIZHUB_BASE_URL` (with a historical Studio URL fallback).
- Registers tools that submit **HTTP POST requests** to project timeline-event endpoints. These actions can change remote state; they are not read-only discovery tools.
- Uses `dotenv` and `zod` imports.

## Setup limitations and safety

This checkout does **not** contain a root `package.json`, lockfile, or `.env.example`. Its original source comments mention an example env file and install instructions that are not supplied here. **Do not treat this repository as an installable turnkey MCP server** without restoring and verifying dependency versions and execution configuration.

The source currently prints project details, request paths and complete request payloads using `console.log`. For stdio MCP, stdout is protocol-sensitive, and logging payloads can leak sensitive information. Review and fix stdout/logging behavior before connecting it to an MCP host. Avoid using real API keys, nonpublic project data, or production endpoints when investigating the prototype.

The correct startup path for this file, once dependencies and environment are supplied and independently reviewed, would refer to `vizhub-mcp-server.mjs` at the repository root—not the different filename shown in older source comments. This README intentionally does not claim that such a setup has been tested.

## Relationship to VizHub

This code represents an older **timeline-event automation experiment**, not a verified production integration or a current deployment guide. Changes to VizHub MCP discovery, authentication, tool descriptions, and transport contracts should be documented in their actively maintained implementation.
