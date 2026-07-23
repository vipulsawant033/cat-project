import { FigmaClient } from '../figma/client.js';
import { hashFigmaNode } from '../figma/content-hash.js';
import { getManifestEntry } from '../manifest/store.js';
import type { CodegenDetectDriftInput, CodegenDetectDriftOutput } from '../types.js';

/**
 * Core tool logic: fetches the Figma node fresh, content-hashes it, and
 * compares against the manifest entry recorded at last generation (see
 * generate_angular_component/generate_angular_page). This never calls
 * generate itself and never auto-regenerates — regenerating on drift is a
 * deliberate follow-up action, not something to trigger silently, since a
 * hash mismatch only tells you the *Figma* content changed, not what to do
 * about it (e.g. whether to also re-check component mappings first).
 */
export async function runCodegenDetectDrift(input: CodegenDetectDriftInput): Promise<CodegenDetectDriftOutput> {
  const client = new FigmaClient({ token: input.figmaToken });
  const { fileKey, nodeId, node } = await client.resolveNodeFromLink(input.figmaLink);

  const currentContentHash = hashFigmaNode(node);
  const entry = getManifestEntry(fileKey, nodeId);

  if (!entry) {
    return {
      fileKey,
      nodeId,
      nodeName: node.name,
      everGenerated: false,
      drifted: false,
      currentContentHash,
    };
  }

  return {
    fileKey,
    nodeId,
    nodeName: node.name,
    everGenerated: true,
    drifted: entry.figmaContentHash !== currentContentHash,
    currentContentHash,
    lastGeneratedContentHash: entry.figmaContentHash,
    lastGeneratedAt: entry.generatedAt,
    lastGeneratedKind: entry.kind,
    lastComponent: entry.component,
    lastSections: entry.sections,
    lastDiff: entry.lastDiff,
  };
}
