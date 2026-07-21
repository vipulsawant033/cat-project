import type { IrNode } from '../figma/parser.js';
import { buildComponentNames } from './naming.js';
import { renderComponentClass, renderStyles, renderTemplate } from './templates.js';

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
}

/**
 * Transforms the Figma IR into a standalone Angular component's three files.
 * This is intentionally a straightforward structural transformation (layout ->
 * flexbox, fills -> background/color, text nodes -> <span>) rather than a
 * pixel-perfect renderer. Extend renderCssNode/renderHtmlNode in templates.ts
 * to support more Figma features (gradients, effects, images, variants, etc.).
 */
export function generateAngularComponent(ir: IrNode, figmaNodeName: string): GeneratedAngularComponent {
  const names = buildComponentNames(figmaNodeName);

  const ts = renderComponentClass(names.className, names.selector, figmaNodeName);
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
  };
}
