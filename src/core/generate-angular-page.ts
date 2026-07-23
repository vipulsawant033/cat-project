import path from 'node:path';
import { FigmaClient } from '../figma/client.js';
import { findIconRoots } from '../figma/icon-detector.js';
import { figmaNodeToIr } from '../figma/parser.js';
import { loadTokensByVariableId } from '../figma/tokens.js';
import { hashFigmaNode } from '../figma/content-hash.js';
import { generateAngularPage } from '../codegen/page-generator.js';
import { ensurePagePreviewRunning } from '../preview/manager.js';
import { getMapping } from '../library/mapping-store.js';
import { recordGeneration } from '../manifest/store.js';
import { writeComponentFilesToDisk } from './write-component-files.js';
import type { GenerateAngularPageInput, GenerateAngularPageOutput } from '../types.js';

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
  const [iconSvgByNodeId, tokensByVariableId] = await Promise.all([
    client.exportSvgs(fileKey, iconRoots.map((n) => n.id)),
    loadTokensByVariableId(client, fileKey),
  ]);

  const ir = figmaNodeToIr(node, {
    isRoot: true,
    iconSvgByNodeId,
    tokensByVariableId,
    componentsByNodeId,
    resolveMapping: (figmaComponentKey) => getMapping(figmaComponentKey),
  });

  const { page, sections } = generateAngularPage(ir, node.name);

  recordGeneration({
    fileKey,
    nodeId,
    nodeName: node.name,
    kind: 'page',
    figmaContentHash: hashFigmaNode(node),
    component: { selector: page.selector, className: page.className, folder: page.folder },
    sections: sections.map((s) => ({ selector: s.selector, className: s.className, folder: s.folder })),
  });

  const output: GenerateAngularPageOutput = {
    source: { fileKey, nodeId, fileName, nodeName: node.name },
    page,
    sections,
  };

  if (input.writeToDisk) {
    const baseDir = path.resolve(input.outputDir ?? process.env.OUTPUT_DIR ?? './output', page.folder);
    const writtenPaths: string[] = [];
    await writeComponentFilesToDisk(page, baseDir, writtenPaths);
    for (const section of sections) {
      await writeComponentFilesToDisk(section, path.join(baseDir, 'sections', section.folder), writtenPaths);
    }
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
