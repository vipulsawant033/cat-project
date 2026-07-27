/**
 * Design-token extraction. Figma Variables/styles -> CSS custom properties.
 * Deterministic. Generated code references tokens (var(--x)) instead of literals
 * so themes stay swappable and F->A->F round-trips preserve token identity.
 */

import type { IRDocument, IRNode } from "../ir/schema.js";

/** Convert a Figma variable name like "color/brand/primary" to a CSS var name. */
export function toCssVarName(figmaName: string): string {
  return (
    "--" +
    figmaName
      .trim()
      .replace(/[\/\s]+/g, "-")
      .replace(/[^a-zA-Z0-9-]/g, "")
      .replace(/-+/g, "-")
      .toLowerCase()
  );
}

/**
 * Build the :root token block from a variable map (name -> value).
 * Returns both the CSS text and the name->value map for reuse in codegen.
 */
export function tokensToCss(variables: Record<string, { name: string; value: string }>): {
  css: string;
  map: Record<string, string>;
} {
  const map: Record<string, string> = {};
  const lines: string[] = [];
  for (const { name, value } of Object.values(variables)) {
    const cssName = toCssVarName(name);
    map[cssName] = value;
    lines.push(`  ${cssName}: ${value};`);
  }
  const css = `:root {\n${lines.sort().join("\n")}\n}\n`;
  return { css, map };
}

/**
 * Rewrite literal style values in an IR tree to token references where a literal
 * matches a known token value. This is what makes generated SCSS reference
 * tokens instead of hardcoded hex/px.
 */
export function applyTokensToIR(doc: IRDocument, tokenMap: Record<string, string>): IRDocument {
  const valueToVar = new Map<string, string>();
  for (const [varName, value] of Object.entries(tokenMap)) {
    valueToVar.set(value.toLowerCase(), `var(${varName})`);
  }
  const rewriteColor = (c: string): string => valueToVar.get(c.toLowerCase()) ?? c;

  const walk = (node: IRNode): void => {
    node.style.fills = node.style.fills.map((f) => ({ ...f, color: rewriteColor(f.color) }));
    node.style.strokes = node.style.strokes.map((s) => ({ ...s, color: rewriteColor(s.color) }));
    if (node.style.typography) {
      node.style.typography = { ...node.style.typography, color: rewriteColor(node.style.typography.color) };
    }
    node.children.forEach(walk);
  };
  walk(doc.root);
  doc.tokens = tokenMap;
  return doc;
}
