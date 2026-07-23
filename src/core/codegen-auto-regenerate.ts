import { FigmaClient } from '../figma/client.js';
import { hashFigmaNode } from '../figma/content-hash.js';
import { getManifestEntry } from '../manifest/store.js';
import { runCodegenDiff } from './codegen-diff.js';
import { runCodegenValidate } from './codegen-validate.js';
import type { CodegenAutoRegenerateInput, CodegenAutoRegenerateOutput } from '../types.js';

/**
 * Core tool logic: the efficient, repeatable "closed loop" entry point.
 *
 * Since generation is deterministic, there's nothing to gain from retrying
 * internally — so this does exactly one round:
 *   1. Unless `force`, check the manifest (via the node's content hash) and
 *      short-circuit if nothing has changed since a passing generation.
 *   2. Otherwise regenerate + diff (codegen_diff's exact pipeline, which
 *      also records the fresh result to the manifest).
 *   3. If it still fails, also run codegen_validate and bundle its unmapped-
 *      instance list into the response — the concrete "what to fix next"
 *      an agent (or human) needs before calling this again.
 */
export async function runCodegenAutoRegenerate(
  input: CodegenAutoRegenerateInput
): Promise<CodegenAutoRegenerateOutput> {
  const client = new FigmaClient({ token: input.figmaToken });
  const { fileKey, nodeId, node } = await client.resolveNodeFromLink(input.figmaLink);

  if (!input.force) {
    const entry = getManifestEntry(fileKey, nodeId);
    if (entry && entry.figmaContentHash === hashFigmaNode(node) && entry.lastDiff?.passed) {
      return {
        source: { fileKey, nodeId, nodeName: node.name },
        skipped: true,
        reason:
          'Figma content is unchanged since the last generation, and it already passed its last pixel-diff ' +
          'check — nothing to do. Pass force:true to regenerate and re-check anyway.',
        passed: true,
        mismatchRatio: entry.lastDiff.mismatchRatio,
        maxMismatchRatio: entry.lastDiff.maxMismatchRatio,
      };
    }
  }

  const diff = await runCodegenDiff({
    figmaLink: input.figmaLink,
    figmaToken: input.figmaToken,
    maxMismatchRatio: input.maxMismatchRatio,
    pixelThreshold: input.pixelThreshold,
    includeDiffImage: input.includeDiffImage,
  });

  const output: CodegenAutoRegenerateOutput = {
    source: diff.source,
    skipped: false,
    reason: diff.passed
      ? 'Regenerated and passed the pixel-diff check.'
      : 'Regenerated but still exceeds maxMismatchRatio. See unmappedInstances and regions below for what to ' +
        'fix next (e.g. lib_map_figma_to_component for any unmapped instances), then call this again.',
    passed: diff.passed,
    mismatchRatio: diff.mismatchRatio,
    maxMismatchRatio: diff.maxMismatchRatio,
    regions: diff.regions,
    regionsTruncated: diff.regionsTruncated,
    diffImageBase64: diff.diffImageBase64,
    previewUrl: diff.previewUrl,
  };

  if (!diff.passed) {
    const validation = await runCodegenValidate({ figmaLink: input.figmaLink, figmaToken: input.figmaToken });
    output.totalInstances = validation.totalInstances;
    output.mappedInstances = validation.mappedInstances;
    output.unmappedInstances = validation.unmappedInstances;
  }

  return output;
}
