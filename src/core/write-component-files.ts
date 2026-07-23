import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { GeneratedAngularComponent } from '../codegen/angular-generator.js';

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
