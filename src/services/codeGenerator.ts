import { FigmaClient, FigmaNode } from './figmaClient.js';
import { ComponentIndex, ComponentRecord } from './componentIndex.js';
import { TokenMapper } from './tokenMapper.js';
import { LayoutAnalyzer } from './layoutAnalyzer.js';
import { logger } from '../utils/logger.js';

export type ComponentTypePreference = 'angular' | 'lit' | 'auto';

/** Max recursion depth for IR generation. Configurable since real screens can nest well past 8-10 levels. */
const MAX_IR_DEPTH = parseInt(process.env.CODEGEN_MAX_DEPTH || '16', 10);

export interface AssetFetcher {
  /** Returns base64-encoded asset content (PNG bytes, or SVG XML text) for the given node. */
  exportAsset(nodeId: string, format: 'png' | 'svg'): Promise<string>;
}

/** Default AssetFetcher backed by the real Figma REST API. */
export class FigmaAssetFetcher implements AssetFetcher {
  constructor(private client: FigmaClient, private fileKey: string) {}

  async exportAsset(nodeId: string, format: 'png' | 'svg'): Promise<string> {
    return this.client.exportImage(this.fileKey, nodeId, format === 'svg' ? 1 : 2, format);
  }
}

export interface IRBinding {
  name: string;
  value: string;
  bindingType:
    | 'angular-input'
    | 'lit-property'
    | 'lit-attribute'
    | 'angular-output'
    | 'lit-event';
}

export interface IRSlot {
  slotName: string | null;
  children: IRNode[];
}

export interface IRNode {
  id: string;
  figmaNodeId: string;
  type: 'container' | 'text' | 'image' | 'component' | 'icon' | 'divider';
  componentMatch?: {
    selector: string;
    componentType: 'angular' | 'lit';
    bindings: IRBinding[];
    slots: IRSlot[];
    confidence: number;
  };
  cssLayout: Record<string, string>;
  cssStyles: Record<string, string>;
  children: IRNode[];
  text?: string;
  figmaVariantProps?: Record<string, string>;
  className?: string;
  assetDataUri?: string;
  assetSvgMarkup?: string;
  assetAlt?: string;
  truncated?: boolean;
}

export interface GeneratedCode {
  html: string;
  scss: string;
  ts: string;
  componentName: string;
  unmappedTokens: string[];
  matchedComponents: Array<{ selector: string; componentType: string; confidence: number }>;
  litElementsUsed: string[];
  requiresCustomElementsSchema: boolean;
}

export class CodeGenerator {
  constructor(
    private index: ComponentIndex,
    private tokenMapper: TokenMapper,
    private layoutAnalyzer: LayoutAnalyzer,
    private assetFetcher?: AssetFetcher,
  ) {}

  async figmaNodeToIR(node: FigmaNode, preferType?: ComponentTypePreference, depth = 0, parent?: FigmaNode): Promise<IRNode> {
    const layout = this.layoutAnalyzer.analyze(node, parent);
    const cssLayout = this.layoutToCSSRecord(layout);
    const cssStyles = this.extractCSSStyles(node);
    const irType = this.classifyNodeType(node);

    const ir: IRNode = {
      id: `node_${node.id.replace(/[^a-zA-Z0-9]/g, '_')}`,
      figmaNodeId: node.id,
      type: irType,
      cssLayout,
      cssStyles,
      children: [],
      text: node.type === 'TEXT' ? node.characters : undefined,
      figmaVariantProps: node.variantProperties,
      className: this.nodeNameToClass(node.name),
    };

    if ((irType === 'image' || irType === 'icon') && this.assetFetcher) {
      await this.attachAsset(ir, node, irType);
    }

    // Try to match a component
    const match = this.findComponentMatch(node, preferType);
    if (match && match.confidence > 0.5) {
      ir.componentMatch = {
        selector: match.selector,
        componentType: match.componentType as 'angular' | 'lit',
        bindings: this.buildBindings(node, match),
        slots: this.buildSlots(node, match),
        confidence: match.confidence,
      };
    }

    const visibleChildren = (node.children || []).filter(child => child.visible !== false);
    if (depth < MAX_IR_DEPTH) {
      ir.children = await Promise.all(
        visibleChildren.map(child => this.figmaNodeToIR(child, preferType, depth + 1, node))
      );
    } else if (visibleChildren.length > 0) {
      logger.warn('Max IR depth reached, truncating subtree', { nodeId: node.id, name: node.name, depth });
      ir.truncated = true;
    }

    if (!cssLayout['position'] && ir.children.some(c => c.cssLayout['position'] === 'absolute')) {
      ir.cssLayout['position'] = 'relative';
    }

    return ir;
  }

