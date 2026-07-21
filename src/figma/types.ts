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

export interface FigmaPaint {
  type: string; // 'SOLID' | 'GRADIENT_LINEAR' | 'IMAGE' | ...
  color?: FigmaColor;
  opacity?: number;
  visible?: boolean;
}

export interface FigmaLayoutConstraints {
  vertical?: string;
  horizontal?: string;
}

export interface FigmaNode {
  id: string;
  name: string;
  type: string; // 'FRAME' | 'GROUP' | 'TEXT' | 'RECTANGLE' | 'COMPONENT' | 'INSTANCE' | ...
  visible?: boolean;
  children?: FigmaNode[];

  // Layout
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number };
  layoutMode?: 'NONE' | 'HORIZONTAL' | 'VERTICAL';
  itemSpacing?: number;
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  primaryAxisAlignItems?: string;
  counterAxisAlignItems?: string;
  constraints?: FigmaLayoutConstraints;

  // Appearance
  fills?: FigmaPaint[];
  strokes?: FigmaPaint[];
  strokeWeight?: number;
  cornerRadius?: number;
  opacity?: number;

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
}

export interface FigmaFileResponse {
  name: string;
  document: FigmaNode;
  components?: Record<string, { name: string; key: string }>;
}

export interface FigmaNodesResponse {
  name: string;
  nodes: Record<string, { document: FigmaNode }>;
}

/** Parsed identifiers from a Figma share/component link. */
export interface FigmaLinkRef {
  fileKey: string;
  /** node-id as it appears in the URL query string, e.g. "12:34" */
  nodeId?: string;
}
