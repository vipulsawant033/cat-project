import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { runCodegenDetectDrift } from '../../core/codegen-detect-drift.js';
import { CodegenDetectDriftInput } from '../../types.js';

export const TOOL_NAME = 'codegen_detect_drift';

export function registerCodegenDetectDriftTool(server: McpServer): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: 'Detect Figma Design Drift Since Last Generation',
      description:
        'Compares a Figma node\'s current content against what it was when generate_angular_component/' +
        'generate_angular_page last ran for it, using a content hash recorded in the round-trip manifest. ' +
        'Reports whether the design has changed since (drifted), plus the last generation\'s output info and ' +
        'diff result if any. Does not regenerate anything itself — use this to decide whether a regeneration ' +
        'is actually needed before spending the time on one.',
      inputSchema: CodegenDetectDriftInput.shape,
    },
    async (input) => {
      const parsed = CodegenDetectDriftInput.parse(input);
      const output = await runCodegenDetectDrift(parsed);
      return {
        content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
        structuredContent: output as unknown as Record<string, unknown>,
      };
    }
  );
}
