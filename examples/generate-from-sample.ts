import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { figmaNodeToIr } from '../src/figma/parser.js';
import { generateAngularComponent } from '../src/codegen/angular-generator.js';
import type { FigmaNode } from '../src/figma/types.js';

/**
 * Runs the parser + codegen stub against a local Figma node JSON file,
 * bypassing the Figma API entirely. Useful for testing/iterating on the
 * transformation logic without a token or network access.
 *
 * Usage: npx tsx examples/generate-from-sample.ts
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const raw = await readFile(path.join(__dirname, 'sample-figma-node.json'), 'utf-8');
  const node = JSON.parse(raw) as FigmaNode;

  const ir = figmaNodeToIr(node);
  const component = generateAngularComponent(ir, node.name);

  console.log(`Generated component: ${component.className} (selector: ${component.selector})\n`);
  for (const file of component.files) {
    console.log(`--- ${file.fileName} ---`);
    console.log(file.content);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
