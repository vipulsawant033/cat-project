import path from 'node:path';
import { FigmaClient } from '../figma/client.js';
import { findIconRoots } from '../figma/icon-detector.js';
import { findImageFillNodes } from '../figma/image-fill-detector.js';
import { figmaNodeToIr } from '../figma/parser.js';
import { loadTokensByVariableId } from '../figma/tokens.js';
import { hashFigmaNode } from '../figma/content-hash.js';
import { generateAngularComponent, serializeGeneratedFile } from '../codegen/angular-generator.js';
import { buildIconAssets } from './icon-assets.js';
import { buildImageAssets } from './image-assets.js';
import { ensurePreviewRunning } from '../preview/manager.js';
import { getMapping } from '../library/mapping-store.js';
import { recordGeneration } from '../manifest/store.js';
import { writeComponentFilesToDisk, writeIconAssetsToDisk, writeImageAssetsToDisk } from './write-component-files.js';
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
  // RECTANGLE nodes with an IMAGE fill (photos, logos) can't be reconstructed from CSS either —
  // export them as flattened PNGs the same way, so the parser can treat each as one leaf asset.
  const imageFillNodes = findImageFillNodes(node);
  const [iconSvgByNodeId, imagePngByNodeId, tokensByVariableId] = await Promise.all([
    client.exportSvgs(fileKey, iconRoots.map((n) => n.id)),
    client.exportPngBytes(fileKey, imageFillNodes.map((n) => n.id), 2),
    loadTokensByVariableId(client, fileKey),
  ]);
  const { iconAssets, iconSrcByNodeId } = buildIconAssets(iconRoots, iconSvgByNodeId);
  const { imageAssets, imageSrcByNodeId } = buildImageAssets(imageFillNodes, imagePngByNodeId);

  const ir = figmaNodeToIr(node, {
    isRoot: true,
    iconSrcByNodeId,
    imageSrcByNodeId,
    tokensByVariableId,
    componentsByNodeId,
    resolveMapping: (figmaComponentKey) => getMapping(figmaComponentKey),
  });
  const component = generateAngularComponent(ir, node.name, { iconAssets, imageAssets });

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
    component: {
      ...component,
      files: component.files.map(serializeGeneratedFile),
      iconAssets: component.iconAssets.map(serializeGeneratedFile),
      imageAssets: component.imageAssets.map(serializeGeneratedFile),
    },
  };

  if (input.writeToDisk) {
    const baseDir = path.resolve(input.outputDir ?? process.env.OUTPUT_DIR ?? './output', component.folder);
    const iconsDir = path.resolve(input.iconsDir ?? process.env.ICONS_DIR ?? './public/icons');
    const imagesDir = path.resolve(input.imagesDir ?? process.env.IMAGES_DIR ?? './public/images');
    const writtenPaths: string[] = [];
    await writeComponentFilesToDisk(component, baseDir, writtenPaths);
    await writeIconAssetsToDisk(component.iconAssets, iconsDir, writtenPaths);
    await writeImageAssetsToDisk(component.imageAssets, imagesDir, writtenPaths);
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
