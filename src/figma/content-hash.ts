import { createHash } from 'node:crypto';

/**
 * Deterministic JSON stringify (object keys sorted recursively) so the same
 * Figma node always hashes to the same value regardless of incidental key
 * ordering differences between API responses.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

/**
 * Content-hashes a raw Figma node (its full subtree) for design-drift
 * detection — two hashes matching means "this node's content hasn't changed
 * since we last generated it", independent of Figma's own file-level
 * `version` field, which only has file granularity and doesn't reliably
 * reflect whether *this specific node* changed.
 */
export function hashFigmaNode(node: unknown): string {
  return createHash('sha256').update(stableStringify(node)).digest('hex').slice(0, 16);
}
