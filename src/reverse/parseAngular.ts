/**
 * Angular component -> IR. The reliable way to recover *real* geometry (computed
 * flex, wrapping, resolved fonts/colors) is to RENDER the component and read the
 * live DOM, not to statically parse SCSS. We mount the provided rendered HTML in
 * headless Chromium, walk the DOM, and read getBoundingClientRect +
 * getComputedStyle for each element to build the IR.
 *
 * (Template structure/intent can additionally be recovered with
 * @angular/compiler parseTemplate; that AST is useful for naming and *ngFor
 * detection but is not required for geometry.)
 */

import type { Axis, IRDocument, IRNode, NodeKind } from "../ir/schema.js";

export interface ParseAngularInput {
  /** fully rendered HTML of the component (from a Storybook/dev server or SSR). */
  html: string;
  /** viewport width to render at */
  width: number;
  height?: number;
  screen: string;
  source: string;
}

/** Serializable snapshot captured in the browser for each element. */
interface DomSnapshot {
  tag: string;
  className: string;
  text: string | null;
  rect: { x: number; y: number; width: number; height: number };
  computed: Record<string, string>;
  children: DomSnapshot[];
}

function px(v: string): number {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function cssJustifyToIr(j: string): IRNode["layout"]["justify"] {
  switch (j) {
    case "center":
      return "center";
    case "flex-end":
    case "end":
      return "flex-end";
    case "space-between":
      return "space-between";
    case "space-around":
      return "space-around";
    default:
      return "flex-start";
  }
}
function cssTextAlign(a: string | undefined): NonNullable<IRNode["style"]["typography"]>["textAlign"] {
  switch (a) {
    case "center":
      return "center";
    case "right":
      return "right";
    case "justify":
      return "justify";
    default:
      return "left";
  }
}

function cssAlignToIr(a: string): IRNode["layout"]["align"] {
  switch (a) {
    case "center":
      return "center";
    case "flex-end":
    case "end":
      return "flex-end";
    case "stretch":
      return "stretch";
    default:
      return "flex-start";
  }
}

function snapshotToIR(s: DomSnapshot, parent?: DomSnapshot): IRNode {
  const c = s.computed;
  const isFlex = c["display"] === "flex" || c["display"] === "inline-flex";
  const direction: Axis = c["flex-direction"]?.startsWith("column") ? "column" : "row";
  const kind: NodeKind = s.tag === "img" ? "image" : s.text != null && s.children.length === 0 ? "text" : "frame";

  const parseShadow = (v: string) => {
    if (!v || v === "none") return [];
    // very small parser: "rgba(...) x y blur spread"
    const m = v.match(/(rgba?\([^)]+\)|#[0-9a-f]+)\s+(-?\d+)px\s+(-?\d+)px\s+(-?\d+)px(?:\s+(-?\d+)px)?/i);
    if (!m) return [];
    return [{ type: "drop-shadow" as const, color: m[1], x: px(m[2]), y: px(m[3]), blur: px(m[4]), spread: px(m[5] ?? "0") }];
  };

  return {
    id: `${s.tag}.${s.className}`.slice(0, 64),
    name: s.className || s.tag,
    kind,
    layout: {
      mode: isFlex ? "flex" : c["position"] === "absolute" ? "absolute" : "flex",
      direction,
      gap: px(c["gap"] ?? c["column-gap"] ?? "0"),
      padding: {
        top: px(c["padding-top"]),
        right: px(c["padding-right"]),
        bottom: px(c["padding-bottom"]),
        left: px(c["padding-left"]),
      },
      justify: cssJustifyToIr(c["justify-content"] ?? "flex-start"),
      align: cssAlignToIr(c["align-items"] ?? "flex-start"),
      wrap: (c["flex-wrap"] ?? "nowrap") === "wrap",
    },
    box: {
      x: parent ? s.rect.x - parent.rect.x : s.rect.x,
      y: parent ? s.rect.y - parent.rect.y : s.rect.y,
      width: Math.round(s.rect.width),
      height: Math.round(s.rect.height),
      grow: px(c["flex-grow"]) > 0,
      alignSelf: c["align-self"] === "stretch" ? "stretch" : undefined,
    },
    style: {
      fills: c["background-color"] && c["background-color"] !== "rgba(0, 0, 0, 0)" ? [{ type: "solid", color: c["background-color"] }] : [],
      strokes: px(c["border-top-width"]) > 0 ? [{ color: c["border-top-color"], width: px(c["border-top-width"]) }] : [],
      effects: parseShadow(c["box-shadow"]),
      cornerRadius: px(c["border-top-left-radius"]),
      opacity: px(c["opacity"] ?? "1"),
      typography:
        kind === "text"
          ? {
              fontFamily: (c["font-family"] ?? "sans-serif").split(",")[0].replace(/['"]/g, ""),
              fontSize: px(c["font-size"]),
              fontWeight: px(c["font-weight"] ?? "400"),
              lineHeight: c["line-height"] === "normal" ? "normal" : px(c["line-height"]),
              letterSpacing: c["letter-spacing"] === "normal" ? 0 : px(c["letter-spacing"]),
              textAlign: cssTextAlign(c["text-align"]),
              color: c["color"],
            }
          : undefined,
    },
    text: kind === "text" ? s.text ?? "" : undefined,
    children: s.children.map((ch) => snapshotToIR(ch, s)),
  };
}

export async function parseAngular(input: ParseAngularInput): Promise<IRDocument> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  let snapshot: DomSnapshot;
  try {
    const page = await browser.newPage({ viewport: { width: input.width, height: input.height ?? 800 } });
    await page.setContent(input.html, { waitUntil: "networkidle" });
    snapshot = (await page.evaluate(() => {
      const PROPS = [
        "display", "flex-direction", "gap", "column-gap", "justify-content", "align-items",
        "align-self", "flex-grow", "flex-wrap", "position",
        "padding-top", "padding-right", "padding-bottom", "padding-left",
        "background-color", "color", "opacity", "box-shadow",
        "border-top-width", "border-top-color", "border-top-left-radius",
        "font-family", "font-size", "font-weight", "line-height", "letter-spacing", "text-align",
      ];
      const walk = (el: Element): DomSnapshot => {
        const cs = getComputedStyle(el);
        const computed: Record<string, string> = {};
        for (const p of PROPS) computed[p] = cs.getPropertyValue(p);
        const r = el.getBoundingClientRect();
        const kids = Array.from(el.children);
        const directText = Array.from(el.childNodes)
          .filter((n) => n.nodeType === Node.TEXT_NODE)
          .map((n) => n.textContent?.trim())
          .filter(Boolean)
          .join(" ");
        return {
          tag: el.tagName.toLowerCase(),
          className: typeof el.className === "string" ? el.className.split(" ")[0] : "",
          text: directText || null,
          rect: { x: r.x, y: r.y, width: r.width, height: r.height },
          computed,
          children: kids.map(walk),
        };
      };
      const rootEl = document.body.firstElementChild ?? document.body;
      return walk(rootEl);
    })) as DomSnapshot;
  } finally {
    await browser.close();
  }

  return {
    screen: input.screen,
    source: input.source,
    root: snapshotToIR(snapshot),
    tokens: {},
  };
}
