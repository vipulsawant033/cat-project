import { toKebabCase } from '../codegen/naming.js';
import type { GeneratedFile } from '../codegen/angular-generator.js';
import type { FigmaNode } from '../figma/types.js';

const IMAGES_PUBLIC_PATH = '/images';

/**
 * Turns exported image-fill PNGs into standalone asset files (instead of an
 * unresolvable Angular binding) plus a node id -> public path map for the
 * parser to bake into each image node's `<img src>`. Mirrors
 * core/icon-assets.ts's SVG pipeline; shared by generate-angular-component.ts
 * and generate-angular-page.ts, which both already have
 * `imageFillNodes`/`imagePngByNodeId` from FigmaClient.exportPngBytes().
 */
export function buildImageAssets(
  imageFillNodes: FigmaNode[],
  imagePngByNodeId: Record<string, Buffer>
): { imageAssets: GeneratedFile[]; imageSrcByNodeId: Record<string, string> } {
  const imageAssets: GeneratedFile[] = [];
  const imageSrcByNodeId: Record<string, string> = {};

  for (const node of imageFillNodes) {
    const content = imagePngByNodeId[node.id];
    if (!content) continue;
    // Node-id suffix keeps filenames stable across regenerations and unique across images
    // that share a display name (e.g. two different "logo" fills on the same page).
    const fileName = `${toKebabCase(node.name) || 'image'}-${node.id.replace(/:/g, '-')}.png`;
    imageAssets.push({ fileName, content });
    imageSrcByNodeId[node.id] = `${IMAGES_PUBLIC_PATH}/${fileName}`;
  }

  return { imageAssets, imageSrcByNodeId };
}
