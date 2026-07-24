import path from 'node:path';
import { FigmaClient } from '../figma/client.js';
import { findIconRoots } from '../figma/icon-detector.js';
import { figmaNodeToIr } from '../figma/parser.js';
import { loadTokensByVariableId } from '../figma/tokens.js';
import { hashFigmaNode } from '../figma/content-hash.js';
import { generateAngularComponent } from '../codegen/angular-generator.js';
import { buildIconAssets } from './icon-assets.js';
import { ensurePreviewRunning } from '../preview/manager.js';
import { getMapping } from '../library/mapping-store.js';
import { recordGeneration } from '../manifest/store.js';
import { writeComponentFilesToDisk, writeIconAssetsToDisk } from './write-component-files.js';
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
  const { fileKey, nodeId, fileName, node, componentsByNodeId } = await client.resolveNodeFromLink(input.figmaLink);

  // Icons/logos/glyphs are vector subtrees the parser can't reconstruct structurally —
  // export them as flattened SVGs up front so the parser can treat each as one leaf asset.
  const iconRoots = findIconRoots(node);
  const [iconSvgByNodeId, tokensByVariableId] = await Promise.all([
    client.exportSvgs(fileKey, iconRoots.map((n) => n.id)),
    loadTokensByVariableId(client, fileKey),
  ]);
  const { iconAssets, iconSrcByNodeId } = buildIconAssets(iconRoots, iconSvgByNodeId);

  const ir = figmaNodeToIr(node, {
    isRoot: true,
    iconSrcByNodeId,
    tokensByVariableId,
    componentsByNodeId,
    resolveMapping: (figmaComponentKey) => getMapping(figmaComponentKey),
  });
  const component = generateAngularComponent(ir, node.name, { iconAssets });

  recordGeneration({
    fileKey,
    nodeId,
    nodeName: node.name,
    kind: 'component',
    figmaContentHash: hashFigmaNode(node),
    component: { selector: component.selector, className: component.className, folder: component.folder },
  });

  const output: GenerateAngularComponentOutput = {
    source: { fileKey, nodeId, fileName, nodeName: node.name },
    component,
  };

  if (input.writeToDisk) {
    const baseDir = path.resolve(input.outputDir ?? process.env.OUTPUT_DIR ?? './output', component.folder);
    const iconsDir = path.resolve(input.iconsDir ?? process.env.ICONS_DIR ?? './public/icons');
    const writtenPaths: string[] = [];
    await writeComponentFilesToDisk(component, baseDir, writtenPaths);
    await writeIconAssetsToDisk(component.iconAssets, iconsDir, writtenPaths);
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
