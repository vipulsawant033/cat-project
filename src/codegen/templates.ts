import type { IrNode } from '../figma/parser.js';
import { toKebabCase } from './naming.js';

/**
 * Walks the IR tree assigning a unique, human-readable CSS class per node
 * (e.g. "card", "card-title-2") so generated HTML/CSS stay readable instead
 * of using node ids.
 */
function assignClassNames(root: IrNode): Map<IrNode, string> {
  const used = new Map<string, number>();
  const assignments = new Map<IrNode, string>();

  function visit(node: IrNode) {
    const base = toKebabCase(node.name) || node.kind;
    const count = used.get(base) ?? 0;
    used.set(base, count + 1);
    const className = count === 0 ? base : `${base}-${count}`;
    assignments.set(node, className);
    node.children.forEach(visit);
  }

  visit(root);
  return assignments;
}

function indent(text: string, levels: number): string {
  const pad = '  '.repeat(levels);
  return text
    .split('\n')
    .map((line) => (line.length ? pad + line : line))
    .join('\n');
}

/** Strips hardcoded width/height off the exported SVG's root tag and injects our layout class instead. */
function prepareIconSvg(svg: string, className: string): string {
  const withoutFixedSize = svg.replace(/\s(width|height)="[^"]*"/g, '');
  const withClass = withoutFixedSize.replace(/<svg\b/, `<svg class="${className}"`);
  return withClass.trim();
}

function renderHtmlNode(node: IrNode, classNames: Map<IrNode, string>, depth: number): string {
  const className = classNames.get(node)!;

  if (node.kind === 'icon' && node.svg) {
    return indent(prepareIconSvg(node.svg, className), depth);
  }

  if (node.kind === 'text') {
    return indent(`<span class="${className}">${escapeHtml(node.text ?? '')}</span>`, depth);
  }

  if (node.kind === 'image') {
    return indent(`<img class="${className}" [src]="imageSrc" alt="${escapeHtml(node.name)}" />`, depth);
  }

  const childrenHtml = node.children.map((child) => renderHtmlNode(child, classNames, depth + 1)).join('\n');
  const tag = depth === 0 ? 'div' : 'div';

  if (node.children.length === 0) {
    return indent(`<${tag} class="${className}"></${tag}>`, depth);
  }

  return [indent(`<${tag} class="${className}">`, depth), childrenHtml, indent(`</${tag}>`, depth)].join('\n');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderTemplate(ir: IrNode): string {
  const classNames = assignClassNames(ir);
  return renderHtmlNode(ir, classNames, 0) + '\n';
}

function renderCssNode(node: IrNode, classNames: Map<IrNode, string>): string {
  const className = classNames.get(node)!;
  const decls: string[] = [];

  if (node.layout.direction !== 'none') {
    decls.push('display: flex');
    decls.push(`flex-direction: ${node.layout.direction}`);
    if (node.layout.gap) decls.push(`gap: ${node.layout.gap}px`);
    if (node.layout.justify) decls.push(`justify-content: ${node.layout.justify}`);
    if (node.layout.align) decls.push(`align-items: ${node.layout.align}`);
  }

  const { top, right, bottom, left } = node.layout.padding;
  if (top || right || bottom || left) {
    decls.push(`padding: ${top}px ${right}px ${bottom}px ${left}px`);
  }

  const { width, height } = node.layout;
  switch (node.layout.sizingMode) {
    case 'fixed':
      if (width !== undefined) decls.push(`width: ${Math.round(width)}px`);
      if (height !== undefined) decls.push(`height: ${Math.round(height)}px`);
      break;
    case 'root':
      decls.push('width: 100%');
      decls.push('box-sizing: border-box');
      if (width !== undefined) decls.push(`max-width: ${Math.round(width)}px`);
      if (height !== undefined) decls.push(`min-height: ${Math.round(height)}px`);
      break;
    case 'flex':
      // Sized by flex children + padding/gap instead of a hardcoded box, so it can reflow.
      break;
  }

  if (node.style.background) decls.push(`background: ${node.style.background}`);
  if (node.style.color) decls.push(`color: ${node.style.color}`);
  if (node.style.borderRadius) decls.push(`border-radius: ${node.style.borderRadius}px`);
  if (node.style.borderWidth && node.style.borderColor) {
    decls.push(`border: ${node.style.borderWidth}px solid ${node.style.borderColor}`);
  }
  if (node.style.opacity !== undefined) decls.push(`opacity: ${node.style.opacity}`);
  if (node.style.fontFamily) decls.push(`font-family: '${node.style.fontFamily}', sans-serif`);
  if (node.style.fontSize) decls.push(`font-size: ${node.style.fontSize}px`);
  if (node.style.fontWeight) decls.push(`font-weight: ${node.style.fontWeight}`);

  const rule = decls.length
    ? `.${className} {\n${decls.map((d) => `  ${d};`).join('\n')}\n}`
    : `.${className} {\n}`;

  const childRules = node.children.map((child) => renderCssNode(child, classNames)).join('\n\n');
  return childRules ? `${rule}\n\n${childRules}` : rule;
}

export function renderStyles(ir: IrNode): string {
  const classNames = assignClassNames(ir);
  return renderCssNode(ir, classNames) + '\n';
}

export function renderComponentClass(className: string, selector: string, sourceFigmaName: string): string {
  return `import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Generated from Figma node "${sourceFigmaName}".
 * Re-run codegen to refresh after design changes; hand-edit below the
 * generated markers if you need custom behavior that should survive regen.
 */
@Component({
  selector: '${selector}',
  standalone: true,
  imports: [],
  templateUrl: './${selectorToFileBase(selector)}.component.html',
  styleUrl: './${selectorToFileBase(selector)}.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ${className} {}
`;
}

function selectorToFileBase(selector: string): string {
  return selector.replace(/^app-/, '');
}
