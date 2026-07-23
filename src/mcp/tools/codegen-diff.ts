import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { runCodegenDiff } from '../../core/codegen-diff.js';
import { CodegenDiffInput } from '../../types.js';

export const TOOL_NAME = 'codegen_diff';

export function registerCodegenDiffTool(server: McpServer): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: 'Pixel-Diff Generated Component Against Figma',
      description:
        'Generates and serves the Angular component for a Figma node, screenshots it live via a headless ' +
        'browser at a matching viewport, fetches Figma\'s own PNG export as ground truth, and pixel-diffs the ' +
        'two. Returns a mismatch ratio, pass/fail against maxMismatchRatio, and coarse bounding-box regions of ' +
        'where pixels differ. Requires the one-time `npm run preview:setup` and `npx playwright install ' +
        'chromium` to have been run first.',
      inputSchema: CodegenDiffInput.shape,
    },
    async (input) => {
      const parsed = CodegenDiffInput.parse(input);
      const output = await runCodegenDiff(parsed);
      return {
        content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
        structuredContent: output as unknown as Record<string, unknown>,
      };
    }
  );
}
