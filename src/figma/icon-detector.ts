import type { FigmaNode } from './types.js';

/**
 * Figma "vector network" leaf types — these carry raw path geometry that the
 * IR/codegen layer does not parse. Any subtree made up entirely of these
 * (a logo, a gauge glyph, a cog icon, etc.) has no meaningful DOM structure
 * of its own — it's a single visual asset and should be exported as one
 * flattened image/SVG rather than walked node-by-node into empty divs.
 */
const VECTOR_LEAF_TYPES = new Set(['VECTOR', 'BOOLEAN_OPERATION', 'STAR', 'LINE', 'REGULAR_POLYGON']);

function isVisible(node: FigmaNode): boolean {
  return node.visible !== false;
}

function isIconSubtree(node: FigmaNode): boolean {
  if (VECTOR_LEAF_TYPES.has(node.type)) return true;
  const children = (node.children ?? []).filter(isVisible);
  if (children.length === 0) return false;
  return children.every(isIconSubtree);
}

/**
 * Walks the tree top-down and collects the highest-level node of every
 * subtree that qualifies as an icon (per isIconSubtree), without recursing
 * further into a subtree once it has been claimed as a single icon — this
 * keeps e.g. a multi-path "cog" icon as one export instead of N.
 */
export function findIconRoots(node: FigmaNode, roots: FigmaNode[] = []): FigmaNode[] {
  if (!isVisible(node)) return roots;

  if (isIconSubtree(node)) {
    roots.push(node);
    return roots;
  }

  for (const child of node.children ?? []) {
    findIconRoots(child, roots);
  }

  return roots;
}
