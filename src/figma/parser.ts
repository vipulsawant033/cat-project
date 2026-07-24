import type {
  FigmaColor,
  FigmaComponentPropertyValue,
  FigmaEffect,
  FigmaGradientStop,
  FigmaNode,
  FigmaPaint,
  FigmaVariableAlias,
} from './types.js';

/**
 * Intermediate representation (IR) that sits between raw Figma nodes and
 * generated Angular code. Keeping this layer means the codegen step never
 * has to know about Figma's API shape, and other target frameworks could
 * consume the same IR later.
 */
export interface ResolvedPositioning {
  top?: number;
  left?: number;
  right?: number;
  bottom?: number;
  centerX?: boolean;
  centerY?: boolean;
}

/** 1-based CSS grid-column-start/grid-row-start for a GRID parent's 'MANUAL'-positioned child. */
export interface ResolvedGridPlacement {
  columnStart: number;
  rowStart: number;
}

export interface ResolvedComponentMapping {
  angularSelector: string;
  propertyMappings: Record<string, string>;
}

export interface IrNode {
  id: string;
  name: string;
  kind: 'container' | 'text' | 'image' | 'icon' | 'component' | 'unknown';
  layout: {
    direction: 'row' | 'column' | 'grid' | 'none';
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
     * - 'fixed' a leaf asset (icon/image/text/component/plain shape) where the
     *           Figma bounding box is the actual intended size.
     */
    sizingMode: 'root' | 'flex' | 'fixed';
    /** Set when this node's parent is not auto-layout — see resolveChildPositioning. */
    positioning?: ResolvedPositioning;
    /** True when Figma's layoutSizingHorizontal was 'FILL' inside a HORIZONTAL auto-layout parent ("Fill container") — renders as `flex: 1 1 0%` and suppresses a fixed width. */
    growWidth?: boolean;
    /** True when Figma's layoutSizingVertical was 'FILL' inside a VERTICAL auto-layout parent ("Fill container") — renders as `flex: 1 1 0%` and suppresses a fixed height. */
    growHeight?: boolean;
    /** Present when direction === 'grid': the CSS grid-template-columns/rows + row/column gaps for this GRID auto-layout container. Figma's gridColumnsSizing/gridRowsSizing are already CSS-compatible track-list syntax. */
    grid?: { templateColumns?: string; templateRows?: string; rowGap?: number; columnGap?: number };
    /** Set when this node is a child of a GRID parent whose gridItemsPositioning is 'MANUAL' — translates to CSS grid-column-start/grid-row-start. */
    gridPlacement?: ResolvedGridPlacement;
    /** True when Figma's layoutSizingHorizontal/Vertical was 'FILL' inside a GRID parent — renders as width/height: 100% to fill the assigned grid cell (flex-grow has no meaning in a grid context). */
    fillWidth?: boolean;
    fillHeight?: boolean;
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
    textAlign?: 'left' | 'center' | 'right' | 'justify';
    opacity?: number;
    boxShadow?: string;
    filter?: string;
    backdropFilter?: string;
  };
  text?: string;
  /** Public asset path for kind === 'icon' nodes, e.g. "/icons/cog-367-9551.svg" (see figma/icon-detector.ts). */
  iconSrc?: string;
  /** Public asset path for kind === 'image' nodes, e.g. "/images/cat-logo-9-13410.png" (see core/image-assets.ts). */
  imageSrc?: string;
  /** Present when kind === 'component': the mapped Angular selector + resolved variant/prop values. */
  component?: { selector: string; props: Record<string, string | boolean> };
  children: IrNode[];
}

export interface TokenRef {
  /** Suggested CSS custom property name, e.g. "--color-brand-primary" (see figma_extract_tokens). */
  cssVariableName: string;
}

