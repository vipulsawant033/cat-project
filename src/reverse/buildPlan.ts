/**
 * IR -> Figma build plan (JSON). The plan is a serializable description of the
 * node tree the Figma plugin will create via the Plugin API. Uses the reverse
 * halves of the shared layout mapper so `flex -> figma -> flex` is an identity.
 *
 * The plan is transport-agnostic JSON; figma_apply_plan ships it to the plugin
 * over the WebSocket bridge (the only write path into Figma — REST can't create
 * nodes).
 */

import type { IRDocument, IRNode } from "../ir/schema.js";
import {
  alignToFigmaCounter,
  axisToFigmaMode,
  justifyToFigmaPrimary,
} from "../layout/mapper.js";

export interface FigmaPlanNode {
  type: "FRAME" | "TEXT" | "RECTANGLE" | "INSTANCE";
  name: string;
  // geometry
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  // auto-layout
  layoutMode?: "NONE" | "HORIZONTAL" | "VERTICAL";
  itemSpacing?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  primaryAxisAlignItems?: string;
  counterAxisAlignItems?: string;
  layoutGrow?: number;
  layoutAlign?: string;
  // style
  fills?: Array<{ r: number; g: number; b: number; a: number }>;
  cornerRadius?: number;
  strokeWeight?: number;
  strokes?: Array<{ r: number; g: number; b: number; a: number }>;
  effects?: Array<{ type: string; offset: { x: number; y: number }; radius: number; spread: number; color: { r: number; g: number; b: number; a: number } }>;
  // text
  characters?: string;
  fontSize?: number;
  fontName?: { family: string; style: string };
  // variable bindings: figma property -> css var name (resolved by plugin against a var map)
  boundVariables?: Record<string, string>;
  // reuse: instantiate an existing Figma component instead of building a frame
  componentKey?: string;
  children?: FigmaPlanNode[];
}

export interface FigmaBuildPlan {
  screen: string;
  /** css var name -> value, so the plugin can create/bind Figma Variables */
  tokens: Record<string, string>;
  root: FigmaPlanNode;
}

function cssColorToRgba(css: string): { r: number; g: number; b: number; a: number } | null {
  const hex = css.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255, a: 1 };
  }
  const rgba = css.match(/rgba?\(([^)]+)\)/i);
  if (rgba) {
    const parts = rgba[1].split(",").map((p) => parseFloat(p.trim()));
    return { r: parts[0] / 255, g: parts[1] / 255, b: parts[2] / 255, a: parts[3] ?? 1 };
  }
  return null; // var(--x) or gradient — plugin resolves via boundVariables/tokens
}

function fontStyleName(weight: number): string {
  if (weight >= 700) return "Bold";
  if (weight >= 600) return "SemiBold";
  if (weight >= 500) return "Medium";
  return "Regular";
}

function planNode(node: IRNode): FigmaPlanNode {
  // Reuse: matched Figma component -> instance.
  if (node.componentMatch) {
    return { type: "INSTANCE", name: node.name, componentKey: node.componentMatch.target };
  }

  const bound: Record<string, string> = {};
  const firstFill = node.style.fills[0];
  const fillColor = firstFill ? cssColorToRgba(firstFill.color) : null;
  if (firstFill && !fillColor && firstFill.color.startsWith("var(")) {
    bound["fills"] = firstFill.color.replace(/^var\(|\)$/g, "");
  }

  if (node.kind === "text") {
    const t = node.style.typography;
    const textColor = t ? cssColorToRgba(t.color) : null;
    return {
      type: "TEXT",
      name: node.name,
      characters: node.text ?? "",
      fontSize: t?.fontSize ?? 16,
      fontName: { family: t?.fontFamily ?? "Inter", style: fontStyleName(t?.fontWeight ?? 400) },
      fills: textColor ? [textColor] : undefined,
      boundVariables: t && !textColor && t.color.startsWith("var(") ? { fills: t.color.replace(/^var\(|\)$/g, "") } : undefined,
    };
  }

  const isFlex = node.layout.mode === "flex";
  const plan: FigmaPlanNode = {
    type: node.kind === "image" ? "RECTANGLE" : "FRAME",
    name: node.name,
    width: typeof node.box.width === "number" ? node.box.width : undefined,
    height: typeof node.box.height === "number" ? node.box.height : undefined,
    x: node.layout.mode === "absolute" ? node.box.x : undefined,
    y: node.layout.mode === "absolute" ? node.box.y : undefined,
    layoutMode: isFlex ? axisToFigmaMode(node.layout.direction) : "NONE",
    itemSpacing: isFlex ? node.layout.gap : undefined,
    paddingTop: isFlex ? node.layout.padding.top : undefined,
    paddingRight: isFlex ? node.layout.padding.right : undefined,
    paddingBottom: isFlex ? node.layout.padding.bottom : undefined,
    paddingLeft: isFlex ? node.layout.padding.left : undefined,
    primaryAxisAlignItems: isFlex ? justifyToFigmaPrimary(node.layout.justify) : undefined,
    counterAxisAlignItems: isFlex ? alignToFigmaCounter(node.layout.align) : undefined,
    layoutGrow: node.box.grow ? 1 : undefined,
    layoutAlign: node.box.alignSelf === "stretch" ? "STRETCH" : undefined,
    fills: fillColor ? [fillColor] : undefined,
    cornerRadius: typeof node.style.cornerRadius === "number" ? node.style.cornerRadius : undefined,
    strokes: node.style.strokes[0] ? [cssColorToRgba(node.style.strokes[0].color) ?? { r: 0, g: 0, b: 0, a: 1 }] : undefined,
    strokeWeight: node.style.strokes[0]?.width,
    effects: node.style.effects.map((e) => ({
      type: e.type === "inner-shadow" ? "INNER_SHADOW" : "DROP_SHADOW",
      offset: { x: e.x, y: e.y },
      radius: e.blur,
      spread: e.spread,
      color: cssColorToRgba(e.color) ?? { r: 0, g: 0, b: 0, a: 0.25 },
    })),
    boundVariables: Object.keys(bound).length ? bound : undefined,
    children: node.children.map(planNode),
  };
  return plan;
}

export function buildFigmaPlan(doc: IRDocument): FigmaBuildPlan {
  return { screen: doc.screen, tokens: doc.tokens, root: planNode(doc.root) };
}
