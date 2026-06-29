import { FigmaClient } from '../../services/figmaClient.js';

export async function figmaGetComponentSet(args: { fileKey: string; componentSetId?: string }) {
  const client = new FigmaClient();
  const result = await client.getComponentSets(args.fileKey);
  const sets = result.meta.component_sets;

  if (args.componentSetId) {
    const found = sets.find(s => s.id === args.componentSetId);
    if (!found) throw new Error(`Component set ${args.componentSetId} not found`);
    return found;
  }

  return { componentSets: sets, count: sets.length };
}
