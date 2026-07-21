import 'dotenv/config';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './mcp/server.js';
import { shutdownPreview } from './preview/manager.js';

/**
 * MCP entrypoint. Any MCP-native AI tool starts this process and talks to it
 * over stdio using the MCP JSON-RPC protocol — no networking involved.
 *
 * Example client config (Claude Desktop / Claude Code style):
 * {
 *   "mcpServers": {
 *     "figma-angular": {
 *       "command": "node",
 *       "args": ["dist/index.js"],
 *       "env": { "FIGMA_TOKEN": "figd_..." }
 *     }
 *   }
 * }
 *
 * For AI tools that can't speak MCP directly, run the REST bridge instead:
 *   npm run bridge
 * (see src/bridge/rest-server.ts and README.md)
 */
async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Don't leave an orphaned `ng serve` preview process running after this server exits.
process.on('SIGINT', () => { shutdownPreview(); process.exit(0); });
process.on('SIGTERM', () => { shutdownPreview(); process.exit(0); });
process.on('exit', shutdownPreview);

main().catch((err) => {
  console.error('[figma-angular-mcp-vipul] fatal error:', err);
  process.exit(1);
});
