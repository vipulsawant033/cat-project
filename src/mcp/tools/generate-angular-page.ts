import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { runGenerateAngularPage } from '../../core/generate-angular-page.js';
import { GenerateAngularPageInput } from '../../types.js';

export const TOOL_NAME = 'generate_angular_page';

export function registerGenerateAngularPageTool(server: McpServer): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: 'Generate Angular Page from Figma Screen',
      description:
        'Fetches a whole Figma screen/frame and generates a composing Angular "page" component plus one ' +
        'standalone Angular component per top-level section, instead of flattening the entire screen into ' +
        'one file. Use this for full pages/dashboards; use generate_angular_component for a single ' +
        'component/frame. Requires the one-time `npm run preview:setup` to preview (see `serve`).',
      inputSchema: GenerateAngularPageInput.shape,
    },
    async (input) => {
      const parsed = GenerateAngularPageInput.parse(input);
      const output = await runGenerateAngularPage(parsed);
      return {
        content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
        structuredContent: output as unknown as Record<string, unknown>,
      };
    }
  );
}
