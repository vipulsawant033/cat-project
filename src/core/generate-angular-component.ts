import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { FigmaClient } from '../figma/client.js';
import { findIconRoots } from '../figma/icon-detector.js';
import { figmaNodeToIr } from '../figma/parser.js';
import { generateAngularComponent } from '../codegen/angular-generator.js';
import { ensurePreviewRunning } from '../preview/manager.js';
import type { GenerateAngularComponentInput, GenerateAngularComponentOutput } from '../types.js';

/**
 * Core tool logic: Figma link -> parsed IR -> generated Angular component.
 * This is the single implementation shared by the MCP tool and the REST
 * bridge — add new tools here (as their own function) and register them in
 * both src/mcp/server.ts and src/bridge/routes.ts.
 */
export async function runGenerateAngularComponent(
  input: GenerateAngularComponentInput
): Promise<GenerateAngularComponentOutput> {
  const client = new FigmaClient({ token: input.figmaToken });
  const { fileKey, nodeId, fileName, node } = await client.resolveNodeFromLink(input.figmaLink);

  // Icons/logos/glyphs are vector subtrees the parser can't reconstruct structurally —
  // export them as flattened SVGs up front so the parser can treat each as one leaf asset.
  const iconRoots = findIconRoots(node);
  const iconSvgByNodeId = await client.exportSvgs(fileKey, iconRoots.map((n) => n.id));

  const ir = figmaNodeToIr(node, { isRoot: true, iconSvgByNodeId });
  const component = generateAngularComponent(ir, node.name);

  const output: GenerateAngularComponentOutput = {
    source: { fileKey, nodeId, fileName, nodeName: node.name },
    component,
  };

  if (input.writeToDisk) {
    const baseDir = path.resolve(input.outputDir ?? process.env.OUTPUT_DIR ?? './output', component.folder);
    await mkdir(baseDir, { recursive: true });
    const writtenPaths: string[] = [];
    for (const file of component.files) {
      const filePath = path.join(baseDir, file.fileName);
      await writeFile(filePath, file.content, 'utf-8');
      writtenPaths.push(filePath);
    }
    output.writtenPaths = writtenPaths;
  }

  if (input.serve) {
    try {
      output.preview = await ensurePreviewRunning(component);
    } catch (err) {
      output.preview = {
        status: 'error',
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  return output;
}
