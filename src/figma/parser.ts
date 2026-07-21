import type { FigmaColor, FigmaNode, FigmaPaint } from './types.js';

/**
 * Intermediate representation (IR) that sits between raw Figma nodes and
 * generated Angular code. Keeping this layer means the codegen step never
 * has to know about Figma's API shape, and other target frameworks could
 * consume the same IR later.
 */
export interface IrNode {
  id: string;
  name: string;
  kind: 'container' | 'text' | 'image' | 'icon' | 'unknown';
  layout: {
    direction: 'row' | 'column' | 'none';
    gap: number;
    padding: { top: number; right: number; bottom: number; left: number };
    width?: number;
    height?: number;
    align?: string;
    justify?: string;
    /**
     * How this node's size should be expressed in CSS:
     * - 'root'  the top-level generated element: fluid width (100%) capped at
     *           the Figma frame's width, rather than a hardcoded viewport size.
     * - 'flex'  an auto-layout container: sized by its flex children/padding,
     *           not a hardcoded px box, so it can reflow.
     * - 'fixed' a leaf asset (icon/image/text/plain shape) where the Figma
     *           bounding box is the actual intended size.
     */
    sizingMode: 'root' | 'flex' | 'fixed';
  };
  style: {
    background?: string;
    color?: string;
    borderRadius?: number;
    borderWidth?: number;
    borderColor?: string;
    fontFamily?: string;
    fontSize?: number;
    fontWeight?: number;
    opacity?: number;
  };
  text?: string;
  /** Raw SVG markup for kind === 'icon' nodes (see figma/icon-detector.ts). */
  svg?: string;
  children: IrNode[];
}

export interface ParseOptions {
  /** True for the subtree's top-level node; controls layout.sizingMode. */
  isRoot?: boolean;
  /** node id -> exported SVG markup, from FigmaClient.exportSvgs(). */
  iconSvgByNodeId?: Record<string, string>;
}

function figmaColorToCss(color: FigmaColor, opacity = 1): string {
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  const a = +(color.a * opacity).toFixed(3);
  return a >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${a})`;
}

function firstVisibleSolidPaint(paints?: FigmaPaint[]): FigmaPaint | undefined {
  return paints?.find((p) => p.visible !== false && p.type === 'SOLID' && p.color);
}

function mapAlign(value?: string): string | undefined {
  switch (value) {
    case 'MIN':
      return 'flex-start';
    case 'MAX':
      return 'flex-end';
    case 'CENTER':
      return 'center';
    case 'SPACE_BETWEEN':
      return 'space-between';
    default:
      return undefined;
  }
}

function classifyKind(node: FigmaNode, isIcon: boolean): IrNode['kind'] {
  if (isIcon) return 'icon';
  if (node.type === 'TEXT') return 'text';
  if (node.type === 'RECTANGLE' && firstVisibleSolidPaint(node.fills)?.type === 'IMAGE') return 'image';
  if (node.children && node.children.length > 0) return 'container';
  if (node.type === 'FRAME' || node.type === 'GROUP' || node.type === 'COMPONENT' || node.type === 'INSTANCE') {
    return 'container';
  }
  return 'unknown';
}

function sizingModeFor(kind: IrNode['kind'], direction: IrNode['layout']['direction'], isRoot: boolean): IrNode['layout']['sizingMode'] {
  if (isRoot) return 'root';
  if (kind === 'icon' || kind === 'image' || kind === 'text') return 'fixed';
  if (direction !== 'none') return 'flex';
  return 'fixed';
}

/**
 * Converts a raw Figma node (and its subtree) into the simplified IR used by the codegen layer.
 *
 * NOTE: This is a starter transformation covering layout (auto-layout -> flex),
 * fills, strokes, corner radius, opacity, basic text styling, icon/vector
 * export, and root-level responsive sizing. Still not handled: gradients,
 * effects (shadows/blurs), component variants, and non-root responsive
 * constraints (Figma's per-side constraint pinning).
 */
export function figmaNodeToIr(node: FigmaNode, options: ParseOptions = {}): IrNode {
  const { isRoot = true, iconSvgByNodeId } = options;
  const svg = iconSvgByNodeId?.[node.id];
  const isIcon = svg !== undefined;

  const fill = firstVisibleSolidPaint(node.fills);
  const stroke = firstVisibleSolidPaint(node.strokes);
  const kind = classifyKind(node, isIcon);
  const direction: IrNode['layout']['direction'] =
    node.layoutMode === 'HORIZONTAL' ? 'row' : node.layoutMode === 'VERTICAL' ? 'column' : 'none';

  const ir: IrNode = {
    id: node.id,
    name: node.name,
    kind,
    layout: {
      direction,
      gap: node.itemSpacing ?? 0,
      padding: {
        top: node.paddingTop ?? 0,
        right: node.paddingRight ?? 0,
        bottom: node.paddingBottom ?? 0,
        left: node.paddingLeft ?? 0,
      },
      width: node.absoluteBoundingBox?.width,
      height: node.absoluteBoundingBox?.height,
      justify: mapAlign(node.primaryAxisAlignItems),
      align: mapAlign(node.counterAxisAlignItems),
      sizingMode: sizingModeFor(kind, direction, isRoot),
    },
    style: {
      background:
        kind !== 'text' && kind !== 'icon' && fill?.color
          ? figmaColorToCss(fill.color, fill.opacity ?? node.opacity)
          : undefined,
      borderRadius: node.cornerRadius,
      borderWidth: stroke && node.strokeWeight ? node.strokeWeight : undefined,
      borderColor: stroke?.color ? figmaColorToCss(stroke.color, stroke.opacity) : undefined,
      opacity: node.opacity !== undefined && node.opacity < 1 ? node.opacity : undefined,
      fontFamily: node.style?.fontFamily,
      fontSize: node.style?.fontSize,
      fontWeight: node.style?.fontWeight,
      color: kind === 'text' && fill?.color ? figmaColorToCss(fill.color, fill.opacity) : undefined,
    },
    text: kind === 'text' ? node.characters : undefined,
    svg: isIcon ? svg : undefined,
    // An icon subtree is exported as one flattened asset — don't recurse into its children.
    children: isIcon
      ? []
      : (node.children ?? [])
          .filter((child) => child.visible !== false)
          .map((child) => figmaNodeToIr(child, { isRoot: false, iconSvgByNodeId })),
  };

  return ir;
}
