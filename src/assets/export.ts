/**
 * Asset export — the fix for "vectors render as solid colored blocks".
 *
 * Figma vector nodes (icons, logos) carry only paths, so codegen alone produces
 * empty <div>s. Here we find the right export boundaries and render them:
 *   - a vector leaf, OR a frame/group whose whole subtree is vectors (a multi-path
 *     logo/icon) -> ONE SVG for the boundary (crisp, themeable)
 *   - a raster image node -> PNG
 * The exported asset is attached to the IR node; codegen then inlines the SVG (or
 * references the raster) instead of emitting an empty box.
 */

import type { IRDocument, IRNode } from "../ir/schema.js";
import { getImageUrls, fetchText, type FigmaRestOptions } from "../figma/rest.js";

export interface ExportTarget {
  id: string;
  format: "svg" | "png";
}

/** Icon size ceiling (px). Vectors larger than this in both dimensions are treated
 * as data-viz/illustration, not icons — relevant to currentColor theming (#3). */
const ICON_MAX_PX = Number(process.env.FIGMA_ICON_MAX_PX ?? 64);

/**
 * True if the subtree is a self-contained GRAPHIC — only vectors and plain shape
 * containers (frames/rects), with at least one vector and NO text/image/instance.
 * This captures icons, logos AND charts (vector lines + rect bars), so the whole
 * region exports as ONE SVG and its inner div boxes are collapsed away (#4) —
 * fixing the "SVG polyline + leftover div rectangles" doubling.
 */
function isGraphicBoundary(node: IRNode): boolean {
  let hasVector = false;
  const shapesOnly = (n: IRNode): boolean => {
    if (n.kind === "text" || n.kind === "image" || n.kind === "instance") return false;
    if (n.kind === "vector") {
      hasVector = true;
      return true;
    }
    // frame / rectangle container — allowed if all its children are shapes too
    return n.children.every(shapesOnly);
  };
  const ok = node.children.length > 0 && node.children.every(shapesOnly);
  return ok && hasVector;
}

/** Numeric max dimension of a node, or Infinity if it hugs/fills (not icon-sized). */
export function maxDimension(node: IRNode): number {
  const w = typeof node.box.width === "number" ? node.box.width : Infinity;
  const h = typeof node.box.height === "number" ? node.box.height : Infinity;
  return Math.max(w, h);
}

/** Whether a node is small enough to be treated as an icon (for currentColor theming). */
export function isIconSized(node: IRNode): boolean {
  return maxDimension(node) <= ICON_MAX_PX;
}

/**
 * Walk the IR and pick export boundaries. A boundary is exported as a single asset
 * and treated as a leaf (its inner children are not emitted separately).
 */
export function collectExportTargets(doc: IRDocument): ExportTarget[] {
  const targets: ExportTarget[] = [];
  const walk = (node: IRNode): void => {
    if (node.asset || node.componentMatch) return; // already resolved / reused as a component
    if (node.kind === "image") {
      targets.push({ id: node.id, format: "png" });
      return;
    }
    if (node.kind === "vector" || (node.children.length > 0 && isGraphicBoundary(node))) {
      targets.push({ id: node.id, format: "svg" });
      return; // boundary — don't descend into its shapes
    }
    node.children.forEach(walk);
  };
  walk(doc.root);
  return targets;
}

/** Build an id -> node index for quick lookups during export. */
function indexById(doc: IRDocument): Map<string, IRNode> {
  const map = new Map<string, IRNode>();
  const walk = (n: IRNode) => {
    map.set(n.id, n);
    n.children.forEach(walk);
  };
  walk(doc.root);
  return map;
}

/** Attach exported assets (id -> asset) onto matching IR nodes; boundaries become leaves. */
export function attachAssets(doc: IRDocument, assets: Record<string, IRNode["asset"]>): number {
  let n = 0;
  const walk = (node: IRNode): void => {
    const a = assets[node.id];
    if (a) {
      node.asset = a;
      node.children = []; // exported boundary is a leaf now
      n++;
      return;
    }
    node.children.forEach(walk);
  };
  walk(doc.root);
  return n;
}

