import { FigmaNode } from './figmaClient.js';

export interface CSSLayoutModel {
  display: string;
  flexDirection?: string;
  gap?: string;
  paddingTop?: string;
  paddingRight?: string;
  paddingBottom?: string;
  paddingLeft?: string;
  alignItems?: string;
  justifyContent?: string;
  width?: string;
  height?: string;
  overflow?: string;
  position?: string;
  top?: string;
  right?: string;
  bottom?: string;
  left?: string;
  flex?: string;
  borderRadius?: string;
  zIndex?: string;
  transform?: string;
  textOverflow?: string;
  whiteSpace?: string;
  webkitLineClamp?: string;
}

export class LayoutAnalyzer {
  analyze(node: FigmaNode, parent?: FigmaNode): CSSLayoutModel {
    const layout: CSSLayoutModel = { display: 'block' };

    if (node.layoutMode && node.layoutMode !== 'NONE') {
      layout.display = 'flex';
      layout.flexDirection = node.layoutMode === 'HORIZONTAL' ? 'row' : 'column';

      if (node.itemSpacing) layout.gap = `${node.itemSpacing}px`;
      if (node.paddingTop) layout.paddingTop = `${node.paddingTop}px`;
      if (node.paddingRight) layout.paddingRight = `${node.paddingRight}px`;
      if (node.paddingBottom) layout.paddingBottom = `${node.paddingBottom}px`;
      if (node.paddingLeft) layout.paddingLeft = `${node.paddingLeft}px`;

      layout.alignItems = this.mapAlign(node.counterAxisAlignItems);
      layout.justifyContent = this.mapJustify(node.primaryAxisAlignItems);

      if (node.primaryAxisSizingMode === 'AUTO') layout.width = 'fit-content';
      if (node.counterAxisSizingMode === 'AUTO') layout.height = 'fit-content';
    }

    if (node.layoutAlign === 'STRETCH' || node.layoutGrow === 1) {
      layout.flex = '1';
    }

    const isFreeFloating = node.layoutPositioning === 'ABSOLUTE'
      || !parent?.layoutMode || parent.layoutMode === 'NONE';

    if (isFreeFloating && parent?.absoluteBoundingBox && node.absoluteBoundingBox) {
      this.applyAbsolutePositioning(layout, node, parent);
    }

    if (node.absoluteBoundingBox) {
      const { width, height } = node.absoluteBoundingBox;
      if (!layout.width || layout.width === 'fit-content') {
        layout.width = `${Math.round(width)}px`;
      }
      if (!layout.height || layout.height === 'fit-content') {
        layout.height = `${Math.round(height)}px`;
      }
    }

    // Runs last so a text node's intentional fit-content sizing isn't clobbered by the
    // bounding-box fallback above (which otherwise treats 'fit-content' as still-undecided).
    this.applyTextSizing(layout, node);

    if (node.clipsContent) layout.overflow = 'hidden';

    if (node.cornerRadius) {
      layout.borderRadius = `${node.cornerRadius}px`;
    } else if (node.rectangleCornerRadii) {
      const [tl, tr, br, bl] = node.rectangleCornerRadii;
      layout.borderRadius = `${tl}px ${tr}px ${br}px ${bl}px`;
    }

    if (node.rotation) {
      // Figma's REST API returns rotation in radians (unlike the Plugin API, which uses degrees).
      const degrees = Math.round((node.rotation * 180 / Math.PI) * 100) / 100;
      if (degrees !== 0) layout.transform = `rotate(${degrees}deg)`;
    }

    return layout;
  }