export interface ParseOptions {
  /** True for the subtree's top-level node; controls layout.sizingMode. */
  isRoot?: boolean;
  /** node id -> public asset path of its already-written icon .svg file (see core/generate-angular-component.ts). */
  iconSrcByNodeId?: Record<string, string>;
  /** node id -> public asset path of its already-written image-fill .png file (see core/image-assets.ts). */
  imageSrcByNodeId?: Record<string, string>;
  /** Figma variable id -> CSS token reference, from figma_extract_tokens — enables var(--token, literal) styling. */
  tokensByVariableId?: Record<string, TokenRef>;
  /** Figma node id (of a main component/set, scoped to the current subtree) -> its stable component key. */
  componentsByNodeId?: Record<string, { key: string; componentSetId?: string }>;
  /** Looks up a persisted Figma -> Angular mapping by component key (see library/mapping-store.ts). */
  resolveMapping?: (figmaComponentKey: string) => ResolvedComponentMapping | undefined;
  /** Resolved absolute positioning for this node, computed by its parent when the parent is not auto-layout. */
  positioning?: ResolvedPositioning;
  /** Resolved grid-column-start/grid-row-start for this node, computed by its parent when the parent is a 'MANUAL'-positioned GRID. */
  gridPlacement?: ResolvedGridPlacement;
  /** The immediate parent's auto-layout direction (undefined if the parent isn't auto-layout) — lets a child tell whether Figma's layoutSizingHorizontal/Vertical: 'FILL' should translate to a CSS flex-grow or grid-cell fill. */
  parentDirection?: IrNode['layout']['direction'];
}

