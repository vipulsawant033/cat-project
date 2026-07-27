/**
 * Figma REST node subtree -> IR. Fully deterministic (no LLM). The Dev Mode MCP
 * input path has its own normalizer that targets the same IR schema, so both
 * converge here.
 */

import type { FigmaNode } from "../figma/rest.js";
import { rgbaToCss } from "../figma/rest.js";
import {
  figmaModeToAxis,
  figmaPrimaryToJustify,
  figmaCounterToAlign,
} from "../layout/mapper.js";
import type {
  Box,
  Effect,
  Fill,
  FlexLayout,
  IRDocument,
  IRNode,
  NodeKind,
  Stroke,
  Style,
  Typography,
} from "./schema.js";

function kindOf(n: FigmaNode): NodeKind {
  switch (n.type) {
    case "TEXT":
      return "text";
    case "INSTANCE":
      return "instance";
    case "VECTOR":
    case "LINE":
    case "ELLIPSE":
    case "STAR":
    case "POLYGON":
      return "vector";
    case "RECTANGLE":
      // a rectangle with an image fill is an image; otherwise a styled box (frame-like)
      return n.fills?.some((f) => f.type === "IMAGE") ? "image" : "frame";
    default:
      return "frame";
  }
}

function paintToFill(p: NonNullable<FigmaNode["fills"]>[number]): Fill | null {
  if (p.visible === false) return null;
  if (p.type === "SOLID" && p.color) {
    return { type: "solid", color: rgbaToCss(p.color.r, p.color.g, p.color.b, p.color.a ?? 1), opacity: p.opacity };
  }
  if (p.type.startsWith("GRADIENT") && p.color) {
    return { type: "linear-gradient", color: rgbaToCss(p.color.r, p.color.g, p.color.b, p.color.a ?? 1) };
  }
  return null;
}

/**
 * Cross-check Figma's declared layoutMode against where its children actually sit.
 * The REST API can report a stale or incomplete layoutMode for frames using layout
 * features the classic auto-layout fields don't fully capture — trust the geometry
 * only when it's decisive (one axis' spread dominates the other by 3x+), so a normal
 * stack/row with uneven child sizes is never flipped by noise.
 */
function inferLayoutMismatch(
  n: FigmaNode
): { declared: "HORIZONTAL" | "VERTICAL"; actual: "HORIZONTAL" | "VERTICAL" } | null {
  if (n.layoutMode !== "HORIZONTAL" && n.layoutMode !== "VERTICAL") return null;
  const kids = (n.children ?? []).filter((c) => c.visible !== false && c.absoluteBoundingBox);
  if (kids.length < 2) return null;
  const centersX = kids.map((c) => c.absoluteBoundingBox!.x + c.absoluteBoundingBox!.width / 2);
  const centersY = kids.map((c) => c.absoluteBoundingBox!.y + c.absoluteBoundingBox!.height / 2);
  const spread = (vals: number[]) => Math.max(...vals) - Math.min(...vals);
  const xSpread = spread(centersX);
  const ySpread = spread(centersY);
  const DOMINANCE = 3;
  if (n.layoutMode === "VERTICAL" && xSpread > ySpread * DOMINANCE) {
    return { declared: "VERTICAL", actual: "HORIZONTAL" };
  }
  if (n.layoutMode === "HORIZONTAL" && ySpread > xSpread * DOMINANCE) {
    return { declared: "HORIZONTAL", actual: "VERTICAL" };
  }
  return null;
}

