import { ComponentIndex, ComponentType } from '../../services/componentIndex.js';

export async function libMapFigmaToComponent(args: {
  figmaComponentId: string;
  selector: string;
  confidence?: number;
}) {
  const index = new ComponentIndex();
  const existing = index.getBySelector(args.selector);
  if (!existing) throw new Error(`Component not found in index: ${args.selector}`);

  index.saveMapping(args.figmaComponentId, args.selector, existing.componentType as ComponentType, args.confidence ?? 1.0);

  return {
    saved: true,
    figmaComponentId: args.figmaComponentId,
    selector: args.selector,
    componentType: existing.componentType,
    confidence: args.confidence ?? 1.0,
  };
}