  /** Positions a free-floating node (outside auto-layout flow) relative to its parent, honoring constraints for edge-anchoring. */
  private applyAbsolutePositioning(layout: CSSLayoutModel, node: FigmaNode, parent: FigmaNode): void {
    const nodeBox = node.absoluteBoundingBox!;
    const parentBox = parent.absoluteBoundingBox!;

    layout.position = 'absolute';

    const offsetLeft = Math.round(nodeBox.x - parentBox.x);
    const offsetTop = Math.round(nodeBox.y - parentBox.y);
    const offsetRight = Math.round((parentBox.x + parentBox.width) - (nodeBox.x + nodeBox.width));
    const offsetBottom = Math.round((parentBox.y + parentBox.height) - (nodeBox.y + nodeBox.height));

    const horizontal = node.constraints?.horizontal || 'MIN';
    const vertical = node.constraints?.vertical || 'MIN';

    if (horizontal === 'MAX') {
      layout.right = `${offsetRight}px`;
    } else if (horizontal === 'STRETCH') {
      layout.left = `${offsetLeft}px`;
      layout.right = `${offsetRight}px`;
      layout.width = undefined;
    } else {
      // MIN, CENTER, and SCALE are all approximated as left-anchored — CENTER/SCALE would
      // need percentage math relative to the parent's resized dimensions to be exact.
      layout.left = `${offsetLeft}px`;
    }

    if (vertical === 'MAX') {
      layout.bottom = `${offsetBottom}px`;
    } else if (vertical === 'STRETCH') {
      layout.top = `${offsetTop}px`;
      layout.bottom = `${offsetBottom}px`;
      layout.height = undefined;
    } else {
      layout.top = `${offsetTop}px`;
    }
  }

  private applyTextSizing(layout: CSSLayoutModel, node: FigmaNode): void {
    if (node.type !== 'TEXT') return;

    switch (node.textAutoResize) {
      case 'WIDTH_AND_HEIGHT':
        layout.width = 'fit-content';
        layout.height = 'fit-content';
        break;
      case 'HEIGHT':
        layout.height = 'fit-content';
        break;
      case 'TRUNCATE':
        layout.overflow = 'hidden';
        layout.textOverflow = 'ellipsis';
        layout.whiteSpace = 'nowrap';
        break;
      default:
        break;
    }
  }

  toCSSString(layout: CSSLayoutModel): string {
    const entries: string[] = [];
    if (layout.display !== 'block') entries.push(`display: ${layout.display}`);
    if (layout.flexDirection) entries.push(`flex-direction: ${layout.flexDirection}`);
    if (layout.gap) entries.push(`gap: ${layout.gap}`);
    if (layout.paddingTop || layout.paddingRight || layout.paddingBottom || layout.paddingLeft) {
      const t = layout.paddingTop || '0';
      const r = layout.paddingRight || '0';
      const b = layout.paddingBottom || '0';
      const l = layout.paddingLeft || '0';
      if (t === r && r === b && b === l) {
        entries.push(`padding: ${t}`);
      } else {
        entries.push(`padding: ${t} ${r} ${b} ${l}`);
      }
    }
    if (layout.alignItems) entries.push(`align-items: ${layout.alignItems}`);
    if (layout.justifyContent) entries.push(`justify-content: ${layout.justifyContent}`);
    if (layout.width) entries.push(`width: ${layout.width}`);
    if (layout.height) entries.push(`height: ${layout.height}`);
    if (layout.overflow) entries.push(`overflow: ${layout.overflow}`);
    if (layout.position) entries.push(`position: ${layout.position}`);
    if (layout.top) entries.push(`top: ${layout.top}`);
    if (layout.right) entries.push(`right: ${layout.right}`);
    if (layout.bottom) entries.push(`bottom: ${layout.bottom}`);
    if (layout.left) entries.push(`left: ${layout.left}`);
    if (layout.flex) entries.push(`flex: ${layout.flex}`);
    if (layout.borderRadius) entries.push(`border-radius: ${layout.borderRadius}`);
    if (layout.transform) entries.push(`transform: ${layout.transform}`);
    if (layout.textOverflow) entries.push(`text-overflow: ${layout.textOverflow}`);
    if (layout.whiteSpace) entries.push(`white-space: ${layout.whiteSpace}`);
    return entries.join(';\n  ');
  }

  private mapAlign(value?: string): string {
    const map: Record<string, string> = {
      MIN: 'flex-start', MAX: 'flex-end', CENTER: 'center', STRETCH: 'stretch', BASELINE: 'baseline',
    };
    return map[value || ''] || 'flex-start';
  }

  private mapJustify(value?: string): string {
    const map: Record<string, string> = {
      MIN: 'flex-start', MAX: 'flex-end', CENTER: 'center',
      SPACE_BETWEEN: 'space-between', SPACE_AROUND: 'space-around',
    };
    return map[value || ''] || 'flex-start';
  }
}
