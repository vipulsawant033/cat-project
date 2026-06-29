import { ComponentIndex, ComponentType } from '../../services/componentIndex.js';

export async function libSearchComponent(args: {
  query: string;
  preferType?: 'angular' | 'lit';
  limit?: number;
}) {
  const index = new ComponentIndex();
  const results = index.search(args.query, args.preferType as ComponentType | undefined, args.limit ?? 10);

  return {
    query: args.query,
    preferType: args.preferType || 'any',
    results: results.map(r => ({
      selector: r.selector,
      className: r.className,
      componentType: r.componentType,
      filePath: r.filePath,
      inputs: r.inputs,
      outputs: r.outputs,
      slots: r.slots,
      cssCustomProperties: r.cssCustomProperties,
      variants: r.variants,
      exampleUsage: r.exampleUsage,
      figmaComponentId: r.figmaComponentId,
      score: (r as typeof r & { score?: number }).score,
    })),
    count: results.length,
  };
}
