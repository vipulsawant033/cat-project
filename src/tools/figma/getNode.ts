import { FigmaClient } from '../../services/figmaClient.js';
import { trimTree, buildBreadcrumb } from '../../parsers/figmaTreeParser.js';

export async function figmaGetNode(args: { fileKey: string; nodeId: string; depth?: number }) {
  const client = new FigmaClient();
  const depth = args.depth ?? 3;
  const result = await client.getNode(args.fileKey, args.nodeId);
  const nodeData = result.nodes[args.nodeId];

  if (!nodeData) throw new Error(`Node ${args.nodeId} not found`);

  const trimmed = trimTree(nodeData.document, depth);

  // Get breadcrumb from full file
  let breadcrumb: string[] = [];
  try {
    const file = await client.getFile(args.fileKey);
    breadcrumb = buildBreadcrumb(file.document, args.nodeId) || [];
  } catch {
    // non-critical
  }

  return {
    nodeId: args.nodeId,
    breadcrumb,
    document: trimmed,
  };
}
