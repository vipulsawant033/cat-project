import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { GeneratedAngularComponent, GeneratedFile } from '../codegen/angular-generator.js';

/** Writes a generated component's files into `dir` (creating it if needed) and appends each written path to `writtenPaths`. Shared by single-component and whole-page generation so both write-to-disk the same way. */
export async function writeComponentFilesToDisk(
  component: GeneratedAngularComponent,
  dir: string,
  writtenPaths: string[]
): Promise<void> {
  await mkdir(dir, { recursive: true });
  for (const file of component.files) {
    const filePath = path.join(dir, file.fileName);
    await writeFile(filePath, file.content, 'utf-8');
    writtenPaths.push(filePath);
  }
}

/**
 * Writes exported icon .svg files flat into `iconsDir` (a shared, workspace-level
 * folder — not the component's own folder, unlike writeComponentFilesToDisk),
 * deduping by fileName since the same icon can be referenced by more than one
 * generated component (e.g. a page and its sections).
 */
export async function writeIconAssetsToDisk(
  iconAssets: GeneratedFile[],
  iconsDir: string,
  writtenPaths: string[]
): Promise<void> {
  if (iconAssets.length === 0) return;
  await mkdir(iconsDir, { recursive: true });
  const byFileName = new Map(iconAssets.map((asset) => [asset.fileName, asset]));
  for (const asset of byFileName.values()) {
    const filePath = path.join(iconsDir, asset.fileName);
    await writeFile(filePath, asset.content, 'utf-8');
    writtenPaths.push(filePath);
  }
}
