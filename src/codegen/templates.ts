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
    const kebab = toKebabCase(node.name) || node.kind;
    // CSS class names (and JS identifiers derived from them) can't start with a
    // digit — text layers named after their own content (e.g. "11:51 AM", "730E")
    // otherwise produce invalid selectors like `.11-51-am` that fail the SCSS build.
    const base = /^[0-9]/.test(kebab) ? `n-${kebab}` : kebab;
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

function renderHtmlNode(node: IrNode, classNames: Map<IrNode, string>, depth: number): string {
  const className = classNames.get(node)!;

  if (node.kind === 'icon' && node.iconSrc) {
    // <svg>/<img> are CSS "replaced elements" with their own intrinsic-aspect-ratio sizing
    // algorithm, which handles width/max-width/percentage sizing inconsistently across browsers
    // (especially at the component root) — box-sizing CSS lives on a plain wrapping <div>
    // instead, with the icon just filling it via a separate `-asset` class at 100%/100%. The icon
    // itself is a real exported .svg file written alongside this component (see
    // core/generate-angular-component.ts) rather than markup inlined here, so it's inspectable,
    // cacheable, and immune to string-splicing bugs in the generated HTML.
    return [
      indent(`<div class="${className}">`, depth),
      indent(`<img class="${className}-asset" src="${node.iconSrc}" alt="${escapeHtml(node.name)}" />`, depth + 1),
      indent(`</div>`, depth),
    ].join('\n');
  }

  if (node.kind === 'text') {
    return indent(`<span class="${className}">${escapeHtml(node.text ?? '')}</span>`, depth);
  }

  if (node.kind === 'image') {
    return [
      indent(`<div class="${className}">`, depth),
      indent(`<img class="${className}-asset" [src]="imageSrc" alt="${escapeHtml(node.name)}" />`, depth + 1),
      indent(`</div>`, depth),
    ].join('\n');
  }

  if (node.kind === 'component' && node.component) {
    const attrs = Object.entries(node.component.props)
      .map(([name, value]) => `[${name}]="${typeof value === 'string' ? `'${value.replace(/'/g, "\\'")}'` : value}"`)
      .join(' ');
    return indent(
      `<${node.component.selector} class="${className}"${attrs ? ' ' + attrs : ''}></${node.component.selector}>`,
      depth
    );
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

  // Flex/positioning-as-parent declarations only make sense for a node that actually renders as
  // a <div> wrapping real child elements. icon/image/component nodes render as a single leaf tag
  // (svg/img/custom-element) with no children in the DOM — e.g. `display: flex` on an <svg> root
  // is undefined/inconsistent across browsers and can make width/max-width stop applying correctly.
  if (node.kind === 'container') {
    if (node.layout.direction !== 'none') {
      decls.push('display: flex');
      decls.push(`flex-direction: ${node.layout.direction}`);
      if (node.layout.gap) decls.push(`gap: ${node.layout.gap}px`);
      if (node.layout.justify) decls.push(`justify-content: ${node.layout.justify}`);
      if (node.layout.align) decls.push(`align-items: ${node.layout.align}`);
    } else if (node.children.length > 0 && !node.layout.positioning) {
      // Not auto-layout but has children: they're positioned via resolveChildPositioning
      // (per-side Figma constraints), so this container must anchor them. Skipped when this
      // node itself is absolutely positioned below — that already establishes a containing block.
      decls.push('position: relative');
    }
  }

  if (node.layout.positioning) {
    const p = node.layout.positioning;
    decls.push('position: absolute');
    if (p.left !== undefined) decls.push(`left: ${Math.round(p.left)}px`);
    if (p.right !== undefined) decls.push(`right: ${Math.round(p.right)}px`);
    if (p.top !== undefined) decls.push(`top: ${Math.round(p.top)}px`);
    if (p.bottom !== undefined) decls.push(`bottom: ${Math.round(p.bottom)}px`);
    if (p.centerX) decls.push('left: 50%');
    if (p.centerY) decls.push('top: 50%');
    if (p.centerX && p.centerY) decls.push('transform: translate(-50%, -50%)');
    else if (p.centerX) decls.push('transform: translateX(-50%)');
    else if (p.centerY) decls.push('transform: translateY(-50%)');
  }

  const { top, right, bottom, left } = node.layout.padding;
  if (top || right || bottom || left) {
    decls.push(`padding: ${top}px ${right}px ${bottom}px ${left}px`);
  }

  if (node.layout.grow) decls.push('flex: 1 1 0%');

  const { width, height } = node.layout;
  switch (node.layout.sizingMode) {
    case 'fixed':
      if (!node.layout.grow && width !== undefined) decls.push(`width: ${Math.round(width)}px`);
      if (height !== undefined) decls.push(`height: ${Math.round(height)}px`);
      break;
    case 'root':
      decls.push('width: 100%');
      decls.push('box-sizing: border-box');
      if (width !== undefined) decls.push(`max-width: ${Math.round(width)}px`);
      if (height !== undefined) decls.push(`min-height: ${Math.round(height)}px`);
      break;
    case 'flex':
      // Sized by flex children + padding/gap instead of a hardcoded box, so it can reflow
      // (unless `grow` above already pinned it to fill the parent row).
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
  if (node.style.textAlign) decls.push(`text-align: ${node.style.textAlign}`);
  if (node.style.boxShadow) decls.push(`box-shadow: ${node.style.boxShadow}`);
  if (node.style.filter) decls.push(`filter: ${node.style.filter}`);
  if (node.style.backdropFilter) decls.push(`backdrop-filter: ${node.style.backdropFilter}`);

  const rule = decls.length
    ? `.${className} {\n${decls.map((d) => `  ${d};`).join('\n')}\n}`
    : `.${className} {\n}`;

  // Companion rule for the inner <svg>/<img> (see renderHtmlNode) — a plain div-fill, since the
  // wrapping .className rule above already carries all the actual box-sizing.
  const assetRule =
    node.kind === 'icon' || node.kind === 'image'
      ? `\n\n.${className}-asset {\n  display: block;\n  width: 100%;\n  height: 100%;${
          node.kind === 'image' ? '\n  object-fit: cover;' : ''
        }\n}`
      : '';

  const childRules = node.children.map((child) => renderCssNode(child, classNames)).join('\n\n');
  return childRules ? `${rule}${assetRule}\n\n${childRules}` : `${rule}${assetRule}`;
}

export function renderStyles(ir: IrNode): string {
  const classNames = assignClassNames(ir);

  // Angular component hosts (the custom element tag itself, e.g. <app-card>) have no default
  // display/sizing the way real HTML elements do — the actual rendered/measured/screenshotted box
  // for this component IS <app-card> (:host), not its inner template root div, so the same root
  // sizing has to be mirrored onto :host directly. Without this, :host stays `display:inline;
  // width:auto` (fills whatever it's placed in, uncapped) regardless of what CSS the inner
  // wrapping div carries — a real bug caught by an actual Playwright screenshot, not just
  // reading the generated file contents.
  const hostDecls = ['display: block'];
  if (ir.layout.sizingMode === 'root') {
    hostDecls.push('width: 100%', 'box-sizing: border-box');
    if (ir.layout.width !== undefined) hostDecls.push(`max-width: ${Math.round(ir.layout.width)}px`);
    if (ir.layout.height !== undefined) hostDecls.push(`min-height: ${Math.round(ir.layout.height)}px`);
  }
  const hostRule = `:host {\n${hostDecls.map((d) => `  ${d};`).join('\n')}\n}`;

  return `${hostRule}\n\n${renderCssNode(ir, classNames)}\n`;
}

export interface UsedComponentImport {
  selector: string;
  className: string;
  /** Module specifier to import `className` from, if resolvable (see angular-generator.ts). */
  importFrom?: string;
  /** Source file the component was found in, for the TODO comment when importFrom is unknown. */
  filePath: string;
}

export function renderComponentClass(
  className: string,
  selector: string,
  sourceFigmaName: string,
  usedComponents: UsedComponentImport[] = []
): string {
  const resolvedImports = usedComponents.filter((c) => c.importFrom);
  const unresolvedImports = usedComponents.filter((c) => !c.importFrom);

  const importLines = resolvedImports.map((c) => `import { ${c.className} } from '${c.importFrom}';`).join('\n');
  const todoLines = unresolvedImports
    .map(
      (c) =>
        `// TODO: import ${c.className} (selector "${c.selector}", found at ${c.filePath}) and add it to ` +
        `the imports array below — no package name could be resolved for its source file.`
    )
    .join('\n');
  const importNames = usedComponents.map((c) => c.className).join(', ');

  return `import { ChangeDetectionStrategy, Component } from '@angular/core';
${importLines ? importLines + '\n' : ''}${todoLines ? todoLines + '\n' : ''}
/**
 * Generated from Figma node "${sourceFigmaName}".
 * Re-run codegen to refresh after design changes; hand-edit below the
 * generated markers if you need custom behavior that should survive regen.
 */
@Component({
  selector: '${selector}',
  standalone: true,
  imports: [${importNames}],
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
