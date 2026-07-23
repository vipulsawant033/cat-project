import { FigmaClient } from '../figma/client.js';
import type { FigmaGetNodeInput, FigmaGetNodeOutput } from '../types.js';

/** Core tool logic: Figma share link -> the single raw FigmaNode it points to. */
export async function runFigmaGetNode(input: FigmaGetNodeInput): Promise<FigmaGetNodeOutput> {
  const client = new FigmaClient({ token: input.figmaToken });
  const { fileKey, nodeId, fileName, node } = await client.resolveNodeFromLink(input.figmaLink);

  return { fileKey, nodeId, fileName, node };
}
