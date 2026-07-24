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
 * Writes exported asset files (icon .svg or image-fill .png) flat into `dir`
 * (a shared, workspace-level folder — not the component's own folder, unlike
 * writeComponentFilesToDisk), deduping by fileName since the same asset can be
 * referenced by more than one generated component (e.g. a page and its
 * sections). Buffer content (raster images) is written as-is; string content
 * (SVG markup) is written as utf-8 text.
 */
async function writeAssetsToDisk(assets: GeneratedFile[], dir: string, writtenPaths: string[]): Promise<void> {
  if (assets.length === 0) return;
  await mkdir(dir, { recursive: true });
  const byFileName = new Map(assets.map((asset) => [asset.fileName, asset]));
  for (const asset of byFileName.values()) {
    const filePath = path.join(dir, asset.fileName);
    if (Buffer.isBuffer(asset.content)) {
      await writeFile(filePath, asset.content);
    } else {
      await writeFile(filePath, asset.content, 'utf-8');
    }
    writtenPaths.push(filePath);
  }
}

/** Writes exported icon .svg files — see writeAssetsToDisk. */
export async function writeIconAssetsToDisk(
  iconAssets: GeneratedFile[],
  iconsDir: string,
  writtenPaths: string[]
): Promise<void> {
  await writeAssetsToDisk(iconAssets, iconsDir, writtenPaths);
}

/** Writes exported image-fill .png files — see writeAssetsToDisk. */
export async function writeImageAssetsToDisk(
  imageAssets: GeneratedFile[],
  imagesDir: string,
  writtenPaths: string[]
): Promise<void> {
  await writeAssetsToDisk(imageAssets, imagesDir, writtenPaths);
}
