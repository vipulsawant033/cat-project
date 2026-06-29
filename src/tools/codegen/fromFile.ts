import { FigmaClient } from '../../services/figmaClient.js';
import { ComponentIndex } from '../../services/componentIndex.js';
import { TokenMapper } from '../../services/tokenMapper.js';
import { LayoutAnalyzer } from '../../services/layoutAnalyzer.js';
import { CodeGenerator } from '../../services/codeGenerator.js';
import { FigmaNode } from '../../services/figmaClient.js';

export async function codegenFromFile(args: { fileKey: string; pageId?: string }) {
  const client = new FigmaClient();
  const file = await client.getFile(args.fileKey);
  const index = new ComponentIndex();
  const tokenMapper = new TokenMapper();
  const layoutAnalyzer = new LayoutAnalyzer();
  const generator = new CodeGenerator(index, tokenMapper, layoutAnalyzer);

  const doc = file.document;
  const pages = doc.children || [];
  const targetPage = args.pageId
    ? pages.find(p => p.id === args.pageId)
    : pages[0];

  if (!targetPage) throw new Error(`Page not found`);

  const components: Array<{ name: string; html: string; scss: string; ts: string }> = [];

  for (const frame of (targetPage.children || []).slice(0, 10)) {
    const ir = generator.figmaNodeToIR(frame, 'auto');
    const componentName = frame.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const litElements = generator.collectLitElements(ir);
    const hasLit = litElements.length > 0;

    components.push({
      name: componentName,
      html: generator.generateHTML(ir, hasLit),
      scss: generator.generateSCSS(ir, componentName),
      ts: generator.generateTS(componentName, `app-${componentName}`, hasLit),
    });
  }

  return {
    fileName: file.name,
    pageName: targetPage.name,
    components,
    count: components.length,
  };
}
