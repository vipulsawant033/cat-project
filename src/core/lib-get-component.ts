import { readIndex } from '../library/index-store.js';
import type { LibGetComponentInput, LibGetComponentOutput } from '../types.js';

/** Core tool logic: exact selector/class-name lookup in the persisted component index. */
export async function runLibGetComponent(input: LibGetComponentInput): Promise<LibGetComponentOutput> {
  const component =
    readIndex().find((c) => c.selector === input.selector || c.className === input.selector) ?? null;
  return { component };
}
