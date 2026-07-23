import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { runLibIndexComponents } from '../../core/lib-index-components.js';
import { LibIndexComponentsInput } from '../../types.js';

export const TOOL_NAME = 'lib_index_components';

export function registerLibIndexComponentsTool(server: McpServer): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: 'Index Angular Component Library',
      description:
        'Scans an Angular workspace/library directory for @Component classes and persists their selector, ' +
        'class name, and @Input/@Output API as a searchable index (used by lib_search_component and ' +
        'lib_get_component). Re-run this after the library changes to refresh the index.',
      inputSchema: LibIndexComponentsInput.shape,
    },
    async (input) => {
      const parsed = LibIndexComponentsInput.parse(input);
      const output = await runLibIndexComponents(parsed);
      return {
        content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
        structuredContent: output as unknown as Record<string, unknown>,
      };
    }
  );
}
