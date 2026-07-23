import { FigmaClient, parseFigmaUrl } from '../figma/client.js';
import type { FigmaNode } from '../figma/types.js';
import type { FigmaGetFileInput, FigmaGetFileOutput, FigmaNodeSummary } from '../types.js';

function summarize(node: FigmaNode, depth: number, maxDepth: number): FigmaNodeSummary {
  const children = (node.children ?? []).filter((c) => c.visible !== false);
  const summary: FigmaNodeSummary = {
    id: node.id,
    name: node.name,
    type: node.type,
    childCount: children.length,
  };
  if (children.length === 0) return summary;
  if (depth >= maxDepth) {
    summary.truncated = true;
    return summary;
  }
  summary.children = children.map((child) => summarize(child, depth + 1, maxDepth));
  return summary;
}

/** Core tool logic: Figma file link -> depth-limited document tree summary. */
export async function runFigmaGetFile(input: FigmaGetFileInput): Promise<FigmaGetFileOutput> {
  const client = new FigmaClient({ token: input.figmaToken });
  const { fileKey } = parseFigmaUrl(input.figmaLink);
  const file = await client.getFile(fileKey);

  return {
    fileKey,
    fileName: file.name,
    root: summarize(file.document, 0, input.maxDepth),
    componentCount: file.components ? Object.keys(file.components).length : 0,
    componentSetCount: file.componentSets ? Object.keys(file.componentSets).length : 0,
  };
}
