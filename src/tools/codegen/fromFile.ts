import { FigmaClient } from '../../services/figmaClient.js';
import { ComponentIndex } from '../../services/componentIndex.js';
import { TokenMapper } from '../../services/tokenMapper.js';
import { LayoutAnalyzer } from '../../services/layoutAnalyzer.js';
import { CodeGenerator, FigmaAssetFetcher } from '../../services/codeGenerator.js';
import { logger } from '../../utils/logger.js';

const DEFAULT_MAX_FRAMES = 30;

export async function codegenFromFile(args: { fileKey: string; pageId?: string; maxFrames?: number }) {
  const client = new FigmaClient();
  const file = await client.getFile(args.fileKey);
  const index = new ComponentIndex();
  const tokenMapper = new TokenMapper();
  await tokenMapper.loadFigmaVariables(client, args.fileKey);
  const layoutAnalyzer = new LayoutAnalyzer();
  const assetFetcher = new FigmaAssetFetcher(client, args.fileKey);
  const generator = new CodeGenerator(index, tokenMapper, layoutAnalyzer, assetFetcher);

  const doc = file.document;
  const pages = doc.children || [];
  const targetPage = args.pageId
    ? pages.find(p => p.id === args.pageId)
    : pages[0];

  if (!targetPage) throw new Error(`Page not found`);

  const maxFrames = args.maxFrames ?? DEFAULT_MAX_FRAMES;
  const allFrames = targetPage.children || [];
  const framesToProcess = allFrames.slice(0, maxFrames);
  const skippedFrameNames = allFrames.slice(maxFrames).map(f => f.name);
  if (skippedFrameNames.length) {
    logger.warn('codegen_from_file: page has more frames than maxFrames, some were skipped', {
      pageId: targetPage.id, maxFrames, skipped: skippedFrameNames.length,
    });
  }

  const components: Array<{ name: string; html: string; scss: string; ts: string; truncated: boolean }> = [];
  const truncatedFrames: string[] = [];

  for (const frame of framesToProcess) {
    const ir = await generator.figmaNodeToIR(frame, 'auto');
    const componentName = frame.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const litElements = generator.collectLitElements(ir);
    const hasLit = litElements.length > 0;
    const hasTruncatedSubtree = generator.collectTruncatedNodes(ir).length > 0;
    if (hasTruncatedSubtree) truncatedFrames.push(frame.name);

    components.push({
      name: componentName,
      html: generator.generateHTML(ir, hasLit),
      scss: generator.generateSCSS(ir, componentName),
      ts: generator.generateTS(componentName, `app-${componentName}`, hasLit),
      truncated: hasTruncatedSubtree,
    });
  }

  return {
    fileName: file.name,
    pageName: targetPage.name,
    components,
    count: components.length,
    skippedFrameCount: skippedFrameNames.length,
    skippedFrameNames,
    truncatedFrames,
  };
}
