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

    if (node.absoluteBoundingBox) {
      const { width, height } = node.absoluteBoundingBox;
      if (!layout.width || layout.width === 'fit-content') {
        layout.width = `${Math.round(width)}px`;
      }
      if (!layout.height || layout.height === 'fit-content') {
        layout.height = `${Math.round(height)}px`;
      }
    }

    if (node.clipsContent) layout.overflow = 'hidden';

    if (node.cornerRadius) {
      layout.borderRadius = `${node.cornerRadius}px`;
    } else if (node.rectangleCornerRadii) {
      const [tl, tr, br, bl] = node.rectangleCornerRadii;
      layout.borderRadius = `${tl}px ${tr}px ${br}px ${bl}px`;
    }

    return layout;
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
