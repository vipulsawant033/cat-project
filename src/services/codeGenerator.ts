import { FigmaNode } from './figmaClient.js';
import { ComponentIndex, ComponentRecord } from './componentIndex.js';
import { TokenMapper } from './tokenMapper.js';
import { LayoutAnalyzer } from './layoutAnalyzer.js';
import { logger } from '../utils/logger.js';

export type ComponentTypePreference = 'angular' | 'lit' | 'auto';

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
  ) {}

  figmaNodeToIR(node: FigmaNode, preferType?: ComponentTypePreference, depth = 0): IRNode {
    const layout = this.layoutAnalyzer.analyze(node);
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

    if (depth < 8) {
      ir.children = (node.children || []).map(child =>
        this.figmaNodeToIR(child, preferType, depth + 1)
      );
    }

    return ir;
  }

  private findComponentMatch(node: FigmaNode, preferType?: ComponentTypePreference): (ComponentRecord & { confidence: number }) | null {
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

    for (const input of match.inputs || []) {
      if (input.internal) continue;
      const variantValue = node.variantProperties?.[input.name];
      if (variantValue) {
        bindings.push({
          name: input.name,
          value: variantValue,
          bindingType: isLit ? 'lit-property' : 'angular-input',
        });
      }
    }

    return bindings;
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
    return this.renderContainer(ir);
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

  private classifyNodeType(node: FigmaNode): IRNode['type'] {
    if (node.type === 'TEXT') return 'text';
    if (node.type === 'VECTOR' || node.type === 'BOOLEAN_OPERATION') return 'icon';
    if (node.type === 'RECTANGLE' && !node.children?.length) return 'image';
    if (node.type === 'LINE') return 'divider';
    if (node.componentId || node.type === 'COMPONENT' || node.type === 'INSTANCE') return 'component';
    return 'container';
  }

  private extractCSSStyles(node: FigmaNode): Record<string, string> {
    const styles: Record<string, string> = {};

    if (node.fills?.length) {
      const fill = node.fills[0];
      if (fill.type === 'SOLID' && fill.color) {
        const mapped = this.tokenMapper.mapColor(fill.color);
        styles['background-color'] = mapped.scssVariable
          ? `var(--${mapped.scssVariable.replace('$', '').replace(/_/g, '-')})`
          : mapped.figmaValue;
      }
    }

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
