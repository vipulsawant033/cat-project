import { FigmaClient } from '../../services/figmaClient.js';
import { ComponentIndex } from '../../services/componentIndex.js';
import { TokenMapper } from '../../services/tokenMapper.js';
import { LayoutAnalyzer } from '../../services/layoutAnalyzer.js';
import { CodeGenerator, ComponentTypePreference } from '../../services/codeGenerator.js';

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
  const layoutAnalyzer = new LayoutAnalyzer();
  const generator = new CodeGenerator(index, tokenMapper, layoutAnalyzer);

  const preferType: ComponentTypePreference = args.forceGeneric
    ? 'auto'
    : (args.preferComponentType || 'auto');

  const ir = generator.figmaNodeToIR(node, preferType);
  const litElements = generator.collectLitElements(ir);
  const hasLit = litElements.length > 0;
  const matchedComponents = generator.collectMatchedComponents(ir);

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
  };
}
