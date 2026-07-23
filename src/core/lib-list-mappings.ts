import { listMappings } from '../library/mapping-store.js';
import type { LibListMappingsInput, LibListMappingsOutput } from '../types.js';

/** Core tool logic: return every persisted Figma -> Angular component mapping. */
export async function runLibListMappings(_input: LibListMappingsInput): Promise<LibListMappingsOutput> {
  return { mappings: listMappings() };
}
