import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { runLibListMappings } from '../../core/lib-list-mappings.js';
import { LibListMappingsInput } from '../../types.js';

export const TOOL_NAME = 'lib_list_mappings';

export function registerLibListMappingsTool(server: McpServer): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: 'List Figma-to-Angular Component Mappings',
      description: 'Returns every persisted Figma component -> Angular selector mapping created via lib_map_figma_to_component.',
      inputSchema: LibListMappingsInput.shape,
    },
    async (input) => {
      const parsed = LibListMappingsInput.parse(input);
      const output = await runLibListMappings(parsed);
      return {
        content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
        structuredContent: output as unknown as Record<string, unknown>,
      };
    }
  );
}
