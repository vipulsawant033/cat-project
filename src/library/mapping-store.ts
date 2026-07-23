import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface ComponentMapping {
  /** Figma component/component-set key, e.g. from figma_get_file's components map. */
  figmaComponentKey: string;
  figmaComponentName: string;
  angularSelector: string;
  /** Figma variant/property name -> Angular @Input name, e.g. { "Style": "variant", "Size": "size" } */
  propertyMappings: Record<string, string>;
  updatedAt: string;
}

function defaultMappingFilePath(): string {
  return process.env.MAPPING_FILE ?? path.resolve('./figma-library-mappings.json');
}

function readMappingFile(mappingFile: string): Record<string, ComponentMapping> {
  if (!existsSync(mappingFile)) return {};
  try {
    return JSON.parse(readFileSync(mappingFile, 'utf-8'));
  } catch {
    return {};
  }
}

function writeMappingFile(mappingFile: string, data: Record<string, ComponentMapping>): void {
  mkdirSync(path.dirname(mappingFile), { recursive: true });
  writeFileSync(mappingFile, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

/** Round-trip manifest entry (Phase 6 will extend this with Figma version/diff-result tracking). */
export function upsertMapping(
  mapping: Omit<ComponentMapping, 'updatedAt'>,
  mappingFile = defaultMappingFilePath()
): ComponentMapping {
  const all = readMappingFile(mappingFile);
  const full: ComponentMapping = { ...mapping, updatedAt: new Date().toISOString() };
  all[mapping.figmaComponentKey] = full;
  writeMappingFile(mappingFile, all);
  return full;
}

export function listMappings(mappingFile = defaultMappingFilePath()): ComponentMapping[] {
  return Object.values(readMappingFile(mappingFile));
}

export function getMapping(figmaComponentKey: string, mappingFile = defaultMappingFilePath()): ComponentMapping | undefined {
  return readMappingFile(mappingFile)[figmaComponentKey];
}
