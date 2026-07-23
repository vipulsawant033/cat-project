import type { IrNode } from '../figma/parser.js';
import { generateAngularComponent, type GeneratedAngularComponent } from './angular-generator.js';

export interface GeneratedAngularPage {
  /** The composing top-level component — its template just references each section's selector. */
  page: GeneratedAngularComponent;
  /** One standalone component per split-out section, written under `sections/<folder>/` relative to the page. */
  sections: GeneratedAngularComponent[];
}

/**
 * Splits a whole-screen IR into a composing "page" component plus one
 * standalone component per top-level section, instead of one flat div/span
 * tree covering the entire screen. Only direct children of the root that are
 * themselves containers with their own children are split out — leaves
 * (icons/text/images) and already-mapped component instances stay inlined,
 * since they're already a single unit either way.
 *
 * Each section is generated from the already-parsed child IR (no re-parsing,
 * no extra Figma API calls), with its sizingMode forced to 'root' so it gets
 * its own responsive sizing rather than the 'flex'/'fixed' mode it had as a
 * child of the page. The stub left in the page's own IR keeps that child's
 * *original* layout (positioning/size) so the page places the resulting
 * `<selector>` element exactly where the section sat in the design.
 */
export function generateAngularPage(ir: IrNode, figmaNodeName: string): GeneratedAngularPage {
  const sections: GeneratedAngularComponent[] = [];

  const pageIr: IrNode = {
    ...ir,
    children: ir.children.map((child) => {
      if (child.kind !== 'container' || child.children.length === 0) return child;

      const sectionIr: IrNode = {
        ...child,
        layout: { ...child.layout, sizingMode: 'root', positioning: undefined },
      };
      const section = generateAngularComponent(sectionIr, child.name);
      sections.push(section);

      return {
        ...child,
        kind: 'component',
        component: { selector: section.selector, props: {} },
        children: [],
      };
    }),
  };

  const page = generateAngularComponent(pageIr, figmaNodeName, {
    localComponents: sections.map((s) => ({
      selector: s.selector,
      className: s.className,
      importFrom: `./sections/${s.folder}/${s.folder}.component`,
      filePath: '(generated in this same call)',
    })),
  });

  return { page, sections };
}