export function figmaColorToCss(color: FigmaColor, opacity = 1): string {
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  const a = +(color.a * opacity).toFixed(3);
  return a >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${a})`;
}

function firstVisibleSolidPaint(paints?: FigmaPaint[]): FigmaPaint | undefined {
  return paints?.find((p) => p.visible !== false && p.type === 'SOLID' && p.color);
}

function firstVisibleGradientPaint(paints?: FigmaPaint[]): FigmaPaint | undefined {
  return paints?.find((p) => p.visible !== false && p.type.startsWith('GRADIENT_') && p.gradientStops?.length);
}

function firstVisibleImagePaint(paints?: FigmaPaint[]): FigmaPaint | undefined {
  return paints?.find((p) => p.visible !== false && p.type === 'IMAGE');
}

/**
 * Converts a gradient's start/end handle positions (normalized 0..1 object
 * space, y-down) into a CSS linear-gradient angle (0deg = up, clockwise).
 */
function gradientAngleDeg(handles: { x: number; y: number }[]): number {
  const [start, end] = handles;
  if (!start || !end) return 180;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
  return (deg + 360) % 360;
}

function gradientStopsToCss(stops: FigmaGradientStop[]): string {
  return stops.map((stop) => `${figmaColorToCss(stop.color)} ${Math.round(stop.position * 100)}%`).join(', ');
}

/** Renders a gradient paint as a CSS `background` value. Only the LINEAR case computes a real angle; radial/angular/diamond gradients approximate the handle geometry as a centered gradient. */
function paintToBackgroundCss(paint: FigmaPaint): string | undefined {
  if (!paint.gradientStops?.length) return undefined;
  const stops = gradientStopsToCss(paint.gradientStops);
  switch (paint.type) {
    case 'GRADIENT_LINEAR': {
      const angle = paint.gradientHandlePositions ? gradientAngleDeg(paint.gradientHandlePositions) : 180;
      return `linear-gradient(${Math.round(angle)}deg, ${stops})`;
    }
    case 'GRADIENT_RADIAL':
    case 'GRADIENT_DIAMOND':
      return `radial-gradient(circle, ${stops})`;
    case 'GRADIENT_ANGULAR':
      return `conic-gradient(${stops})`;
    default:
      return undefined;
  }
}

/** If `alias` points at a known token, wraps `literal` as `var(--token, literal)` so fidelity holds even without a global token stylesheet loaded; otherwise returns `literal` unchanged. */
function withTokenBinding(
  literal: string,
  alias: FigmaVariableAlias | null | undefined,
  tokensByVariableId?: Record<string, TokenRef>
): string {
  const token = alias ? tokensByVariableId?.[alias.id] : undefined;
  return token ? `var(${token.cssVariableName}, ${literal})` : literal;
}

function figmaEffectsToCss(effects: FigmaEffect[] | undefined): {
  boxShadow?: string;
  filter?: string;
  backdropFilter?: string;
} {
  if (!effects?.length) return {};
  const shadows: string[] = [];
  const blurs: string[] = [];
  const backdropBlurs: string[] = [];

  for (const effect of effects) {
    if (effect.visible === false) continue;
    switch (effect.type) {
      case 'DROP_SHADOW':
      case 'INNER_SHADOW': {
        const inset = effect.type === 'INNER_SHADOW' ? 'inset ' : '';
        const x = effect.offset?.x ?? 0;
        const y = effect.offset?.y ?? 0;
        const blur = effect.radius ?? 0;
        const spread = effect.spread ?? 0;
        const color = effect.color ? figmaColorToCss(effect.color) : 'rgba(0, 0, 0, 0.25)';
        shadows.push(`${inset}${x}px ${y}px ${blur}px ${spread}px ${color}`);
        break;
      }
      case 'LAYER_BLUR':
        blurs.push(`blur(${effect.radius ?? 0}px)`);
        break;
      case 'BACKGROUND_BLUR':
        backdropBlurs.push(`blur(${effect.radius ?? 0}px)`);
        break;
    }
  }

  return {
    boxShadow: shadows.length ? shadows.join(', ') : undefined,
    filter: blurs.length ? blurs.join(' ') : undefined,
    backdropFilter: backdropBlurs.length ? backdropBlurs.join(' ') : undefined,
  };
}

/**
 * Resolves how a non-auto-layout child should be pinned within its parent,
 * from Figma's per-side constraints (MIN/MAX/CENTER/STRETCH/SCALE) plus both
 * nodes' absolute bounding boxes. Auto-layout containers never call this —
 * their children flow via flexbox instead.
 */
function resolveChildPositioning(
  child: FigmaNode,
  parentBox: { x: number; y: number; width: number; height: number }
): ResolvedPositioning | undefined {
  const box = child.absoluteBoundingBox;
  if (!box) return undefined;

  const offsetX = box.x - parentBox.x;
  const offsetY = box.y - parentBox.y;
  const hConstraint = child.constraints?.horizontal ?? 'MIN';
  const vConstraint = child.constraints?.vertical ?? 'MIN';
  const result: ResolvedPositioning = {};

  switch (hConstraint) {
    case 'MAX':
      result.right = parentBox.width - (offsetX + box.width);
      break;
    case 'STRETCH':
      result.left = offsetX;
      result.right = parentBox.width - (offsetX + box.width);
      break;
    case 'CENTER':
      result.centerX = true;
      break;
    default:
      result.left = offsetX;
  }

  switch (vConstraint) {
    case 'MAX':
      result.bottom = parentBox.height - (offsetY + box.height);
      break;
    case 'STRETCH':
      result.top = offsetY;
      result.bottom = parentBox.height - (offsetY + box.height);
      break;
    case 'CENTER':
      result.centerY = true;
      break;
    default:
      result.top = offsetY;
  }

  return result;
}

/** Resolves an INSTANCE node to a persisted Figma -> Angular mapping, if one exists for its main component. */
function resolveInstanceMapping(
  node: FigmaNode,
  componentsByNodeId: Record<string, { key: string; componentSetId?: string }> | undefined,
  resolveMapping: ((figmaComponentKey: string) => ResolvedComponentMapping | undefined) | undefined
): ResolvedComponentMapping | undefined {
  if (node.type !== 'INSTANCE' || !node.componentId || !componentsByNodeId || !resolveMapping) return undefined;
  const meta = componentsByNodeId[node.componentId];
  if (!meta) return undefined;
  return resolveMapping(meta.key);
}

/** Resolves each mapped Figma variant/property name to its Angular @Input value from the instance's componentProperties (keys carry a "#<id>" suffix in the raw API). */
function resolveComponentProps(
  propertyMappings: Record<string, string>,
  componentProperties?: Record<string, FigmaComponentPropertyValue>
): Record<string, string | boolean> {
  const props: Record<string, string | boolean> = {};
  if (!componentProperties) return props;
  for (const [figmaPropName, angularInputName] of Object.entries(propertyMappings)) {
    const entry = Object.entries(componentProperties).find(
      ([key]) => key === figmaPropName || key.startsWith(`${figmaPropName}#`)
    );
    if (entry) props[angularInputName] = entry[1].value;
  }
  return props;
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

