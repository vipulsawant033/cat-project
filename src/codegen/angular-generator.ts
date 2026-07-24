import type { IrNode } from '../figma/parser.js';
import { readIndex } from '../library/index-store.js';
import { buildComponentNames, toPascalCase } from './naming.js';
import { renderComponentClass, renderStyles, renderTemplate, type UsedComponentImport } from './templates.js';

export interface GeneratedFile {
  /** Path relative to the component's own folder, e.g. "primary-button.component.ts" */
  fileName: string;
  content: string;
}

export interface GeneratedAngularComponent {
  selector: string;
  className: string;
  /** Suggested folder name for the component, e.g. "primary-button" */
  folder: string;
  files: GeneratedFile[];
  /** Exported icon .svg files this component's template references by path (see core/generate-angular-component.ts). Written to a shared icons folder, not this component's own folder. */
  iconAssets: GeneratedFile[];
}

/** Recursively collects the distinct Angular selectors used by mapped component-instance nodes in the IR. */
function collectComponentSelectors(node: IrNode, out: Set<string> = new Set()): Set<string> {
  if (node.kind === 'component' && node.component) out.add(node.component.selector);
  node.children.forEach((child) => collectComponentSelectors(child, out));
  return out;
}

/**
 * Resolves each selector used in the IR to its class name + import specifier.
 * Checks `localComponents` first — sibling components generated in the same
 * call (see page-generator.ts), which won't be in the persisted library index
 * yet — then falls back to the persisted component-library index (see
 * lib_index_components). Falls back further to a guessed class name + a TODO
 * comment when the selector is in neither — codegen never silently drops a
 * mapped instance, it just flags the import as unresolved.
 */
function resolveUsedComponents(ir: IrNode, localComponents: UsedComponentImport[]): UsedComponentImport[] {
  const selectors = [...collectComponentSelectors(ir)];
  if (selectors.length === 0) return [];

  const localBySelector = new Map(localComponents.map((c) => [c.selector, c]));
  const index = readIndex();

  return selectors.map((selector) => {
    const local = localBySelector.get(selector);
    if (local) return local;
    const match = index.find((c) => c.selector === selector);
    return match
      ? { selector, className: match.className, importFrom: match.packageName, filePath: match.filePath }
      : { selector, className: `${toPascalCase(selector)}Component`, filePath: '(not found — run lib_index_components)' };
  });
}

export interface GenerateAngularComponentOptions {
  /** Sibling components generated in this same call (see page-generator.ts) that this IR references but that aren't in the persisted library index. */
  localComponents?: UsedComponentImport[];
  /** Exported icon .svg files for this IR's icon nodes, computed by the caller (see core/generate-angular-component.ts) — passed through unchanged onto the returned component. */
  iconAssets?: GeneratedFile[];
}

/**
 * Transforms the Figma IR into a standalone Angular component's three files.
 * Mapped component-instance nodes (see lib_map_figma_to_component) render as
 * real Angular elements with their imports resolved from the library index;
 * everything else is a straightforward structural transformation (layout ->
 * flexbox, fills -> background/color, text nodes -> <span>) rather than a
 * pixel-perfect renderer. Extend renderCssNode/renderHtmlNode in templates.ts
 * to support more Figma features.
 */
export function generateAngularComponent(
  ir: IrNode,
  figmaNodeName: string,
  options: GenerateAngularComponentOptions = {}
): GeneratedAngularComponent {
  const names = buildComponentNames(figmaNodeName);
  const usedComponents = resolveUsedComponents(ir, options.localComponents ?? []);

  const ts = renderComponentClass(names.className, names.selector, figmaNodeName, usedComponents);
  const html = renderTemplate(ir);
  const scss = renderStyles(ir);

  return {
    selector: names.selector,
    className: names.className,
    folder: names.fileBase,
    files: [
      { fileName: `${names.fileBase}.component.ts`, content: ts },
      { fileName: `${names.fileBase}.component.html`, content: html },
      { fileName: `${names.fileBase}.component.scss`, content: scss },
    ],
    iconAssets: options.iconAssets ?? [],
  };
}
