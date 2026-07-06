import { FigmaClient } from '../../services/figmaClient.js';
import { ComponentIndex } from '../../services/componentIndex.js';
import { TokenMapper } from '../../services/tokenMapper.js';
import { LayoutAnalyzer } from '../../services/layoutAnalyzer.js';
import { CodeGenerator, ComponentTypePreference, FigmaAssetFetcher } from '../../services/codeGenerator.js';

export async function codegenFromNode(args: {
  fileKey: string;
  nodeId: string;
  componentName?: string;
  outputFormat?: 'files' | 'inline';
  forceGeneric?: boolean;
  preferComponentType?: 'angular' | 'lit' | 'auto';
}) {
  const client = new FigmaClient();
  const nodeResult = await client.getNode(args.fileKey, args.nodeId);
  const nodeData = nodeResult.nodes[args.nodeId];
  if (!nodeData) throw new Error(`Node ${args.nodeId} not found`);

  const node = nodeData.document;
  const componentName = args.componentName ||
    node.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') ||
    'generated-component';

  const index = new ComponentIndex();
  const tokenMapper = new TokenMapper();
  await tokenMapper.loadFigmaVariables(client, args.fileKey);
  const layoutAnalyzer = new LayoutAnalyzer();
  const assetFetcher = new FigmaAssetFetcher(client, args.fileKey);
  const generator = new CodeGenerator(index, tokenMapper, layoutAnalyzer, assetFetcher);

  const preferType: ComponentTypePreference = args.forceGeneric
    ? 'auto'
    : (args.preferComponentType || 'auto');

  const ir = await generator.figmaNodeToIR(node, preferType);
  const litElements = generator.collectLitElements(ir);
  const hasLit = litElements.length > 0;
  const matchedComponents = generator.collectMatchedComponents(ir);
  const truncatedNodes = generator.collectTruncatedNodes(ir);

  const html = generator.generateHTML(ir, hasLit);
  const scss = generator.generateSCSS(ir, componentName);
  const ts = generator.generateTS(componentName, `app-${componentName}`, hasLit);

  const unmappedTokens: string[] = [];

  return {
    componentName,
    html,
    scss,
    ts,
    unmappedTokens,
    matchedComponents,
    litElementsUsed: litElements,
    requiresCustomElementsSchema: hasLit,
    truncated: truncatedNodes.length > 0,
    truncatedNodes,
  };
}
