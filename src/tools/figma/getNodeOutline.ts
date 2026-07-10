import { FigmaClient } from '../../services/figmaClient.js';
import { flattenTree } from '../../parsers/figmaTreeParser.js';

export async function figmaGetNodeOutline(args: { fileKey: string; nodeId: string; maxNodes?: number }) {
  const client = new FigmaClient();
  const result = await client.getNode(args.fileKey, args.nodeId);
  const nodeData = result.nodes[args.nodeId];
  if (!nodeData) throw new Error(`Node ${args.nodeId} not found`);

  const outline = flattenTree(nodeData.document);
  const maxNodes = args.maxNodes ?? 500;
  const truncated = outline.length > maxNodes;

  return {
    nodeId: args.nodeId,
    totalNodes: outline.length,
    outline: truncated ? outline.slice(0, maxNodes) : outline,
    truncated,
  };
}
