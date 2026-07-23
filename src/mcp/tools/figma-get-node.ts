import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { runFigmaGetNode } from '../../core/figma-get-node.js';
import { FigmaGetNodeInput } from '../../types.js';

export const TOOL_NAME = 'figma_get_node';

export function registerFigmaGetNodeTool(server: McpServer): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: 'Get Figma Node',
      description:
        'Fetches the full raw Figma node (layout, fills, strokes, text style, variant properties, etc.) that ' +
        'a share link\'s node-id points to. Use this to inspect a node\'s exact properties before generating ' +
        'or when diagnosing a codegen fidelity gap.',
      inputSchema: FigmaGetNodeInput.shape,
    },
    async (input) => {
      const parsed = FigmaGetNodeInput.parse(input);
      const output = await runFigmaGetNode(parsed);
      return {
        content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
        structuredContent: output as unknown as Record<string, unknown>,
      };
    }
  );
}
