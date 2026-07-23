import { scanAngularLibrary } from '../library/scanner.js';
import { writeIndex } from '../library/index-store.js';
import type { LibIndexComponentsInput, LibIndexComponentsOutput } from '../types.js';

/** Core tool logic: scan an Angular workspace for @Component classes and persist the result as the searchable index. */
export async function runLibIndexComponents(input: LibIndexComponentsInput): Promise<LibIndexComponentsOutput> {
  const libraryDir = input.libraryDir ?? process.env.COMPONENT_LIBRARY_DIR;
  if (!libraryDir) {
    throw new Error(
      'No library directory to scan. Pass libraryDir, or set COMPONENT_LIBRARY_DIR in your environment.'
    );
  }

  const components = scanAngularLibrary(libraryDir);
  writeIndex(components);

  return { libraryDir, componentCount: components.length, components };
}
