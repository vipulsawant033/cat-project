import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { runLibSearchComponent } from '../../core/lib-search-component.js';
import { LibSearchComponentInput } from '../../types.js';

export const TOOL_NAME = 'lib_search_component';

export function registerLibSearchComponentTool(server: McpServer): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: 'Search Angular Component Library',
      description:
        'Searches the component index built by lib_index_components by selector/class-name substring. ' +
        'Use this to find the right Angular wrapper component before creating a lib_map_figma_to_component mapping.',
      inputSchema: LibSearchComponentInput.shape,
    },
    async (input) => {
      const parsed = LibSearchComponentInput.parse(input);
      const output = await runLibSearchComponent(parsed);
      return {
        content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
        structuredContent: output as unknown as Record<string, unknown>,
      };
    }
  );
}