  private async attachAsset(ir: IRNode, node: FigmaNode, irType: 'image' | 'icon'): Promise<void> {
    try {
      if (irType === 'icon') {
        const svgBase64 = await this.assetFetcher!.exportAsset(node.id, 'svg');
        ir.assetSvgMarkup = Buffer.from(svgBase64, 'base64').toString('utf-8');
      } else {
        const pngBase64 = await this.assetFetcher!.exportAsset(node.id, 'png');
        ir.assetDataUri = `data:image/png;base64,${pngBase64}`;
      }
      ir.assetAlt = node.name;
    } catch (err) {
      logger.warn('Asset export failed, falling back to placeholder markup', { nodeId: node.id, error: String(err) });
    }
  }

  private findComponentMatch(node: FigmaNode, preferType?: ComponentTypePreference): (ComponentRecord & { confidence: number }) | null {
    const deterministic = this.findDeterministicMatch(node);
    if (deterministic) return deterministic;

    const isLeaf = !node.children?.length || node.type === 'TEXT';
    const effectivePrefer = preferType === 'auto' || !preferType
      ? (isLeaf ? 'lit' : 'angular')
      : preferType;

    try {
      const results = this.index.search(node.name, effectivePrefer as 'angular' | 'lit', 5);
      if (results.length === 0) return null;

      const best = results[0];
      const confidence = this.computeConfidence(node.name, best.selector);
      return { ...best, confidence };
    } catch {
      return null;
    }
  }

  /** Checks for an explicit `lib_map_figma_to_component` mapping or `@figma-component` annotation before falling back to fuzzy name search. */
  private findDeterministicMatch(node: FigmaNode): (ComponentRecord & { confidence: number }) | null {
    const byInstanceId = this.index.getByFigmaComponentId(node.id);
    if (byInstanceId) return byInstanceId;

    if (node.componentId) {
      const byMainComponent = this.index.getByFigmaComponentId(node.componentId);
      if (byMainComponent) return byMainComponent;
    }

    return null;
  }

  private computeConfidence(nodeName: string, selector: string): number {
    const n = nodeName.toLowerCase().replace(/[^a-z0-9]/g, '');
    const s = selector.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (n === s) return 1.0;
    if (n.includes(s) || s.includes(n)) return 0.8;
    const words = n.split(/\s+/);
    const sWords = s.split(/-/);
    const overlap = words.filter(w => sWords.some(sw => sw.includes(w) || w.includes(sw))).length;
    return Math.min(overlap / Math.max(words.length, sWords.length), 0.9);
  }

  private buildBindings(node: FigmaNode, match: ComponentRecord): IRBinding[] {
    const bindings: IRBinding[] = [];
    const isLit = match.componentType === 'lit';

    // Figma variant props are human-labeled ("Icon Position") while component inputs are
    // camelCase/kebab-case ("iconPosition") — compare on a normalized form so they still match.
    const variantEntries = Object.entries(node.variantProperties || {})
      .map(([key, value]) => ({ normalizedKey: this.normalizePropName(key), value }));

    for (const input of match.inputs || []) {
      if (input.internal) continue;
      const normalizedInputName = this.normalizePropName(input.name);
      const matched = variantEntries.find(v => v.normalizedKey === normalizedInputName);
      if (matched) {
        bindings.push({
          name: input.name,
          value: matched.value,
          bindingType: isLit ? 'lit-property' : 'angular-input',
        });
      }
    }

    return bindings;
  }

