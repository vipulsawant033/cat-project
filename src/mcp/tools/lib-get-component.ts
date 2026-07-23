import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { runLibGetComponent } from '../../core/lib-get-component.js';
import { LibGetComponentInput } from '../../types.js';

export const TOOL_NAME = 'lib_get_component';

export function registerLibGetComponentTool(server: McpServer): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: 'Get Angular Component Details',
      description:
        'Looks up one component\'s full API (selector, class name, inputs, outputs, source file) by exact ' +
        'selector or class name from the index built by lib_index_components.',
      inputSchema: LibGetComponentInput.shape,
    },
    async (input) => {
      const parsed = LibGetComponentInput.parse(input);
      const output = await runLibGetComponent(parsed);
      return {
        content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
        structuredContent: output as unknown as Record<string, unknown>,
      };
    }
  );
}
