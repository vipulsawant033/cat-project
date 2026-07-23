import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

export interface DiffRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  differingPixels: number;
}

export interface DiffResult {
  width: number;
  height: number;
  totalPixels: number;
  differingPixels: number;
  mismatchRatio: number;
  /** Coarse bounding boxes of where pixels differ, largest first — see clusterDiffRegions. */
  regions: DiffRegion[];
  /** True if more regions existed than MAX_REGIONS and the list below was capped. */
  regionsTruncated: boolean;
  /** The pixelmatch visualization (differing pixels in red), as a base64 PNG. */
  diffPngBase64: string;
  /** Present only if the two images didn't match exactly in size and had to be cropped to a common size first. */
  dimensionsAdjusted?: {
    reference: { width: number; height: number };
    actual: { width: number; height: number };
  };
}

const CELL_SIZE = 24;
const MIN_DIFFERING_PIXELS_PER_CELL = 6;
const MAX_REGIONS = 20;
const MAX_DIMENSION_SLACK = 4;

function cropPng(img: PNG, width: number, height: number): PNG {
  const out = new PNG({ width, height });
  PNG.bitblt(img, out, 0, 0, width, height, 0, 0);
  return out;
}

/**
 * Crops a PNG buffer to the given region. Used to trim a Figma reference
 * export (rendered at absoluteRenderBounds, which includes shadow/effect
 * bleed) down to just the node's layout box (absoluteBoundingBox) before
 * diffing against an element screenshot — which, like any browser element
 * screenshot, captures only the layout box and never box-shadow overflow.
 */
export function cropPngBuffer(buffer: Buffer, x: number, y: number, width: number, height: number): Buffer {
  const img = PNG.sync.read(buffer);
  const out = new PNG({ width, height });
  PNG.bitblt(img, out, Math.max(0, Math.round(x)), Math.max(0, Math.round(y)), Math.round(width), Math.round(height), 0, 0);
  return PNG.sync.write(out);
}

/**
 * Groups differing pixels (pixelmatch marks them with `diffColor`, pure red
 * here) into coarse bounding-box regions via a grid + flood-fill, so the
 * report reads as "these areas differ" instead of a wall of per-pixel noise.
 * Deliberately coarse (24px cells) rather than exact connected-component
 * labeling — good enough to point a human at the right area of the screen,
 * without the cost of pixel-exact region tracing.
 */
function clusterDiffRegions(diffPng: PNG, width: number, height: number): DiffRegion[] {
  const cols = Math.ceil(width / CELL_SIZE);
  const rows = Math.ceil(height / CELL_SIZE);
  const cellCounts = new Int32Array(cols * rows);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (width * y + x) * 4;
      if (diffPng.data[idx] === 255 && diffPng.data[idx + 1] === 0 && diffPng.data[idx + 2] === 0) {
        cellCounts[Math.floor(y / CELL_SIZE) * cols + Math.floor(x / CELL_SIZE)]++;
      }
    }
  }

  const hot = new Uint8Array(cols * rows);
  for (let i = 0; i < cellCounts.length; i++) {
    if (cellCounts[i] >= MIN_DIFFERING_PIXELS_PER_CELL) hot[i] = 1;
  }

  const visited = new Uint8Array(cols * rows);
  const regions: DiffRegion[] = [];

  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const start = cy * cols + cx;
      if (!hot[start] || visited[start]) continue;

      let minCx = cx;
      let maxCx = cx;
      let minCy = cy;
      let maxCy = cy;
      let differingPixels = 0;
      const stack = [start];
      visited[start] = 1;

      while (stack.length) {
        const idx = stack.pop()!;
        const x = idx % cols;
        const y = Math.floor(idx / cols);
        differingPixels += cellCounts[idx];
        minCx = Math.min(minCx, x);
        maxCx = Math.max(maxCx, x);
        minCy = Math.min(minCy, y);
        maxCy = Math.max(maxCy, y);

        const neighbors: [number, number][] = [
          [x - 1, y],
          [x + 1, y],
          [x, y - 1],
          [x, y + 1],
        ];
        for (const [nx, ny] of neighbors) {
          if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
          const nIdx = ny * cols + nx;
          if (hot[nIdx] && !visited[nIdx]) {
            visited[nIdx] = 1;
            stack.push(nIdx);
          }
        }
      }

      regions.push({
        x: minCx * CELL_SIZE,
        y: minCy * CELL_SIZE,
        width: Math.min((maxCx - minCx + 1) * CELL_SIZE, width - minCx * CELL_SIZE),
        height: Math.min((maxCy - minCy + 1) * CELL_SIZE, height - minCy * CELL_SIZE),
        differingPixels,
      });
    }
  }

  return regions.sort((a, b) => b.differingPixels - a.differingPixels);
}

/**
 * Compares two PNG buffers pixel-by-pixel. Requires equal dimensions to be
 * meaningful — a small (<=4px) mismatch is cropped to the common size and
 * flagged via `dimensionsAdjusted`; a larger mismatch throws, since cropping
 * would silently hide a real capture-setup problem (wrong viewport/scale)
 * rather than a genuine rendering difference.
 */
export function comparePngs(referencePng: Buffer, actualPng: Buffer, options: { pixelThreshold?: number } = {}): DiffResult {
  const reference = PNG.sync.read(referencePng);
  const actual = PNG.sync.read(actualPng);

  let refImg: PNG = reference;
  let actImg: PNG = actual;
  let dimensionsAdjusted: DiffResult['dimensionsAdjusted'];

  if (reference.width !== actual.width || reference.height !== actual.height) {
    const widthDiff = Math.abs(reference.width - actual.width);
    const heightDiff = Math.abs(reference.height - actual.height);
    if (widthDiff > MAX_DIMENSION_SLACK || heightDiff > MAX_DIMENSION_SLACK) {
      throw new Error(
        `Reference image (${reference.width}x${reference.height}) and screenshot (${actual.width}x${actual.height}) ` +
          'differ too much in size to diff meaningfully. Check the Figma export scale is 1 and the capture ' +
          'viewport width matches the frame width.'
      );
    }
    const width = Math.min(reference.width, actual.width);
    const height = Math.min(reference.height, actual.height);
    refImg = cropPng(reference, width, height);
    actImg = cropPng(actual, width, height);
    dimensionsAdjusted = {
      reference: { width: reference.width, height: reference.height },
      actual: { width: actual.width, height: actual.height },
    };
  }

  const { width, height } = refImg;
  const diffPng = new PNG({ width, height });

  const differingPixels = pixelmatch(refImg.data, actImg.data, diffPng.data, width, height, {
    threshold: options.pixelThreshold ?? 0.1,
    diffColor: [255, 0, 0],
    aaColor: [255, 255, 0],
    includeAA: false,
  });

  const regions = clusterDiffRegions(diffPng, width, height);

  return {
    width,
    height,
    totalPixels: width * height,
    differingPixels,
    mismatchRatio: differingPixels / (width * height),
    regions: regions.slice(0, MAX_REGIONS),
    regionsTruncated: regions.length > MAX_REGIONS,
    diffPngBase64: PNG.sync.write(diffPng).toString('base64'),
    dimensionsAdjusted,
  };
}
