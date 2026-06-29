import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { FigmaClient } from '../../services/figmaClient.js';

export async function codegenValidate(args: {
  fileKey: string;
  nodeId: string;
  screenshotPath: string;
  threshold?: number;
}) {
  const threshold = args.threshold ?? 0.05;

  if (!fs.existsSync(args.screenshotPath)) {
    throw new Error(`Screenshot not found: ${args.screenshotPath}`);
  }

  const client = new FigmaClient();
  const base64 = await client.exportImage(args.fileKey, args.nodeId, 2, 'png');

  // Write Figma reference to temp file
  const tmpDir = os.tmpdir();
  const figmaRefPath = path.join(tmpDir, `figma-ref-${args.nodeId.replace(/[^a-z0-9]/g, '_')}.png`);
  fs.writeFileSync(figmaRefPath, Buffer.from(base64, 'base64'));

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pixelmatch = require('pixelmatch') as (img1: Buffer, img2: Buffer, out: Buffer, w: number, h: number, opts?: object) => number;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { PNG } = require('pngjs') as typeof import('pngjs');

  const img1 = PNG.sync.read(fs.readFileSync(figmaRefPath));
  const img2 = PNG.sync.read(fs.readFileSync(args.screenshotPath));

  const width = Math.min(img1.width, img2.width);
  const height = Math.min(img1.height, img2.height);
  const diff = new PNG({ width, height });

  const pixelsDifferent = pixelmatch(img1.data, img2.data, diff.data, width, height, { threshold: 0.1 });
  const totalPixels = width * height;
  const mismatchRatio = pixelsDifferent / totalPixels;
  const passed = mismatchRatio <= threshold;
  const matchPercentage = ((1 - mismatchRatio) * 100).toFixed(2);

  const diffPath = path.join(tmpDir, `figma-diff-${args.nodeId.replace(/[^a-z0-9]/g, '_')}.png`);
  fs.writeFileSync(diffPath, PNG.sync.write(diff));
  const diffBase64 = fs.readFileSync(diffPath).toString('base64');

  const suggestions: string[] = [];
  if (!passed) {
    if (pixelsDifferent / totalPixels > 0.2) suggestions.push('Large layout difference detected — check flex/grid structure');
    else suggestions.push('Minor pixel differences — check font rendering or spacing tokens');
  }

  // Cleanup temp Figma ref
  fs.unlinkSync(figmaRefPath);

  return {
    matchPercentage: parseFloat(matchPercentage),
    pixelsDifferent,
    totalPixels,
    passed,
    diffImageBase64: diffBase64,
    suggestions,
  };
}
