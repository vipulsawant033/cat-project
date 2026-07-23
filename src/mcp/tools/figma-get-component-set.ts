import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { runFigmaGetComponentSet } from '../../core/figma-get-component-set.js';
import { FigmaGetComponentSetInput } from '../../types.js';

export const TOOL_NAME = 'figma_get_component_set';

export function registerFigmaGetComponentSetTool(server: McpServer): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: 'Get Figma Component Set Variants',
      description:
        'Fetches a Figma COMPONENT_SET\'s variant property definitions (e.g. Style: Primary/Secondary, ' +
        'Size: Small/Large) and every concrete variant\'s property values. Use this to build the Figma ' +
        'variant -> Angular wrapper @Input mapping in the library-mapping tools.',
      inputSchema: FigmaGetComponentSetInput.shape,
    },
    async (input) => {
      const parsed = FigmaGetComponentSetInput.parse(input);
      const output = await runFigmaGetComponentSet(parsed);
      return {
        content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
        structuredContent: output as unknown as Record<string, unknown>,
      };
    }
  );
}
