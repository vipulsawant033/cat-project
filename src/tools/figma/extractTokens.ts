import * as fs from 'fs';
import * as path from 'path';
import { FigmaClient } from '../../services/figmaClient.js';
import { TokenMapper } from '../../services/tokenMapper.js';

export async function figmaExtractTokens(args: { fileKey: string }) {
  const client = new FigmaClient();
  const file = await client.getFile(args.fileKey);
  const mapper = new TokenMapper();

  const tokenMap = mapper.extractTokensFromFile(file);

  // Extract colors from document fills
  const colors: Record<string, string> = {};
  const spacing = new Set<number>();
  const radii = new Set<number>();
  const shadows: string[] = [];

  function walk(node: typeof file.document) {
    if (node.fills) {
      for (const fill of node.fills) {
        if (fill.type === 'SOLID' && fill.color) {
          const hex = mapper.colorToHex(fill.color);
          if (!colors[hex]) colors[hex] = node.name;
        }
      }
    }
    if (node.absoluteBoundingBox) {
      if (node.itemSpacing) spacing.add(node.itemSpacing);
    }
    if (node.cornerRadius) radii.add(node.cornerRadius);
    if (node.effects) {
      for (const effect of node.effects) {
        if (effect.visible) {
          const shadow = mapper.mapEffect(effect);
          if (shadow && !shadows.includes(shadow)) shadows.push(shadow);
        }
      }
    }
    for (const child of node.children || []) walk(child);
  }

  walk(file.document);

  const result = {
    fileKey: args.fileKey,
    name: file.name,
    colors,
    typography: tokenMap.typography,
    spacing: [...spacing].sort((a, b) => a - b),
    radii: [...radii].sort((a, b) => a - b),
    shadows,
    namedStyles: file.styles,
  };

  // Persist cache
  const cachePath = path.resolve('./data/token-cache.json');
  const dir = path.dirname(cachePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify(result, null, 2));

  return result;
}
