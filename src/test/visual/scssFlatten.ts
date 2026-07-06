/**
 * Minimal flattener for the SCSS shape CodeGenerator.generateSCSS produces: a flat sequence of
 * `selector { prop: value; }` blocks nested purely via brace depth (no &, no media queries, no
 * mixins). Not a general SCSS compiler — it only needs to handle our own generator's output.
 */
interface ScssRule {
  selector: string;
  declarations: string[];
  children: ScssRule[];
}

function parseScss(scss: string): ScssRule {
  const lines = scss.split('\n').map(l => l.trim()).filter(Boolean);
  let i = 0;

  function parseBlock(selector: string): ScssRule {
    const rule: ScssRule = { selector, declarations: [], children: [] };
    while (i < lines.length) {
      const line = lines[i];
      if (line === '}') {
        i++;
        return rule;
      }
      if (line.endsWith('{')) {
        const childSelector = line.slice(0, -1).trim();
        i++;
        rule.children.push(parseBlock(childSelector));
      } else {
        rule.declarations.push(line);
        i++;
      }
    }
    return rule;
  }

  const first = lines[i];
  const rootSelector = first.slice(0, -1).trim();
  i++;
  return parseBlock(rootSelector);
}

function flattenRule(rule: ScssRule, ancestors: string[]): string {
  const selectorPath = [...ancestors, rule.selector].join(' ');
  const ownBlock = rule.declarations.length
    ? `${selectorPath} {\n  ${rule.declarations.join('\n  ')}\n}\n`
    : '';
  const childBlocks = rule.children
    .map(child => flattenRule(child, [...ancestors, rule.selector]))
    .join('\n');
  return ownBlock + childBlocks;
}

export function flattenScssToCss(scss: string): string {
  if (!scss.trim()) return '';
  const root = parseScss(scss);
  return flattenRule(root, []);
}
