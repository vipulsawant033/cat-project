import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerGenerateAngularComponentTool } from './tools/generate-angular-component.js';
import { registerGenerateAngularPageTool } from './tools/generate-angular-page.js';
import { registerFigmaGetFileTool } from './tools/figma-get-file.js';
import { registerFigmaGetNodeTool } from './tools/figma-get-node.js';
import { registerFigmaExtractTokensTool } from './tools/figma-extract-tokens.js';
import { registerFigmaGetComponentSetTool } from './tools/figma-get-component-set.js';
import { registerFigmaExportNodeImageTool } from './tools/figma-export-node-image.js';
import { registerLibIndexComponentsTool } from './tools/lib-index-components.js';
import { registerLibSearchComponentTool } from './tools/lib-search-component.js';
import { registerLibGetComponentTool } from './tools/lib-get-component.js';
import { registerLibMapFigmaToComponentTool } from './tools/lib-map-figma-to-component.js';
import { registerLibListMappingsTool } from './tools/lib-list-mappings.js';
import { registerCodegenDiffTool } from './tools/codegen-diff.js';
import { registerCodegenValidateTool } from './tools/codegen-validate.js';
import { registerCodegenDetectDriftTool } from './tools/codegen-detect-drift.js';
import { registerManifestListTool } from './tools/manifest-list.js';
import { registerCodegenAutoRegenerateTool } from './tools/codegen-auto-regenerate.js';

/**
 * Creates the MCP server instance and registers all tools.
 *
 * Any MCP-native client (Claude Code, Claude Desktop, Cursor, Windsurf, etc.)
 * can connect to this server over stdio (see src/index.ts) or, if you wire up
 * StreamableHTTPServerTransport instead, over HTTP. Non-MCP AI tools should
 * use the REST bridge in src/bridge instead (see README.md).
 */
export function createServer(): McpServer {
  const server = new McpServer({
    name: 'figma-angular-mcp-vipul',
    version: '0.1.0',
  });

  registerGenerateAngularComponentTool(server);
  registerGenerateAngularPageTool(server);
  registerFigmaGetFileTool(server);
  registerFigmaGetNodeTool(server);
  registerFigmaExtractTokensTool(server);
  registerFigmaGetComponentSetTool(server);
  registerFigmaExportNodeImageTool(server);
  registerLibIndexComponentsTool(server);
  registerLibSearchComponentTool(server);
  registerLibGetComponentTool(server);
  registerLibMapFigmaToComponentTool(server);
  registerLibListMappingsTool(server);
  registerCodegenDiffTool(server);
  registerCodegenValidateTool(server);
  registerCodegenDetectDriftTool(server);
  registerManifestListTool(server);
  registerCodegenAutoRegenerateTool(server);
  // Register additional tools here, e.g.:
  // registerSyncTokensTool(server);

  return server;
}
