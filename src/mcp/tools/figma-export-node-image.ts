import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { runFigmaExportNodeImage } from '../../core/figma-export-node-image.js';
import { FigmaExportNodeImageInput } from '../../types.js';

export const TOOL_NAME = 'figma_export_node_image';

export function registerFigmaExportNodeImageTool(server: McpServer): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: 'Export Figma Node as PNG',
      description:
        'Renders a Figma node to PNG, either as a temporary signed Figma URL or inlined as base64. Use this ' +
        'to get the ground-truth reference image for pixel-diff validation, or to fetch raster image-fill assets.',
      inputSchema: FigmaExportNodeImageInput.shape,
    },
    async (input) => {
      const parsed = FigmaExportNodeImageInput.parse(input);
      const output = await runFigmaExportNodeImage(parsed);
      return {
        content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
        structuredContent: output as unknown as Record<string, unknown>,
      };
    }
  );
}
