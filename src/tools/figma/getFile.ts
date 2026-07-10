import { FigmaClient } from '../../services/figmaClient.js';
import { trimTree, countNodes, flattenTree } from '../../parsers/figmaTreeParser.js';
import { measureSerialized } from '../../utils/responseSize.js';

const DEFAULT_DEPTH = 5;

export async function figmaGetFile(args: { fileKey: string; includeComponents?: boolean; forceRaw?: boolean }) {
  const client = new FigmaClient();
  const file = await client.getFile(args.fileKey, { depth: DEFAULT_DEPTH });
  const nodeCount = countNodes(file.document);

  const extras = args.includeComponents ? { components: file.components, componentSets: file.componentSets } : {};
  const base = { name: file.name, lastModified: file.lastModified, version: file.version, nodeCount, styles: file.styles, ...extras };

  if (args.forceRaw) {
    return { ...base, document: trimTree(file.document, DEFAULT_DEPTH), truncated: false };
  }

  for (const attemptDepth of [DEFAULT_DEPTH, Math.ceil(DEFAULT_DEPTH / 2), 1]) {
    const trimmed = trimTree(file.document, attemptDepth);
    const candidate = { ...base, document: trimmed, truncated: false };
    if (!measureSerialized(candidate).exceeds) return candidate;
  }

  return {
    ...base,
    document: null,
    outline: flattenTree(file.document),
    truncated: true,
    truncatedReason: 'response_size',
    note: 'Full file tree exceeded MCP_MAX_RESPONSE_CHARS; returned a structural outline instead. Use figma_get_node_outline on a specific frame for cheaper browsing, or pass forceRaw:true to force the full (possibly-rejected) payload.',
  };
}
