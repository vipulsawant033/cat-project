import path from 'node:path';
import { FigmaClient } from '../figma/client.js';
import { findIconRoots } from '../figma/icon-detector.js';
import { findImageFillNodes } from '../figma/image-fill-detector.js';
import { figmaNodeToIr } from '../figma/parser.js';
import { loadTokensByVariableId } from '../figma/tokens.js';
import { hashFigmaNode } from '../figma/content-hash.js';
import { generateAngularPage } from '../codegen/page-generator.js';
import { serializeGeneratedFile } from '../codegen/angular-generator.js';
import { buildIconAssets } from './icon-assets.js';
import { buildImageAssets } from './image-assets.js';
import { ensurePagePreviewRunning } from '../preview/manager.js';
import { getMapping } from '../library/mapping-store.js';
import { recordGeneration } from '../manifest/store.js';
import { writeComponentFilesToDisk, writeIconAssetsToDisk, writeImageAssetsToDisk } from './write-component-files.js';
import type { GenerateAngularPageInput, GenerateAngularPageOutput, GeneratedComponentFiles } from '../types.js';

/**
 * Core tool logic: Figma screen link -> parsed IR -> a composing page
 * component plus one component per top-level section. Shares the same
 * Figma-fetch/parse pipeline as runGenerateAngularComponent — the only
 * difference is the codegen step (generateAngularPage instead of
 * generateAngularComponent) and that writing/serving covers multiple
 * generated components instead of one.
 */
export async function runGenerateAngularPage(input: GenerateAngularPageInput): Promise<GenerateAngularPageOutput> {
  const client = new FigmaClient({ token: input.figmaToken });
  const { fileKey, nodeId, fileName, node, componentsByNodeId } = await client.resolveNodeFromLink(input.figmaLink);

  const iconRoots = findIconRoots(node);
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

  const { page, sections } = generateAngularPage(ir, node.name, iconAssets, imageAssets);

  recordGeneration({
    fileKey,
    nodeId,
    nodeName: node.name,
    kind: 'page',
    figmaContentHash: hashFigmaNode(node),
    component: { selector: page.selector, className: page.className, folder: page.folder },
    sections: sections.map((s) => ({ selector: s.selector, className: s.className, folder: s.folder })),
  });

  const serializeComponent = (c: typeof page): GeneratedComponentFiles => ({
    ...c,
    files: c.files.map(serializeGeneratedFile),
    iconAssets: c.iconAssets.map(serializeGeneratedFile),
    imageAssets: c.imageAssets.map(serializeGeneratedFile),
  });

  const output: GenerateAngularPageOutput = {
    source: { fileKey, nodeId, fileName, nodeName: node.name },
    page: serializeComponent(page),
    sections: sections.map(serializeComponent),
  };

  if (input.writeToDisk) {
    const baseDir = path.resolve(input.outputDir ?? process.env.OUTPUT_DIR ?? './output', page.folder);
    const iconsDir = path.resolve(input.iconsDir ?? process.env.ICONS_DIR ?? './public/icons');
    const imagesDir = path.resolve(input.imagesDir ?? process.env.IMAGES_DIR ?? './public/images');
    const writtenPaths: string[] = [];
    await writeComponentFilesToDisk(page, baseDir, writtenPaths);
    for (const section of sections) {
      await writeComponentFilesToDisk(section, path.join(baseDir, 'sections', section.folder), writtenPaths);
    }
    await writeIconAssetsToDisk(iconAssets, iconsDir, writtenPaths);
    await writeImageAssetsToDisk(imageAssets, imagesDir, writtenPaths);
    output.writtenPaths = writtenPaths;
  }

  if (input.serve) {
    try {
      output.preview = await ensurePagePreviewRunning({ page, sections });
    } catch (err) {
      output.preview = {
        status: 'error',
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  return output;
}
