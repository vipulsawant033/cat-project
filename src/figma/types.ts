/**
 * Minimal subset of the Figma REST API response shape.
 * Only the fields the parser/codegen actually reads are typed here —
 * the real API returns much more (see https://www.figma.com/developers/api).
 */

export interface FigmaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface FigmaGradientStop {
  color: FigmaColor;
  /** 0..1 position along the gradient */
  position: number;
}

export interface FigmaPaint {
  type: string; // 'SOLID' | 'GRADIENT_LINEAR' | 'GRADIENT_RADIAL' | 'GRADIENT_ANGULAR' | 'GRADIENT_DIAMOND' | 'IMAGE' | ...
  color?: FigmaColor;
  opacity?: number;
  visible?: boolean;
  gradientStops?: FigmaGradientStop[];
  /** Normalized (0..1) object-space points: [start, end, width-axis] */
  gradientHandlePositions?: { x: number; y: number }[];
}

export interface FigmaLayoutConstraints {
  vertical?: string; // 'MIN' | 'MAX' | 'CENTER' | 'STRETCH' | 'SCALE'
  horizontal?: string;
}

export interface FigmaEffect {
  type: string; // 'DROP_SHADOW' | 'INNER_SHADOW' | 'LAYER_BLUR' | 'BACKGROUND_BLUR'
  visible?: boolean;
  color?: FigmaColor;
  offset?: { x: number; y: number };
  radius?: number;
  spread?: number;
}

export interface FigmaVariableAlias {
  type: 'VARIABLE_ALIAS';
  id: string;
}

/** Maps a node's style properties to the variable they're bound to, when bound. */
export interface FigmaBoundVariables {
  fills?: (FigmaVariableAlias | null)[];
  strokes?: (FigmaVariableAlias | null)[];
  cornerRadius?: FigmaVariableAlias;
}

/** A resolved value for one entry in componentPropertyDefinitions, on an INSTANCE node. */
export interface FigmaComponentPropertyValue {
  type: 'VARIANT' | 'BOOLEAN' | 'TEXT' | 'INSTANCE_SWAP';
  value: string | boolean;
}

export interface FigmaNode {
  id: string;
  name: string;
  type: string; // 'FRAME' | 'GROUP' | 'TEXT' | 'RECTANGLE' | 'COMPONENT' | 'INSTANCE' | ...
  visible?: boolean;
  children?: FigmaNode[];

  // Layout
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number };
  /** Geometry bounds PLUS effects bleed (shadows/blur) — what Figma's image export actually renders to, which can be larger than absoluteBoundingBox. */
  absoluteRenderBounds?: { x: number; y: number; width: number; height: number } | null;
  layoutMode?: 'NONE' | 'HORIZONTAL' | 'VERTICAL';
  itemSpacing?: number;
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  primaryAxisAlignItems?: string;
  counterAxisAlignItems?: string;
  constraints?: FigmaLayoutConstraints;
  /** How this node sizes itself along the horizontal axis inside an auto-layout parent: fixed size, hug its content, or fill the available space. */
  layoutSizingHorizontal?: 'FIXED' | 'HUG' | 'FILL';

  // Appearance
  fills?: FigmaPaint[];
  strokes?: FigmaPaint[];
  strokeWeight?: number;
  cornerRadius?: number;
  opacity?: number;
  effects?: FigmaEffect[];
  boundVariables?: FigmaBoundVariables;

  // Text-specific
  characters?: string;
  style?: {
    fontFamily?: string;
    fontWeight?: number;
    fontSize?: number;
    lineHeightPx?: number;
    letterSpacing?: number;
    textAlignHorizontal?: string;
  };

  // Component/variant-specific (COMPONENT_SET and its COMPONENT children)
  /** Present on COMPONENT_SET nodes: the variant/boolean/text properties it defines. */
  componentPropertyDefinitions?: Record<string, FigmaComponentProperty>;
  /** Present on COMPONENT children of a set, e.g. "Style=Primary, Size=Large". */
  variantProperties?: Record<string, string>;
  /** Present on INSTANCE nodes: the node id of the main component it's an instance of. */
  componentId?: string;
  /** Present on INSTANCE nodes: resolved variant/boolean/text property values, keyed e.g. "Style#12:3". */
  componentProperties?: Record<string, FigmaComponentPropertyValue>;
}

export interface FigmaComponentMeta {
  name: string;
  key: string;
  componentSetId?: string;
}

export interface FigmaComponentSetMeta {
  name: string;
  key: string;
}

export interface FigmaFileResponse {
  name: string;
  document: FigmaNode;
  components?: Record<string, FigmaComponentMeta>;
  componentSets?: Record<string, FigmaComponentSetMeta>;
}

export interface FigmaNodesResponse {
  name: string;
  nodes: Record<string, { document: FigmaNode; components?: Record<string, FigmaComponentMeta> }>;
}

/** Parsed identifiers from a Figma share/component link. */
export interface FigmaLinkRef {
  fileKey: string;
  /** node-id as it appears in the URL query string, e.g. "12:34" */
  nodeId?: string;
}

/** One entry from the Variables API (https://api.figma.com/v1/files/:key/variables/local). */
export interface FigmaVariable {
  id: string;
  name: string;
  /** e.g. "COLOR" | "FLOAT" | "STRING" | "BOOLEAN" */
  resolvedType: string;
  variableCollectionId: string;
  /** Value per mode id — for COLOR this is a FigmaColor, otherwise a primitive. */
  valuesByMode: Record<string, unknown>;
}

export interface FigmaVariableCollection {
  id: string;
  name: string;
  /** mode id -> mode name, e.g. { "1:0": "Light", "1:1": "Dark" } */
  modes: Record<string, string>;
  defaultModeId: string;
}

export interface FigmaVariablesResponse {
  meta: {
    variables: Record<string, FigmaVariable>;
    variableCollections: Record<string, FigmaVariableCollection>;
  };
}

/** A single componentPropertyDefinitions entry on a COMPONENT_SET/COMPONENT node. */
export interface FigmaComponentProperty {
  type: 'VARIANT' | 'BOOLEAN' | 'TEXT' | 'INSTANCE_SWAP';
  defaultValue?: string | boolean;
  variantOptions?: string[];
}

export interface FigmaImagesResponse {
  err?: string | null;
  images: Record<string, string | null>;
}
