import { FigmaClient } from '../figma/client.js';
import { runGenerateAngularComponent } from './generate-angular-component.js';
import { captureElementScreenshot } from '../visual/screenshot.js';
import { comparePngs, cropPngBuffer } from '../visual/diff.js';
import { recordDiffResult } from '../manifest/store.js';
import type { CodegenDiffInput, CodegenDiffOutput } from '../types.js';

/**
 * Core tool logic: generate + serve the component (reusing the exact same
 * pipeline as generate_angular_component), screenshot it live via Playwright,
 * fetch Figma's own PNG export as the ground truth, and pixel-diff the two.
 * This is what turns "pixel perfect" into a measurable pass/fail instead of
 * an eyeballed comparison.
 */
export async function runCodegenDiff(input: CodegenDiffInput): Promise<CodegenDiffOutput> {
  const generation = await runGenerateAngularComponent({
    figmaLink: input.figmaLink,
    figmaToken: input.figmaToken,
    serve: true,
    writeToDisk: false,
  });

  if (!generation.preview?.url) {
    throw new Error(
      `Could not get a live preview to screenshot (status: ${generation.preview?.status ?? 'none'}). ` +
        (generation.preview?.message ?? 'Run `npm run preview:setup` once, then try again.')
    );
  }
  const previewUrl = generation.preview.url;

  const client = new FigmaClient({ token: input.figmaToken });
  const { node } = await client.resolveNodeFromLink(input.figmaLink);
  const box = node.absoluteBoundingBox;
  const width = Math.round(box?.width ?? 0);
  const height = Math.round(box?.height ?? 0);
  if (!box || !width || !height) {
    throw new Error('Figma node has no absoluteBoundingBox — cannot determine capture dimensions for diffing');
  }

  const [referencePngs, actualPng] = await Promise.all([
    client.exportPngBytes(generation.source.fileKey, [generation.source.nodeId], 1),
    captureElementScreenshot(previewUrl, generation.component.selector, width, height),
  ]);

  let referencePng = referencePngs[generation.source.nodeId];
  if (!referencePng) {
    throw new Error('Figma returned no exportable reference image for this node');
  }

  // Figma renders the export to absoluteRenderBounds (geometry + effects bleed, e.g. drop shadows),
  // which can be larger than absoluteBoundingBox (the layout box) — crop down to the layout box so
  // this compares the same region an element screenshot captures (screenshots never include
  // box-shadow overflow, since it doesn't affect the element's own box).
  const renderBounds = node.absoluteRenderBounds;
  if (renderBounds && (renderBounds.width !== box.width || renderBounds.height !== box.height)) {
    referencePng = cropPngBuffer(referencePng, box.x - renderBounds.x, box.y - renderBounds.y, width, height);
  }

  const diff = comparePngs(referencePng, actualPng, { pixelThreshold: input.pixelThreshold });
  const passed = diff.mismatchRatio <= input.maxMismatchRatio;

  recordDiffResult(generation.source.fileKey, generation.source.nodeId, {
    mismatchRatio: diff.mismatchRatio,
    maxMismatchRatio: input.maxMismatchRatio,
    passed,
    checkedAt: new Date().toISOString(),
  });

  return {
    source: { fileKey: generation.source.fileKey, nodeId: generation.source.nodeId, nodeName: generation.source.nodeName },
    width: diff.width,
    height: diff.height,
    totalPixels: diff.totalPixels,
    differingPixels: diff.differingPixels,
    mismatchRatio: diff.mismatchRatio,
    maxMismatchRatio: input.maxMismatchRatio,
    passed,
    regions: diff.regions,
    regionsTruncated: diff.regionsTruncated,
    dimensionsAdjusted: diff.dimensionsAdjusted,
    diffImageBase64: input.includeDiffImage ? diff.diffPngBase64 : undefined,
    previewUrl,
  };
}
