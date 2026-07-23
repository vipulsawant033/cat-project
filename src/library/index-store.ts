import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AngularComponentInfo } from './scanner.js';

function defaultIndexFilePath(): string {
  return process.env.LIBRARY_INDEX_FILE ?? path.resolve('./component-library-index.json');
}

/** Persists a fresh scan result so lib_search_component/lib_get_component don't need to rescan the whole library on every call. */
export function writeIndex(components: AngularComponentInfo[], indexFile = defaultIndexFilePath()): void {
  mkdirSync(path.dirname(indexFile), { recursive: true });
  writeFileSync(indexFile, JSON.stringify(components, null, 2) + '\n', 'utf-8');
}

export function readIndex(indexFile = defaultIndexFilePath()): AngularComponentInfo[] {
  if (!existsSync(indexFile)) return [];
  try {
    return JSON.parse(readFileSync(indexFile, 'utf-8'));
  } catch {
    return [];
  }
}