function mapTextAlign(value?: string): 'left' | 'center' | 'right' | 'justify' | undefined {
  switch (value) {
    case 'LEFT':
      return 'left';
    case 'CENTER':
      return 'center';
    case 'RIGHT':
      return 'right';
    case 'JUSTIFIED':
      return 'justify';
    default:
      return undefined;
  }
}

function classifyKind(node: FigmaNode, isIcon: boolean): IrNode['kind'] {
  if (isIcon) return 'icon';
  if (node.type === 'TEXT') return 'text';
  if (node.type === 'RECTANGLE' && firstVisibleImagePaint(node.fills)) return 'image';
  if (node.children && node.children.length > 0) return 'container';
  if (node.type === 'FRAME' || node.type === 'GROUP' || node.type === 'COMPONENT' || node.type === 'INSTANCE') {
    return 'container';
  }
  return 'unknown';
}

function sizingModeFor(kind: IrNode['kind'], direction: IrNode['layout']['direction'], isRoot: boolean): IrNode['layout']['sizingMode'] {
  if (isRoot) return 'root';
  if (kind === 'icon' || kind === 'image' || kind === 'text' || kind === 'component') return 'fixed';
  if (direction !== 'none') return 'flex';
  return 'fixed';
}

/**
 * Converts a raw Figma node (and its subtree) into the simplified IR used by the codegen layer.
 *
 * Covers layout (auto-layout -> flex, non-auto-layout -> per-side constraint
 * positioning), fills (solid + linear/radial/angular gradients), strokes,
 * corner radius, opacity, effects (shadow/blur), basic text styling,
 * icon/vector export, token-bound styling (var(--token, literal)), mapped
 * component-instance substitution, and root-level responsive sizing.
 */
