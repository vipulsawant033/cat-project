import { z } from 'zod';

/**
 * Shared input/output contracts for the "generate_angular_component" tool.
 * Both the MCP tool handler (src/mcp/tools/generate-angular-component.ts)
 * and the REST bridge (src/bridge/routes.ts) validate against this same
 * schema and call the same core function, so behavior never drifts between
 * the two entry points.
 */
export const GenerateAngularComponentInput = z.object({
  figmaLink: z
    .string()
    .url()
    .describe('A Figma component/frame share link, e.g. https://www.figma.com/design/<key>/<title>?node-id=12-34'),
  figmaToken: z
    .string()
    .optional()
    .describe('Optional Figma personal access token override; defaults to FIGMA_TOKEN env var'),
  writeToDisk: z
    .boolean()
    .optional()
    .default(false)
    .describe('If true, also writes the generated files under outputDir (or OUTPUT_DIR env var)'),
  outputDir: z.string().optional().describe('Directory to write generated files into when writeToDisk is true'),
  serve: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      'If true (default), also serves the generated component on a local Angular dev server so it can be ' +
        'viewed in a browser immediately. Requires the one-time `npm run preview:setup` to have been run; ' +
        'otherwise the output reports status "setup-required" instead of failing the whole request.'
    ),
});

export type GenerateAngularComponentInput = z.infer<typeof GenerateAngularComponentInput>;

export interface PreviewResult {
  status: 'started' | 'already-running' | 'setup-required' | 'error';
  /** e.g. "http://localhost:4300" — present when status is 'started' or 'already-running'. */
  url?: string;
  message?: string;
}

export interface GenerateAngularComponentOutput {
  source: {
    fileKey: string;
    nodeId: string;
    fileName: string;
    nodeName: string;
  };
  component: {
    selector: string;
    className: string;
    folder: string;
    files: { fileName: string; content: string }[];
  };
  writtenPaths?: string[];
  preview?: PreviewResult;
}
