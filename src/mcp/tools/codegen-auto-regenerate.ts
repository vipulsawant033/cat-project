import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { runCodegenAutoRegenerate } from '../../core/codegen-auto-regenerate.js';
import { CodegenAutoRegenerateInput } from '../../types.js';

export const TOOL_NAME = 'codegen_auto_regenerate';

export function registerCodegenAutoRegenerateTool(server: McpServer): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: 'Auto-Regenerate Until Pixel-Perfect (Closed Loop)',
      description:
        'The efficient entry point for a fix-and-retry workflow: checks the round-trip manifest first and ' +
        'skips regeneration entirely if this node is unchanged and already passing (pass force:true to ' +
        'override). Otherwise regenerates and pixel-diffs it (same as codegen_diff), and on failure also runs ' +
        'codegen_validate and bundles its unmapped-instance list into the response as the concrete next fix. ' +
        'Generation is deterministic, so call this again after making an actual change (a new ' +
        'lib_map_figma_to_component mapping, a Figma edit) rather than expecting repeated calls alone to ' +
        'converge — nothing changes between identical calls.',
      inputSchema: CodegenAutoRegenerateInput.shape,
    },
    async (input) => {
      const parsed = CodegenAutoRegenerateInput.parse(input);
      const output = await runCodegenAutoRegenerate(parsed);
      return {
        content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
        structuredContent: output as unknown as Record<string, unknown>,
      };
    }
  );
}
