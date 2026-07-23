import { readIndex } from '../library/index-store.js';
import type { LibSearchComponentInput, LibSearchComponentOutput } from '../types.js';

/** Core tool logic: substring search over the persisted component index built by lib_index_components. */
export async function runLibSearchComponent(input: LibSearchComponentInput): Promise<LibSearchComponentOutput> {
  const query = input.query.toLowerCase();
  const matches = readIndex().filter(
    (c) => c.selector.toLowerCase().includes(query) || c.className.toLowerCase().includes(query)
  );
  return { query: input.query, matches };
}
