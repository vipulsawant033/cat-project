import { toKebabCase } from '../codegen/naming.js';
import type { GeneratedFile } from '../codegen/angular-generator.js';
import type { FigmaNode } from '../figma/types.js';

const ICONS_PUBLIC_PATH = '/icons';

/**
 * Turns exported icon SVGs into standalone asset files (instead of markup
 * inlined into the generated HTML) plus a node id -> public path map for the
 * parser to bake into each icon node's `<img src>`. Shared by
 * generate-angular-component.ts and generate-angular-page.ts, which both
 * already have `iconRoots`/`iconSvgByNodeId` from FigmaClient.exportSvgs().
 */
export function buildIconAssets(
  iconRoots: FigmaNode[],
  iconSvgByNodeId: Record<string, string>
): { iconAssets: GeneratedFile[]; iconSrcByNodeId: Record<string, string> } {
  const iconAssets: GeneratedFile[] = [];
  const iconSrcByNodeId: Record<string, string> = {};

  for (const root of iconRoots) {
    const content = iconSvgByNodeId[root.id];
    if (!content) continue;
    // Node-id suffix keeps filenames stable across regenerations and unique across icons
    // that share a display name (e.g. two different "chevron" icons on the same page).
    const fileName = `${toKebabCase(root.name) || 'icon'}-${root.id.replace(/:/g, '-')}.svg`;
    iconAssets.push({ fileName, content });
    iconSrcByNodeId[root.id] = `${ICONS_PUBLIC_PATH}/${fileName}`;
  }

  return { iconAssets, iconSrcByNodeId };
}