function toLayout(n: FigmaNode, warnings: string[]): FlexLayout {
  if (!n.layoutMode || n.layoutMode === "NONE") {
    return {
      mode: "absolute",
      direction: "row",
      gap: 0,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      justify: "flex-start",
      align: "flex-start",
      wrap: false,
    };
  }
  const mismatch = inferLayoutMismatch(n);
  const layoutMode = mismatch?.actual ?? n.layoutMode;
  if (mismatch) {
    warnings.push(
      `Node "${n.name}" (${n.id}) declares layoutMode: ${mismatch.declared}, but its children's bounding boxes ` +
        `indicate a ${mismatch.actual.toLowerCase()} arrangement — used ${mismatch.actual} for this frame instead. Verify visually.`
    );
  }
  return {
    mode: "flex",
    direction: figmaModeToAxis(layoutMode),
    gap: n.itemSpacing ?? 0,
    padding: {
      top: n.paddingTop ?? 0,
      right: n.paddingRight ?? 0,
      bottom: n.paddingBottom ?? 0,
      left: n.paddingLeft ?? 0,
    },
    justify: figmaPrimaryToJustify(n.primaryAxisAlignItems),
    // `n.layoutAlign` describes how *n itself* sits in its parent's layout (-> box.alignSelf
    // below); it says nothing about how n aligns its own children, so it must never feed
    // this container's align-items — only n's own counterAxisAlignItems does.
    align: figmaCounterToAlign(n.counterAxisAlignItems, false),
    wrap: n.layoutWrap === "WRAP",
  };
}

/**
 * Resolve a node's size on one axis from Figma's authoritative sizing model.
 * FILL -> "fill", HUG -> "auto", FIXED -> px. Falls back to older signals
 * (layoutGrow / sizing modes / bounding box) when layoutSizing* is absent.
 */
function sizeOnAxis(
  n: FigmaNode,
  parent: FigmaNode | undefined,
  axis: "h" | "v"
): number | "auto" | "fill" {
  const bb = n.absoluteBoundingBox;
  const px = axis === "h" ? bb?.width : bb?.height;
  const sizing = axis === "h" ? n.layoutSizingHorizontal : n.layoutSizingVertical;
  if (sizing === "FILL") return "fill";
  if (sizing === "HUG") return "auto";
  if (sizing === "FIXED") return px ?? "auto";

  // Fallback for files without layoutSizing*:
  if (axis === "h") {
    if ((n.layoutGrow ?? 0) > 0 && parent?.layoutMode === "HORIZONTAL") return "fill";
    if (n.layoutAlign === "STRETCH" && parent?.layoutMode === "VERTICAL") return "fill";
    if (n.primaryAxisSizingMode === "AUTO" && parent?.layoutMode === "HORIZONTAL") return "auto";
    return px ?? "auto";
  } else {
    if ((n.layoutGrow ?? 0) > 0 && parent?.layoutMode === "VERTICAL") return "fill";
    if (n.layoutAlign === "STRETCH" && parent?.layoutMode === "HORIZONTAL") return "fill";
    if (n.primaryAxisSizingMode === "AUTO" && parent?.layoutMode === "VERTICAL") return "auto";
    return px ?? "auto";
  }
}

function toBox(n: FigmaNode, parent?: FigmaNode): Box {
  const bb = n.absoluteBoundingBox;
  const pbb = parent?.absoluteBoundingBox;
  const grow = (n.layoutGrow ?? 0) > 0;
  return {
    x: bb && pbb ? bb.x - pbb.x : bb?.x ?? 0,
    y: bb && pbb ? bb.y - pbb.y : bb?.y ?? 0,
    width: sizeOnAxis(n, parent, "h"),
    height: sizeOnAxis(n, parent, "v"),
    grow,
    alignSelf: n.layoutAlign === "STRETCH" ? "stretch" : undefined,
  };
}

/** Parse Figma component/variant properties into clean prop keys. */
function toFigmaProps(n: FigmaNode): Record<string, string> | undefined {
  if (!n.componentProperties) return undefined;
  const props: Record<string, string> = {};
  for (const [rawKey, def] of Object.entries(n.componentProperties)) {
    // property names may carry a "#nodeId" suffix (e.g. "Label#12:3")
    const key = rawKey.split("#")[0].trim();
    const camel = key.charAt(0).toLowerCase() + key.slice(1).replace(/\s+/g, "");
    props[camel] = String(def.value);
  }
  return Object.keys(props).length ? props : undefined;
}