export function figmaNodeToIr(node: FigmaNode, options: ParseOptions = {}): IrNode {
  const {
    isRoot = true,
    iconSrcByNodeId,
    imageSrcByNodeId,
    tokensByVariableId,
    componentsByNodeId,
    resolveMapping,
    positioning,
    gridPlacement,
    parentDirection,
  } = options;
  const iconSrc = iconSrcByNodeId?.[node.id];
  const isIcon = iconSrc !== undefined;
  const componentMapping = resolveInstanceMapping(node, componentsByNodeId, resolveMapping);

  const fill = firstVisibleSolidPaint(node.fills);
  const gradientFill = firstVisibleGradientPaint(node.fills);
  const stroke = firstVisibleSolidPaint(node.strokes);
  const kind: IrNode['kind'] = componentMapping ? 'component' : classifyKind(node, isIcon);
  const imageSrc = kind === 'image' ? imageSrcByNodeId?.[node.id] : undefined;
  const direction: IrNode['layout']['direction'] =
    node.layoutMode === 'HORIZONTAL'
      ? 'row'
      : node.layoutMode === 'VERTICAL'
        ? 'column'
        : node.layoutMode === 'GRID'
          ? 'grid'
          : 'none';

  // boundVariables.fills/strokes align by index with the fills/strokes array; approximated here as "the
  // first bound entry", which covers the common single-fill/single-stroke case this parser already targets.
  const backgroundLiteral =
    kind !== 'text' && kind !== 'icon' && kind !== 'component'
      ? (gradientFill && paintToBackgroundCss(gradientFill)) ||
        (fill?.color && figmaColorToCss(fill.color, fill.opacity)) ||
        undefined
      : undefined;
  const background = backgroundLiteral
    ? withTokenBinding(backgroundLiteral, node.boundVariables?.fills?.[0], tokensByVariableId)
    : undefined;

  const textColorLiteral = kind === 'text' && fill?.color ? figmaColorToCss(fill.color, fill.opacity) : undefined;
  const color = textColorLiteral
    ? withTokenBinding(textColorLiteral, node.boundVariables?.fills?.[0], tokensByVariableId)
    : undefined;

  const borderColorLiteral = stroke?.color ? figmaColorToCss(stroke.color, stroke.opacity) : undefined;
  const borderColor = borderColorLiteral
    ? withTokenBinding(borderColorLiteral, node.boundVariables?.strokes?.[0], tokensByVariableId)
    : undefined;

  const { boxShadow, filter, backdropFilter } = figmaEffectsToCss(node.effects);
  const growWidth = parentDirection === 'row' && node.layoutSizingHorizontal === 'FILL';
  const growHeight = parentDirection === 'column' && node.layoutSizingVertical === 'FILL';
  const fillWidth = parentDirection === 'grid' && node.layoutSizingHorizontal === 'FILL';
  const fillHeight = parentDirection === 'grid' && node.layoutSizingVertical === 'FILL';
  const grid =
    direction === 'grid'
      ? {
          templateColumns: node.gridColumnsSizing,
          templateRows: node.gridRowsSizing,
          rowGap: node.gridRowGap,
          columnGap: node.gridColumnGap,
        }
      : undefined;

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
      positioning,
      growWidth: growWidth || undefined,
      growHeight: growHeight || undefined,
      grid,
      gridPlacement,
      fillWidth: fillWidth || undefined,
      fillHeight: fillHeight || undefined,
    },
    style: {
      background,
      borderRadius: node.cornerRadius,
      borderWidth: stroke && node.strokeWeight ? node.strokeWeight : undefined,
      borderColor,
      opacity: node.opacity !== undefined && node.opacity < 1 ? node.opacity : undefined,
      fontFamily: node.style?.fontFamily,
      fontSize: node.style?.fontSize,
      fontWeight: node.style?.fontWeight,
      textAlign: kind === 'text' ? mapTextAlign(node.style?.textAlignHorizontal) : undefined,
      color,
      boxShadow,
      filter,
      backdropFilter,
    },
    text: kind === 'text' ? node.characters : undefined,
    iconSrc: isIcon ? iconSrc : undefined,
    imageSrc,
    component: componentMapping
      ? {
          selector: componentMapping.angularSelector,
          props: resolveComponentProps(componentMapping.propertyMappings, node.componentProperties),
        }
      : undefined,
    // An icon subtree or a mapped component instance is a single opaque unit — don't recurse into it.
    children:
      isIcon || componentMapping
        ? []
        : (node.children ?? [])
            .filter((child) => child.visible !== false)
            .map((child) =>
              figmaNodeToIr(child, {
                isRoot: false,
                iconSrcByNodeId,
                imageSrcByNodeId,
                tokensByVariableId,
                componentsByNodeId,
                resolveMapping,
                positioning:
                  direction === 'none' && node.absoluteBoundingBox
                    ? resolveChildPositioning(child, node.absoluteBoundingBox)
                    : undefined,
                gridPlacement:
                  direction === 'grid' &&
                  node.gridItemsPositioning === 'MANUAL' &&
                  child.gridColumnAnchorIndex !== undefined &&
                  child.gridRowAnchorIndex !== undefined
                    ? { columnStart: child.gridColumnAnchorIndex + 1, rowStart: child.gridRowAnchorIndex + 1 }
                    : undefined,
                parentDirection: direction,
              })
            ),
  };

  return ir;
}
