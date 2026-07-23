import { upsertMapping } from '../library/mapping-store.js';
import type { LibMapFigmaToComponentInput, LibMapFigmaToComponentOutput } from '../types.js';

/** Core tool logic: persist (or update) one Figma component -> Angular selector mapping. */
export async function runLibMapFigmaToComponent(
  input: LibMapFigmaToComponentInput
): Promise<LibMapFigmaToComponentOutput> {
  const mapping = upsertMapping({
    figmaComponentKey: input.figmaComponentKey,
    figmaComponentName: input.figmaComponentName,
    angularSelector: input.angularSelector,
    propertyMappings: input.propertyMappings,
  });
  return { mapping };
}
