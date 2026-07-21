import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerGenerateAngularComponentTool } from './tools/generate-angular-component.js';

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
  // Register additional tools here, e.g.:
  // registerSyncTokensTool(server);

  return server;
}
