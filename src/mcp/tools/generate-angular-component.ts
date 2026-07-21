import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { runGenerateAngularComponent } from '../../core/generate-angular-component.js';
import { GenerateAngularComponentInput } from '../../types.js';

export const TOOL_NAME = 'generate_angular_component';

/**
 * Registers the "generate_angular_component" MCP tool on the given server.
 *
 * To add a new tool:
 *   1. Create src/core/<your-tool>.ts with the pure implementation (no MCP
 *      or HTTP concerns — just input in, output out).
 *   2. Create src/mcp/tools/<your-tool>.ts following this file's shape and
 *      export a `register<YourTool>Tool(server)` function.
 *   3. Call it from src/mcp/server.ts.
 *   4. Add a matching route in src/bridge/routes.ts so REST clients get it too.
 */
export function registerGenerateAngularComponentTool(server: McpServer): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: 'Generate Angular Component from Figma',
      description:
        'Fetches a Figma component/frame from a share link and generates an equivalent ' +
        'standalone Angular component (TypeScript, HTML template, and SCSS), returned as ' +
        'structured file contents. By default also serves it on a local Angular dev server ' +
        '(see the `serve` input and `preview` output field) so it can be viewed in a browser ' +
        'immediately — requires the one-time `npm run preview:setup` to have been run first.',
      inputSchema: GenerateAngularComponentInput.shape,
    },
    async (input) => {
      const parsed = GenerateAngularComponentInput.parse(input);
      const output = await runGenerateAngularComponent(parsed);
      return {
        content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
        structuredContent: output as unknown as Record<string, unknown>,
      };
    }
  );
}