  private normalizePropName(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  private buildSlots(node: FigmaNode, match: ComponentRecord): IRSlot[] {
    const slots: IRSlot[] = [];
    if (match.componentType === 'lit' && match.slots?.length) {
      for (const slotDef of match.slots) {
        slots.push({ slotName: slotDef.name, children: [] });
      }
    }
    return slots;
  }

  irToTemplate(ir: IRNode): string {
    if (ir.componentMatch) {
      return this.renderComponent(ir);
    }
    if (ir.type === 'text') {
      return this.renderText(ir);
    }
    if (ir.type === 'image') {
      return this.renderImage(ir);
    }
    if (ir.type === 'icon') {
      return this.renderIcon(ir);
    }
    return this.renderContainer(ir);
  }

  private renderImage(ir: IRNode): string {
    const alt = this.escapeAttr(ir.assetAlt || '');
    if (ir.assetDataUri) {
      return `<img class="${ir.className}" src="${ir.assetDataUri}" alt="${alt}">`;
    }
    return `<!-- TODO: image asset for "${ir.assetAlt || ir.className}" could not be exported --><img class="${ir.className}" alt="${alt}">`;
  }

  private renderIcon(ir: IRNode): string {
    if (ir.assetSvgMarkup) {
      return ir.assetSvgMarkup.replace('<svg', `<svg class="${ir.className}"`);
    }
    return `<!-- TODO: icon asset for "${ir.assetAlt || ir.className}" could not be exported --><span class="${ir.className}" role="img" aria-label="${this.escapeAttr(ir.assetAlt || '')}"></span>`;
  }

  private escapeAttr(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  }

  private renderComponent(ir: IRNode): string {
    const match = ir.componentMatch!;
    const isLit = match.componentType === 'lit';
    const bindings = match.bindings.map(b => this.renderBinding(b)).join('\n  ');

    const childContent = ir.children.map(c => this.irToTemplate(c)).join('\n  ');
    const slotContent = match.slots
      .map(s => s.slotName
        ? `<span slot="${s.slotName}">...</span>`
        : childContent)
      .join('\n  ');

    return `<${match.selector}
  ${bindings}
  ${slotContent || childContent}>
</${match.selector}>`;
  }

  private renderBinding(b: IRBinding): string {
    switch (b.bindingType) {
      case 'angular-input': return `[${b.name}]="${b.value}"`;
      case 'lit-property': return `.${b.name}="${b.value}"`;
      case 'lit-attribute': return `${b.name}="${b.value}"`;
      case 'angular-output': return `(${b.name})="on${this.capitalize(b.name)}($event)"`;
      case 'lit-event': return `(${b.name})="on${this.capitalize(b.name)}($event)"`;
    }
  }

  private renderText(ir: IRNode): string {
    const tag = this.inferTextTag(ir);
    return `<${tag} class="${ir.className}">${ir.text || ''}</${tag}>`;
  }

  private renderContainer(ir: IRNode): string {
    const children = ir.children.map(c => this.irToTemplate(c)).join('\n  ');
    return `<div class="${ir.className}">
  ${children}
</div>`;
  }

  private inferTextTag(ir: IRNode): string {
    const css = ir.cssStyles;
    const fontSize = parseFloat(css['font-size'] || '16');
    const weight = parseInt(css['font-weight'] || '400', 10);
    if (fontSize >= 32 && weight >= 700) return 'h1';
    if (fontSize >= 24 && weight >= 700) return 'h2';
    if (fontSize >= 20 && weight >= 600) return 'h3';
    if (fontSize >= 18) return 'h4';
    if (fontSize >= 16 && weight >= 500) return 'p';
    return 'span';
  }

  generateHTML(ir: IRNode, hasLitElements: boolean): string {
    const comment = hasLitElements
      ? '<!-- Requires CUSTOM_ELEMENTS_SCHEMA in the Angular module/component -->\n'
      : '';
    return comment + this.irToTemplate(ir);
  }

  generateSCSS(ir: IRNode, componentName: string): string {
    const lines: string[] = [`.${componentName} {`];
    this.collectSCSS(ir, lines, 1);
    lines.push('}');
    return lines.join('\n');
  }

  private collectSCSS(ir: IRNode, lines: string[], indent: number): void {
    const prefix = '  '.repeat(indent);
    if (ir.componentMatch?.componentType === 'lit') {
      const litOverrides = (ir.componentMatch.selector.match(/--[\w-]+/g) || [])
        .map(p => `${prefix}  ${p}: /* token value */;`);
      if (litOverrides.length) {
        lines.push(`${prefix}${ir.componentMatch.selector} {`);
        lines.push(...litOverrides);
        lines.push(`${prefix}}`);
      }
    } else if (ir.className) {
      const cssEntries = Object.entries({ ...ir.cssLayout, ...ir.cssStyles })
        .filter(([, v]) => v)
        .map(([k, v]) => `${prefix}  ${k}: ${v};`);
      if (cssEntries.length) {
        lines.push(`${prefix}.${ir.className} {`);
        lines.push(...cssEntries);
        lines.push(`${prefix}}`);
      }
    }
    for (const child of ir.children) {
      this.collectSCSS(child, lines, indent + 1);
    }
  }

  generateTS(componentName: string, selector: string, hasLitElements: boolean): string {
    const schemaImport = hasLitElements
      ? ", CUSTOM_ELEMENTS_SCHEMA"
      : "";
    const schemas = hasLitElements
      ? `\n  schemas: [CUSTOM_ELEMENTS_SCHEMA],`
      : '';
    const litComment = hasLitElements
      ? '\n// Lit elements are loaded via the client\'s Lit library bundle'
      : '';

    return `import { Component${schemaImport} } from '@angular/core';
import { CommonModule } from '@angular/common';
${litComment}

@Component({
  selector: '${selector}',
  standalone: true,
  imports: [CommonModule],${schemas}
  templateUrl: './${componentName}.component.html',
  styleUrls: ['./${componentName}.component.scss'],
})
export class ${this.toPascalCase(componentName)}Component {}
`;
  }

  collectLitElements(ir: IRNode): string[] {
    const elements: string[] = [];
    if (ir.componentMatch?.componentType === 'lit') {
      elements.push(ir.componentMatch.selector);
    }
    for (const child of ir.children) {
      elements.push(...this.collectLitElements(child));
    }
    return [...new Set(elements)];
  }

  collectMatchedComponents(ir: IRNode): Array<{ selector: string; componentType: string; confidence: number }> {
    const matches: Array<{ selector: string; componentType: string; confidence: number }> = [];
    if (ir.componentMatch) {
      matches.push({
        selector: ir.componentMatch.selector,
        componentType: ir.componentMatch.componentType,
        confidence: ir.componentMatch.confidence,
      });
    }
    for (const child of ir.children) {
      matches.push(...this.collectMatchedComponents(child));
    }
    return matches;
  }

  /** Figma node names/IDs whose subtrees were cut off by MAX_IR_DEPTH — surfaced so callers can warn instead of silently shipping incomplete output. */
  collectTruncatedNodes(ir: IRNode): Array<{ figmaNodeId: string; className?: string }> {
    const truncated: Array<{ figmaNodeId: string; className?: string }> = [];
    if (ir.truncated) truncated.push({ figmaNodeId: ir.figmaNodeId, className: ir.className });
    for (const child of ir.children) {
      truncated.push(...this.collectTruncatedNodes(child));
    }
    return truncated;
  }

  private classifyNodeType(node: FigmaNode): IRNode['type'] {
    if (node.type === 'TEXT') return 'text';
    if (node.type === 'VECTOR' || node.type === 'BOOLEAN_OPERATION') return 'icon';
    if (node.type === 'LINE') return 'divider';
    if (node.componentId || node.type === 'COMPONENT' || node.type === 'INSTANCE') return 'component';
    const hasVisibleImageFill = (node.fills || []).some(f => f.type === 'IMAGE' && f.visible !== false);
    if (!node.children?.length && (node.type === 'RECTANGLE' || node.type === 'ELLIPSE' || hasVisibleImageFill)) return 'image';
    return 'container';
  }

  private extractCSSStyles(node: FigmaNode): Record<string, string> {
    const styles: Record<string, string> = {};

    this.applyFills(styles, node);
    this.applyStroke(styles, node);

    if (node.style) {
      const typographyCSS = this.tokenMapper.mapTypography(node.style);
      Object.assign(styles, typographyCSS);
    }

    if (node.effects?.length) {
      const shadows = node.effects
        .filter(e => e.visible && (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW'))
        .map(e => this.tokenMapper.mapEffect(e))
        .filter(Boolean);
      if (shadows.length) styles['box-shadow'] = shadows.join(', ');
    }

    if (node.opacity !== undefined && node.opacity < 1) {
      styles['opacity'] = `${node.opacity}`;
    }

    return styles;
  }

  /**
   * Reads the topmost visible fill as the primary background, and layers additional
   * visible fills as stacked `background-image` entries when more than one is present.
   * Only the first fill was previously read — losing anything painted underneath a
   * top color/gradient layer (e.g. a color fill covered by a gradient overlay).
   */
  private applyFills(styles: Record<string, string>, node: FigmaNode): void {
    const visibleFills = (node.fills || [])
      .map((fill, index) => ({ fill, index }))
      .filter(f => f.fill.visible !== false);

    if (visibleFills.length === 0) return;

    if (visibleFills.length === 1) {
      const { fill, index } = visibleFills[0];
      if (fill.type === 'SOLID' && fill.color) {
        const boundVariableId = node.boundVariables?.fills?.[index]?.id;
        styles['background-color'] = this.tokenMapper.mapColor(fill.color, boundVariableId).rawValue;
      } else if (fill.type.startsWith('GRADIENT_')) {
        styles['background-image'] = this.tokenMapper.mapPaint(fill).rawValue;
      }
      return;
    }

    // CSS paints the first-listed background layer on top; Figma's fills array lists
    // the topmost layer last, so reverse it to preserve visual stacking order.
    const layers = [...visibleFills].reverse().map(({ fill, index }) => {
      if (fill.type === 'SOLID' && fill.color) {
        const boundVariableId = node.boundVariables?.fills?.[index]?.id;
        const color = this.tokenMapper.mapColor(fill.color, boundVariableId).rawValue;
        // A flat two-stop gradient is the standard trick for a solid color inside a background-image stack.
        return `linear-gradient(${color}, ${color})`;
      }
      if (fill.type.startsWith('GRADIENT_')) {
        return this.tokenMapper.mapPaint(fill).rawValue;
      }
      return null;
    }).filter((v): v is string => !!v);

    if (layers.length) styles['background-image'] = layers.join(', ');
  }

  private applyStroke(styles: Record<string, string>, node: FigmaNode): void {
    if (!node.strokeWeight) return;
    const visibleStroke = (node.strokes || []).find(s => s.visible !== false);
    if (!visibleStroke || visibleStroke.type !== 'SOLID' || !visibleStroke.color) return;

    const boundVariableId = node.boundVariables?.strokes?.[0]?.id;
    const color = this.tokenMapper.mapColor(visibleStroke.color, boundVariableId).rawValue;
    styles['border'] = `${Math.round(node.strokeWeight)}px solid ${color}`;
  }

  private layoutToCSSRecord(layout: ReturnType<LayoutAnalyzer['analyze']>): Record<string, string> {
    const css: Record<string, string> = {};
    if (layout.display !== 'block') css['display'] = layout.display;
    if (layout.flexDirection) css['flex-direction'] = layout.flexDirection;
    if (layout.gap) css['gap'] = layout.gap;
    if (layout.alignItems) css['align-items'] = layout.alignItems;
    if (layout.justifyContent) css['justify-content'] = layout.justifyContent;
    if (layout.width) css['width'] = layout.width;
    if (layout.height) css['height'] = layout.height;
    if (layout.overflow) css['overflow'] = layout.overflow;
    if (layout.borderRadius) css['border-radius'] = layout.borderRadius;
    if (layout.flex) css['flex'] = layout.flex;
    if (layout.position) css['position'] = layout.position;
    if (layout.top) css['top'] = layout.top;
    if (layout.right) css['right'] = layout.right;
    if (layout.bottom) css['bottom'] = layout.bottom;
    if (layout.left) css['left'] = layout.left;
    if (layout.transform) css['transform'] = layout.transform;
    if (layout.textOverflow) css['text-overflow'] = layout.textOverflow;
    if (layout.whiteSpace) css['white-space'] = layout.whiteSpace;
    return css;
  }

  private nodeNameToClass(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  private capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  private toPascalCase(s: string): string {
    return s.split(/[-_\s]+/).map(w => this.capitalize(w)).join('');
  }
}
