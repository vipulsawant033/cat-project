import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { runCodegenValidate } from '../../core/codegen-validate.js';
import { CodegenValidateInput } from '../../types.js';

export const TOOL_NAME = 'codegen_validate';

export function registerCodegenValidateTool(server: McpServer): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: 'Validate Component-Mapping Coverage',
      description:
        'Walks a Figma frame/screen\'s raw node tree and reports every component INSTANCE that has no ' +
        'lib_map_figma_to_component mapping — those render as generic divs today instead of real Angular ' +
        'components. Use this before generating a screen to see exactly which components are worth mapping ' +
        'first for the biggest fidelity/reuse improvement.',
      inputSchema: CodegenValidateInput.shape,
    },
    async (input) => {
      const parsed = CodegenValidateInput.parse(input);
      const output = await runCodegenValidate(parsed);
      return {
        content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
        structuredContent: output as unknown as Record<string, unknown>,
      };
    }
  );
}
