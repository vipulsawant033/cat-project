import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { runLibMapFigmaToComponent } from '../../core/lib-map-figma-to-component.js';
import { LibMapFigmaToComponentInput } from '../../types.js';

export const TOOL_NAME = 'lib_map_figma_to_component';

export function registerLibMapFigmaToComponentTool(server: McpServer): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: 'Map Figma Component to Angular Component',
      description:
        'Persists (or updates) a mapping from a Figma component/component-set to the Angular wrapper selector ' +
        'that should be generated in its place, plus a property mapping from Figma variant/prop names to ' +
        'Angular @Input names. This is the local equivalent of Figma Code Connect, and is what lets codegen ' +
        'emit real components instead of plain divs.',
      inputSchema: LibMapFigmaToComponentInput.shape,
    },
    async (input) => {
      const parsed = LibMapFigmaToComponentInput.parse(input);
      const output = await runLibMapFigmaToComponent(parsed);
      return {
        content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
        structuredContent: output as unknown as Record<string, unknown>,
      };
    }
  );
}
