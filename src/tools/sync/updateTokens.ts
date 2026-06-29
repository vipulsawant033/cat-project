import * as fs from 'fs';
import { FigmaClient } from '../../services/figmaClient.js';

export async function syncUpdateTokens(args: {
  targetFileKey: string;
  scssTokensPath?: string;
}) {
  const scssPath = args.scssTokensPath || process.env.SCSS_TOKENS_PATH;
  if (!scssPath || !fs.existsSync(scssPath)) {
    throw new Error('scssTokensPath or SCSS_TOKENS_PATH required and must exist');
  }

  const client = new FigmaClient();
  const stylesResult = await client.getStyles(args.targetFileKey);
  const figmaStyles = stylesResult.meta.styles;

  const scssContent = fs.readFileSync(scssPath, 'utf-8');
  const varRegex = /\$([a-zA-Z0-9_-]+)\s*:\s*([^;]+);/g;
  const scssVars: Record<string, string> = {};
  let match;
  while ((match = varRegex.exec(scssContent)) !== null) {
    scssVars[match[1].replace(/_/g, '-')] = match[2].trim();
  }

  const matched: Array<{ scssVar: string; figmaStyle: string; value: string }> = [];
  const unmatched: string[] = [];

  for (const [varName, value] of Object.entries(scssVars)) {
    const figmaStyle = figmaStyles.find(s =>
      s.name.toLowerCase().replace(/\s+/g, '-').replace(/\//g, '-').includes(varName) ||
      varName.includes(s.name.toLowerCase().replace(/\s+/g, '-'))
    );
    if (figmaStyle) {
      matched.push({ scssVar: `$${varName}`, figmaStyle: figmaStyle.name, value });
    } else {
      unmatched.push(`$${varName}`);
    }
  }

  const pluginScript = generateTokenUpdateScript(matched);

  return {
    matched,
    unmatched,
    pluginScript,
    instructions: [
      '1. Open Figma and navigate to your file',
      '2. Go to Plugins → Development → Open Console',
      '3. Paste the script below to update matched styles',
    ].join('\n'),
  };
}

function generateTokenUpdateScript(matched: Array<{ scssVar: string; figmaStyle: string; value: string }>): string {
  const updates = matched
    .filter(m => /^#[0-9a-fA-F]{3,8}$/.test(m.value))
    .slice(0, 20)
    .map(m => {
      const hex = m.value.replace('#', '');
      const r = parseInt(hex.slice(0, 2), 16) / 255;
      const g = parseInt(hex.slice(2, 4), 16) / 255;
      const b = parseInt(hex.slice(4, 6), 16) / 255;
      return `  // ${m.scssVar} → "${m.figmaStyle}": ${m.value}\n  // figma.getLocalPaintStyles().find(s => s.name === '${m.figmaStyle}')?.paints = [{ type: 'SOLID', color: { r: ${r.toFixed(3)}, g: ${g.toFixed(3)}, b: ${b.toFixed(3)} } }];`;
    })
    .join('\n');

  return `// Token Update Script — figma-angular-mcp
// Run in Figma Console to update ${matched.length} matched styles
(function() {
${updates}
  figma.notify('Token update script ready — uncomment lines to apply');
})();`;
}
