import { FigmaClient } from '../../services/figmaClient.js';
import { trimTree, buildBreadcrumb, flattenTree } from '../../parsers/figmaTreeParser.js';
import { measureSerialized } from '../../utils/responseSize.js';
import { saveNodeScreenshot } from './exportNodeImage.js';

export async function figmaGetNode(args: {
  fileKey: string;
  nodeId: string;
  depth?: number;
  forceRaw?: boolean;
  excludeScreenshot?: boolean;
}) {
  const client = new FigmaClient();
  const depth = args.depth ?? 3;

  const [result, screenshot] = await Promise.all([
    client.getNode(args.fileKey, args.nodeId, { depth }),
    args.excludeScreenshot
      ? Promise.resolve(null)
      : saveNodeScreenshot(client, args.fileKey, args.nodeId, 2, 'png').catch(() => ({ filePath: null, base64: '' })),
  ]);
  const nodeData = result.nodes[args.nodeId];

  if (!nodeData) throw new Error(`Node ${args.nodeId} not found`);

  // Get breadcrumb from full file
  let breadcrumb: string[] = [];
  try {
    const file = await client.getFile(args.fileKey);
    breadcrumb = buildBreadcrumb(file.document, args.nodeId) || [];
  } catch {
    // non-critical
  }

  const screenshotPath = screenshot?.filePath ?? null;

  if (args.forceRaw) {
    const trimmed = trimTree(nodeData.document, depth);
    return { nodeId: args.nodeId, breadcrumb, document: trimmed, screenshotPath, truncated: false };
  }

  for (const attemptDepth of [depth, Math.ceil(depth / 2), 1]) {
    const trimmed = trimTree(nodeData.document, attemptDepth);
    const candidate = { nodeId: args.nodeId, breadcrumb, document: trimmed, screenshotPath, truncated: false };
    if (!measureSerialized(candidate).exceeds) return candidate;
  }

  const outline = flattenTree(nodeData.document);
  return {
    nodeId: args.nodeId,
    breadcrumb,
    document: null,
    outline,
    screenshotPath,
    truncated: true,
    truncatedReason: 'response_size',
    note: 'Full node tree exceeded MCP_MAX_RESPONSE_CHARS; returned a structural outline instead. Use figma_get_node_outline for cheaper browsing, retry on a smaller child nodeId, or pass forceRaw:true to force the full (possibly-rejected) payload.',
  };
}