/** Export all vector/image boundaries in a screen via the Figma REST images endpoint. */
export async function exportAssetsViaRest(
  doc: IRDocument,
  fileKey: string,
  opts: FigmaRestOptions = {},
  themeIcons = true
): Promise<{ svg: number; png: number; themedIcons: number }> {
  const targets = collectExportTargets(doc);
  const svgIds = targets.filter((t) => t.format === "svg").map((t) => t.id);
  const pngIds = targets.filter((t) => t.format === "png").map((t) => t.id);

  const [svgUrls, pngUrls] = await Promise.all([
    getImageUrls(fileKey, svgIds, "svg", 2, opts),
    getImageUrls(fileKey, pngIds, "png", 2, opts),
  ]);

  const byId = indexById(doc);
  const assets: Record<string, IRNode["asset"]> = {};
  let themedIcons = 0;
  await Promise.all(
    Object.entries(svgUrls).map(async ([id, url]) => {
      // Only rewrite to currentColor for genuinely icon-sized vectors — large
      // data-viz strokes (chart trend lines) keep their exact design colors (#3).
      const node = byId.get(id);
      const allowTheme = themeIcons && (!node || isIconSized(node));
      const { svg, themed } = processSvg(await fetchText(url), allowTheme);
      if (themed) themedIcons++;
      assets[id] = { format: "svg", svg };
    })
  );
  for (const [id, url] of Object.entries(pngUrls)) assets[id] = { format: "png", url };

  attachAssets(doc, assets);
  return { svg: Object.keys(svgUrls).length, png: Object.keys(pngUrls).length, themedIcons };
}

/**
 * Raw <svg> tags default to `display: inline`, which renders on the text baseline —
 * inside a flex-centered wrapper this leaves the svg's own box sitting a few px below
 * the wrapper's box even though the wrapper itself is centered correctly. Force block
 * display on the tag itself so it fills its wrapper with no baseline offset.
 */
function withBlockDisplay(svg: string): string {
  return svg.replace(/<svg\b([^>]*)>/i, (full, attrs: string) => {
    const styleMatch = /\sstyle\s*=\s*"([^"]*)"/i.exec(attrs);
    if (styleMatch) {
      const merged = `${styleMatch[1].replace(/;\s*$/, "")}; display: block`;
      return `<svg${attrs.slice(0, styleMatch.index)} style="${merged}"${attrs.slice(styleMatch.index + styleMatch[0].length)}>`;
    }
    return `<svg${attrs} style="display: block">`;
  });
}

/** Strip XML prolog/comments so the SVG can be inlined directly in a template. */
function sanitizeSvg(svg: string): string {
  const cleaned = svg
    .replace(/<\?xml[^>]*\?>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim();
  return withBlockDisplay(cleaned);
}

/** A color value that shouldn't be counted or rewritten (structural, not a real color). */
function isStructuralColor(v: string): boolean {
  const c = v.trim().toLowerCase();
  return c === "" || c === "none" || c === "transparent" || c === "currentcolor" || c.startsWith("url(");
}

/** Distinct real colors used in fill/stroke (attributes and inline styles). */
function collectSvgColors(svg: string): Set<string> {
  const colors = new Set<string>();
  const attr = /(?:fill|stroke)\s*=\s*"([^"]*)"/gi;
  const style = /(?:fill|stroke)\s*:\s*([^;"'}\s]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = attr.exec(svg))) if (!isStructuralColor(m[1])) colors.add(m[1].trim().toLowerCase());
  while ((m = style.exec(svg))) if (!isStructuralColor(m[1])) colors.add(m[1].trim().toLowerCase());
  return colors;
}

/**
 * If an SVG uses a single color (a UI icon), rewrite its fills/strokes to
 * `currentColor` so it themes with CSS `color` (dark mode, hover, brand). If it
 * uses 2+ colors (a logo / multi-color art), leave it exactly as Figma exported.
 */
export function themeIfMonochrome(svg: string): { svg: string; themed: boolean } {
  if (collectSvgColors(svg).size > 1) return { svg, themed: false };
  let changed = false;
  const replaced = svg
    .replace(/((?:fill|stroke)\s*=\s*")([^"]*)(")/gi, (full, pre, val, post) => {
      if (isStructuralColor(val)) return full;
      changed = true;
      return `${pre}currentColor${post}`;
    })
    .replace(/((?:fill|stroke)\s*:\s*)([^;"'}\s]+)/gi, (full, pre, val) => {
      if (isStructuralColor(val)) return full;
      changed = true;
      return `${pre}currentColor`;
    });
  return { svg: replaced, themed: changed };
}

/** Sanitize an SVG and optionally make single-color icons themeable. */
export function processSvg(raw: string, themeIcons: boolean): { svg: string; themed: boolean } {
  const clean = sanitizeSvg(raw);
  return themeIcons ? themeIfMonochrome(clean) : { svg: clean, themed: false };
}
