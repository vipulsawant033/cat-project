import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { runManifestList } from '../../core/manifest-list.js';
import { ManifestListInput } from '../../types.js';

export const TOOL_NAME = 'manifest_list';

export function registerManifestListTool(server: McpServer): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: 'List Generation History',
      description:
        'Returns every persisted round-trip manifest entry — every Figma node ever generated via ' +
        'generate_angular_component/generate_angular_page, its output location, the content hash it was ' +
        'generated from, and its last codegen_diff result if any. Use this to see what already exists before ' +
        'deciding what still needs generating.',
      inputSchema: ManifestListInput.shape,
    },
    async (input) => {
      const parsed = ManifestListInput.parse(input);
      const output = await runManifestList(parsed);
      return {
        content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
        structuredContent: output as unknown as Record<string, unknown>,
      };
    }
  );
}
