/**
 * Intermediate Representation (IR).
 *
 * The single model that BOTH directions and BOTH input paths converge on:
 *   Figma REST / Dev Mode MCP  --normalize-->  IR  --codegen-->  Angular
 *   Angular (render + measure)  --normalize-->  IR  --build-plan-->  Figma
 *
 * Keeping one schema in the middle is what makes validation and round-trip
 * diffing meaningful. The IR is deliberately framework-neutral: it describes
 * *layout intent* (flex model) + *visual style* + *content*, never Angular- or
 * Figma-specific concepts.
 */

export type Axis = "row" | "column";

/** Flex alignment, expressed in CSS terms; the layout mapper converts to/from Figma auto-layout. */
export interface FlexLayout {
  mode: "flex" | "absolute";
  direction: Axis;
  /** gap in px (Figma itemSpacing) */
  gap: number;
  padding: { top: number; right: number; bottom: number; left: number };
  /** CSS justify-content (main axis) */
  justify: "flex-start" | "center" | "flex-end" | "space-between" | "space-around";
  /** CSS align-items (cross axis) */
  align: "flex-start" | "center" | "flex-end" | "stretch";
  wrap: boolean;
}

export interface Box {
  /** absolute position (only meaningful for mode: "absolute") */
  x: number;
  y: number;
  width: number | "auto" | "fill";
  height: number | "auto" | "fill";
  /** flex-grow: node fills available main-axis space (Figma layoutGrow) */
  grow: boolean;
  /** align-self override (Figma layoutAlign STRETCH) */
  alignSelf?: "stretch" | "auto";
}

export interface Fill {
  type: "solid" | "linear-gradient";
  /** css color string; may be a token reference like "var(--color-primary)" */
  color: string;
  opacity?: number;
}

export interface Stroke {
  color: string;
  width: number;
  /** which edge this weight/color applies to; "all" (default) -> CSS `border` shorthand */
  side?: "top" | "right" | "bottom" | "left" | "all";
}

export interface Effect {
  type: "drop-shadow" | "inner-shadow";
  x: number;
  y: number;
  blur: number;
  spread: number;
  color: string;
}

export interface Typography {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: number | "normal";
  letterSpacing: number;
  textAlign: "left" | "center" | "right" | "justify";
  color: string;
}

export interface Style {
  fills: Fill[];
  strokes: Stroke[];
  effects: Effect[];
  cornerRadius: number | [number, number, number, number];
  opacity: number;
  /** present only for text nodes */
  typography?: Typography;
}

export type NodeKind = "frame" | "text" | "image" | "vector" | "instance";

export interface IRNode {
  /** stable id (Figma node id or generated dom path) */
  id: string;
  /** original Figma layer name / dom tag+class, used for semantic naming & reuse matching */
  name: string;
  kind: NodeKind;
  layout: FlexLayout;
  box: Box;
  style: Style;
  /** text content for kind === "text" */
  text?: string;
  /** for kind === "image": a ref the codegen resolves to an asset path */
  imageRef?: string;
  /**
   * Exported asset for vector/icon/logo and image nodes, populated by
   * figma_export_assets. Without this, vectors render as empty boxes (the classic
   * "solid colored block" for icons/logos). With it, codegen inlines the SVG (or
   * references the raster) so they render pixel-accurately.
   */
  asset?: {
    format: "svg" | "png";
    /** inline SVG markup (format === "svg") */
    svg?: string;
    /** URL or bundled asset path (format === "png", or svg-as-file) */
    url?: string;
  };
  /**
   * If this node was matched to an existing library component (F->A) or a Figma
   * component (A->F), the reuse target is recorded here. Set by lib_search_component.
   */
  componentMatch?: {
    /** e.g. "app-button" (Angular) or a Figma component key */
    target: string;
    /** confidence 0..1 from the matcher */
    confidence: number;
    /** prop bindings inferred from the node, e.g. { variant: "primary", label: "Save" } */
    props?: Record<string, string>;
  };
  /**
   * Figma component/variant properties captured from an INSTANCE
   * (e.g. { variant: "Primary", state: "Disabled", label: "Save" }). Merged into
   * componentMatch.props so reused components get real [variant]/[state] bindings.
   */
  figmaProps?: Record<string, string>;
  children: IRNode[];
}

/** A "screen" = one generation run rooted at a single Figma frame / Angular component. */
export interface IRDocument {
  /** human-readable screen name, used as the metrics grouping key */
  screen: string;
  /** the Figma file key or angular source path this came from */
  source: string;
  root: IRNode;
  /** design tokens extracted alongside the tree (name -> css value) */
  tokens: Record<string, string>;
  /**
   * Import-time data-fidelity notices (e.g. a frame's declared layoutMode disagreeing
   * with its children's actual bounding-box arrangement) — surfaced so a wrong-axis
   * layout isn't silently produced with no way to detect it short of visual diffing.
   */
  warnings?: string[];
}
