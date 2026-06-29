import { FigmaClient } from '../../services/figmaClient.js';
import { trimTree, countNodes } from '../../parsers/figmaTreeParser.js';

export async function figmaGetFile(args: { fileKey: string; includeComponents?: boolean }) {
  const client = new FigmaClient();
  const file = await client.getFile(args.fileKey);

  const trimmed = trimTree(file.document, 5);
  const nodeCount = countNodes(file.document);

  return {
    name: file.name,
    lastModified: file.lastModified,
    version: file.version,
    nodeCount,
    document: trimmed,
    ...(args.includeComponents ? {
      components: file.components,
      componentSets: file.componentSets,
    } : {}),
    styles: file.styles,
  };
}
