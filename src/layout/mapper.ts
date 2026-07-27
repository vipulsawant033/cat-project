/**
 * Bidirectional layout mapping table — the single source of truth for
 * Figma auto-layout <-> CSS flexbox. Direction 1 uses the figma->flex halves;
 * Direction 2 (A->F) uses the flex->figma halves. Kept together so the two
 * directions can never drift, and so `flex -> figma -> flex` is an identity
 * (unit-tested).
 */

import type { Axis, FlexLayout } from "../ir/schema.js";

export type FigmaPrimaryAlign = "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN";
export type FigmaCounterAlign = "MIN" | "CENTER" | "MAX";
export type CssJustify = FlexLayout["justify"];
export type CssAlign = FlexLayout["align"];

// ---- primary axis (Figma) -> justify-content (CSS) ----
const PRIMARY_TO_JUSTIFY: Record<FigmaPrimaryAlign, CssJustify> = {
  MIN: "flex-start",
  CENTER: "center",
  MAX: "flex-end",
  SPACE_BETWEEN: "space-between",
};
const JUSTIFY_TO_PRIMARY: Record<CssJustify, FigmaPrimaryAlign> = {
  "flex-start": "MIN",
  center: "CENTER",
  "flex-end": "MAX",
  "space-between": "SPACE_BETWEEN",
  // CSS has extras Figma lacks; map to the nearest Figma concept
  "space-around": "SPACE_BETWEEN",
};

// ---- counter axis (Figma) -> align-items (CSS) ----
const COUNTER_TO_ALIGN: Record<FigmaCounterAlign, CssAlign> = {
  MIN: "flex-start",
  CENTER: "center",
  MAX: "flex-end",
};
const ALIGN_TO_COUNTER: Record<CssAlign, FigmaCounterAlign> = {
  "flex-start": "MIN",
  center: "CENTER",
  "flex-end": "MAX",
  stretch: "MIN", // Figma expresses stretch via counterAxisSizingMode, not align
};

export function figmaModeToAxis(mode: "HORIZONTAL" | "VERTICAL"): Axis {
  return mode === "HORIZONTAL" ? "row" : "column";
}
export function axisToFigmaMode(axis: Axis): "HORIZONTAL" | "VERTICAL" {
  return axis === "row" ? "HORIZONTAL" : "VERTICAL";
}

export function figmaPrimaryToJustify(a: FigmaPrimaryAlign | undefined): CssJustify {
  return PRIMARY_TO_JUSTIFY[a ?? "MIN"];
}
export function justifyToFigmaPrimary(j: CssJustify): FigmaPrimaryAlign {
  return JUSTIFY_TO_PRIMARY[j];
}

export function figmaCounterToAlign(
  a: FigmaCounterAlign | undefined,
  counterAxisStretch: boolean
): CssAlign {
  if (counterAxisStretch) return "stretch";
  return COUNTER_TO_ALIGN[a ?? "MIN"];
}
export function alignToFigmaCounter(a: CssAlign): FigmaCounterAlign {
  return ALIGN_TO_COUNTER[a];
}

/**
 * CSS shorthand for a FlexLayout — used by the codegen emitter so the mapping
 * lives in exactly one place.
 */
export function flexLayoutToCss(l: FlexLayout): Record<string, string> {
  if (l.mode === "absolute") {
    return { position: "relative" }; // container; children get position:absolute
  }
  const css: Record<string, string> = {
    display: "flex",
    "flex-direction": l.direction,
  };
  if (l.gap) css["gap"] = `${l.gap}px`;
  const { top, right, bottom, left } = l.padding;
  if (top || right || bottom || left) {
    css["padding"] = `${top}px ${right}px ${bottom}px ${left}px`;
  }
  if (l.justify !== "flex-start") css["justify-content"] = l.justify;
  if (l.align !== "flex-start") css["align-items"] = l.align;
  if (l.wrap) css["flex-wrap"] = "wrap";
  return css;
}
