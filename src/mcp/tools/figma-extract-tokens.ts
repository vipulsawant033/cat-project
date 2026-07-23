import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { runFigmaExtractTokens } from '../../core/figma-extract-tokens.js';
import { FigmaExtractTokensInput } from '../../types.js';

export const TOOL_NAME = 'figma_extract_tokens';

export function registerFigmaExtractTokensTool(server: McpServer): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: 'Extract Figma Design Tokens',
      description:
        'Fetches every design-token variable defined in a Figma file (via the Variables API) and normalizes ' +
        'each into a suggested CSS custom-property name plus its resolved value per mode (e.g. Light/Dark). ' +
        'Use this output to bind generated component styles to var(--token) instead of hardcoded hex/px values.',
      inputSchema: FigmaExtractTokensInput.shape,
    },
    async (input) => {
      const parsed = FigmaExtractTokensInput.parse(input);
      const output = await runFigmaExtractTokens(parsed);
      return {
        content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
        structuredContent: output as unknown as Record<string, unknown>,
      };
    }
  );
}
