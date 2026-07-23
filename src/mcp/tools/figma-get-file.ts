import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { runFigmaGetFile } from '../../core/figma-get-file.js';
import { FigmaGetFileInput } from '../../types.js';

export const TOOL_NAME = 'figma_get_file';

export function registerFigmaGetFileTool(server: McpServer): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: 'Get Figma File Tree',
      description:
        'Fetches a Figma file\'s document tree as a depth-limited summary (id/name/type/childCount per node), ' +
        'plus component and component-set counts. Use this to explore a file\'s structure and find node ids ' +
        'before calling figma_get_node or generate_angular_component on a specific frame/component.',
      inputSchema: FigmaGetFileInput.shape,
    },
    async (input) => {
      const parsed = FigmaGetFileInput.parse(input);
      const output = await runFigmaGetFile(parsed);
      return {
        content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
        structuredContent: output as unknown as Record<string, unknown>,
      };
    }
  );
}
