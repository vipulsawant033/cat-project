import { FigmaNode } from '../services/figmaClient.js';

export interface FlatNode {
  id: string;
  name: string;
  type: string;
  depth: number;
  path: string[];
  hasChildren: boolean;
  childCount: number;
}

export function trimTree(node: FigmaNode, maxDepth: number, currentDepth = 0): FigmaNode {
  if (currentDepth >= maxDepth) {
    const { children: _, ...rest } = node;
    return { ...rest, children: undefined };
  }
  return {
    ...node,
    children: node.children?.map(child => trimTree(child, maxDepth, currentDepth + 1)),
  };
}

export function countNodes(node: FigmaNode): number {
  let count = 1;
  for (const child of node.children || []) {
    count += countNodes(child);
  }
  return count;
}

export function flattenTree(node: FigmaNode, depth = 0, path: string[] = []): FlatNode[] {
  const currentPath = [...path, node.name];
  const flat: FlatNode[] = [{
    id: node.id,
    name: node.name,
    type: node.type,
    depth,
    path: currentPath,
    hasChildren: !!(node.children?.length),
    childCount: node.children?.length || 0,
  }];
  for (const child of node.children || []) {
    flat.push(...flattenTree(child, depth + 1, currentPath));
  }
  return flat;
}

export function findNodeById(root: FigmaNode, targetId: string): FigmaNode | null {
  if (root.id === targetId) return root;
  for (const child of root.children || []) {
    const found = findNodeById(child, targetId);
    if (found) return found;
  }
  return null;
}

export function buildBreadcrumb(root: FigmaNode, targetId: string, path: string[] = []): string[] | null {
  if (root.id === targetId) return [...path, root.name];
  for (const child of root.children || []) {
    const found = buildBreadcrumb(child, targetId, [...path, root.name]);
    if (found) return found;
  }
  return null;
}
