import { listManifestEntries } from '../manifest/store.js';
import type { ManifestListInput, ManifestListOutput } from '../types.js';

/** Core tool logic: return every persisted generation-history entry (see src/manifest/store.ts). */
export async function runManifestList(_input: ManifestListInput): Promise<ManifestListOutput> {
  return { entries: listManifestEntries() };
}