function toTypography(n: FigmaNode): Typography | undefined {
  if (!n.style) return undefined;
  const firstFill = n.fills?.find((f) => f.type === "SOLID" && f.color);
  const color =
    firstFill?.color != null
      ? rgbaToCss(firstFill.color.r, firstFill.color.g, firstFill.color.b, firstFill.color.a ?? 1)
      : "#000000";
  const alignMap = { LEFT: "left", CENTER: "center", RIGHT: "right", JUSTIFIED: "justify" } as const;
  return {
    fontFamily: n.style.fontFamily ?? "sans-serif",
    fontSize: n.style.fontSize ?? 16,
    fontWeight: n.style.fontWeight ?? 400,
    lineHeight: n.style.lineHeightPx ?? "normal",
    letterSpacing: n.style.letterSpacing ?? 0,
    textAlign: alignMap[n.style.textAlignHorizontal ?? "LEFT"],
    color,
  };
}

/**
 * Resolve which edge a node's stroke belongs on. Figma's per-edge weights
 * (`individualStrokeWeights`) win when present: a single non-zero edge means the
 * design intends a one-sided rule (e.g. a header divider), not a boxed border —
 * emitting the CSS `border` shorthand for that case turns dividers into boxes.
 */
function strokeSideAndWidth(n: FigmaNode): { side: NonNullable<Stroke["side"]>; width: number } {
  const iw = n.individualStrokeWeights;
  const fallback = n.strokeWeight ?? 1;
  if (!iw) return { side: "all", width: fallback };
  const sides: Array<[NonNullable<Stroke["side"]>, number]> = [
    ["top", iw.top ?? 0],
    ["right", iw.right ?? 0],
    ["bottom", iw.bottom ?? 0],
    ["left", iw.left ?? 0],
  ];
  const nonZero = sides.filter(([, w]) => w > 0);
  if (nonZero.length === 1) return { side: nonZero[0][0], width: nonZero[0][1] };
  return { side: "all", width: fallback };
}

function toStyle(n: FigmaNode): Style {
  const fills = (n.fills ?? []).map(paintToFill).filter((f): f is Fill => f !== null);
  const { side, width } = strokeSideAndWidth(n);
  const strokes: Stroke[] = (n.strokes ?? [])
    .map((p): Stroke | null =>
      p.color ? { color: rgbaToCss(p.color.r, p.color.g, p.color.b, p.color.a ?? 1), width, side } : null
    )
    .filter((s): s is Stroke => s !== null);
  const effects: Effect[] = (n.effects ?? [])
    .filter((e) => e.visible !== false && (e.type === "DROP_SHADOW" || e.type === "INNER_SHADOW"))
    .map((e) => ({
      type: e.type === "INNER_SHADOW" ? "inner-shadow" : "drop-shadow",
      x: e.offset?.x ?? 0,
      y: e.offset?.y ?? 0,
      blur: e.radius ?? 0,
      spread: e.spread ?? 0,
      color: e.color ? rgbaToCss(e.color.r, e.color.g, e.color.b, e.color.a ?? 1) : "rgba(0,0,0,0.25)",
    }));
  return {
    fills,
    strokes,
    effects,
    cornerRadius: n.rectangleCornerRadii ?? n.cornerRadius ?? 0,
    opacity: n.opacity ?? 1,
    typography: n.type === "TEXT" ? toTypography(n) : undefined,
  };
}

function normalizeNode(n: FigmaNode, parent: FigmaNode | undefined, warnings: string[]): IRNode {
  const kind = kindOf(n);
  return {
    id: n.id,
    name: n.name,
    kind,
    layout: toLayout(n, warnings),
    box: toBox(n, parent),
    style: toStyle(n),
    text: kind === "text" ? n.characters : undefined,
    imageRef: kind === "image" ? n.id : undefined,
    figmaProps: kind === "instance" ? toFigmaProps(n) : undefined,
    children: (n.children ?? [])
      .filter((c) => c.visible !== false)
      .map((c) => normalizeNode(c, n, warnings)),
  };
}

export interface NormalizeOptions {
  screen: string;
  source: string;
  /** token map (varId/name -> css value); may be empty */
  tokens?: Record<string, string>;
}

export function normalizeRest(root: FigmaNode, opts: NormalizeOptions): IRDocument {
  const warnings: string[] = [];
  const rootNode = normalizeNode(root, undefined, warnings);
  return {
    screen: opts.screen,
    source: opts.source,
    root: rootNode,
    tokens: opts.tokens ?? {},
    warnings: warnings.length ? warnings : undefined,
  };
}
