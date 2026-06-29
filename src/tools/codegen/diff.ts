import { FigmaClient } from '../../services/figmaClient.js';
import { ComponentIndex } from '../../services/componentIndex.js';
import { TokenMapper } from '../../services/tokenMapper.js';
import { LayoutAnalyzer } from '../../services/layoutAnalyzer.js';
import { CodeGenerator } from '../../services/codeGenerator.js';

export async function codegenDiff(args: { fileKey: string; nodeId: string; selector: string }) {
  const client = new FigmaClient();
  const nodeResult = await client.getNode(args.fileKey, args.nodeId);
  const nodeData = nodeResult.nodes[args.nodeId];
  if (!nodeData) throw new Error(`Node ${args.nodeId} not found`);

  const index = new ComponentIndex();
  const existing = index.getBySelector(args.selector);
  if (!existing) throw new Error(`Component not found: ${args.selector}`);

  const tokenMapper = new TokenMapper();
  const layoutAnalyzer = new LayoutAnalyzer();
  const generator = new CodeGenerator(index, tokenMapper, layoutAnalyzer);
  const ir = generator.figmaNodeToIR(nodeData.document, 'auto');
  const newMatchedComponents = generator.collectMatchedComponents(ir);

  // Compare inputs
  const existingInputNames = new Set(existing.inputs.map(i => i.name));
  const newInputNames = new Set(newMatchedComponents.map(m => m.selector));

  const addedInputs = newMatchedComponents
    .filter(m => !existingInputNames.has(m.selector))
    .map(m => m.selector);
  const removedInputs = existing.inputs
    .filter(i => !newMatchedComponents.find(m => m.selector === i.name))
    .map(i => i.name);

  const newLitElements = generator.collectLitElements(ir);
  const existingLitElements = existing.componentType === 'lit' ? [existing.selector] : [];
  const newChildComponents = newLitElements.filter(e => !existingLitElements.includes(e));

  const layoutChanges: string[] = [];
  const newLayout = layoutAnalyzer.analyze(nodeData.document);
  if (newLayout.display !== 'block') layoutChanges.push(`Layout changed to: ${newLayout.display} ${newLayout.flexDirection || ''}`);

  const changedStyles: Array<{ property: string; oldValue: string; newValue: string }> = [];

  const summary = [
    addedInputs.length ? `${addedInputs.length} new inputs/components added.` : '',
    removedInputs.length ? `${removedInputs.length} inputs/components removed.` : '',
    newChildComponents.length ? `${newChildComponents.length} new child components detected.` : '',
    changedStyles.length ? `${changedStyles.length} style changes.` : '',
    'Diff complete.',
  ].filter(Boolean).join(' ');

  return {
    selector: args.selector,
    addedInputs,
    removedInputs,
    changedStyles,
    layoutChanges,
    newChildComponents,
    summary,
  };
}
