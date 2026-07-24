import type { FigmaNode } from './types.js';

function isVisible(node: FigmaNode): boolean {
  return node.visible !== false;
}

function hasVisibleImageFill(node: FigmaNode): boolean {
  return !!node.fills?.some((p) => p.visible !== false && p.type === 'IMAGE');
}

/**
 * Walks the tree collecting every node with a visible IMAGE fill (e.g. a
 * RECTANGLE used as a photo/logo placeholder) so callers can export each as a
 * raster asset — mirrors icon-detector.ts's findIconRoots for vector subtrees.
 */
export function findImageFillNodes(node: FigmaNode, results: FigmaNode[] = []): FigmaNode[] {
  if (!isVisible(node)) return results;
  if (hasVisibleImageFill(node)) results.push(node);
  for (const child of node.children ?? []) {
    findImageFillNodes(child, results);
  }
  return results;
}
