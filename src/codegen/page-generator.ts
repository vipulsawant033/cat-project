import type { IrNode } from '../figma/parser.js';
import { generateAngularComponent, type GeneratedAngularComponent, type GeneratedFile } from './angular-generator.js';

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
export function generateAngularPage(
  ir: IrNode,
  figmaNodeName: string,
  iconAssets: GeneratedFile[] = []
): GeneratedAngularPage {
  const sections: GeneratedAngularComponent[] = [];

  const pageIr: IrNode = {
    ...ir,
    children: ir.children.map((child) => {
      if (child.kind !== 'container' || child.children.length === 0) return child;

      const sectionIr: IrNode = {
        ...child,
        layout: { ...child.layout, sizingMode: 'root', positioning: undefined },
      };
      const section = generateAngularComponent(sectionIr, child.name, { iconAssets });
      sections.push(section);

      return {
        ...child,
        kind: 'component',
        component: { selector: section.selector, props: {} },
        children: [],
        // The section's own root (generated with sizingMode: 'root' above) already re-establishes
        // all decorative styling (background, padding, border, shadow) for itself. Keeping the
        // *original* node's style/padding here too would double-apply it across two nested boxes:
        // this placement host in the page template, and the section's own inner root div — e.g. a
        // padding: 16px on both stacks into an effective 32px, silently shrinking the section's
        // content area. Only `grow` (how the page's flex row should size this slot) is a genuine
        // page-level concern and stays.
        layout: { ...child.layout, padding: { top: 0, right: 0, bottom: 0, left: 0 } },
        style: {},
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
    iconAssets,
  });

  return { page, sections };
}
