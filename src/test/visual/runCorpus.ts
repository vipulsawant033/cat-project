import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { chromium, Browser } from 'playwright';
import { ComponentIndex } from '../../services/componentIndex.js';
import { TokenMapper } from '../../services/tokenMapper.js';
import { LayoutAnalyzer } from '../../services/layoutAnalyzer.js';
import { CodeGenerator } from '../../services/codeGenerator.js';
import { FigmaNode } from '../../services/figmaClient.js';
import { libIndexComponents } from '../../tools/library/indexComponents.js';
import { libIndexLit } from '../../tools/library/indexLit.js';
import { flattenScssToCss } from './scssFlatten.js';

// __dirname is available in CommonJS (tsc compiles to CJS)
const __dirname_resolved = __dirname;
const FIXTURES_DIR = path.join(__dirname_resolved, 'fixtures');
const BASELINES_DIR = path.join(__dirname_resolved, 'baselines');
const ANGULAR_COMPONENT_FIXTURES = path.resolve(__dirname_resolved, '../fixtures/sample-components');
const LIT_COMPONENT_FIXTURES = path.resolve(__dirname_resolved, '../fixtures/sample-lit');
const HISTORY_PATH = path.resolve('./data/visual-regression-history.json');
const TEST_DB_PATH = path.resolve('./data/visual-test-component-map.db');

/**
 * This is a regression suite, not a Figma-fidelity suite: fixtures are synthetic FigmaNode JSON
 * (no live Figma file), and each fixture's own first screenshot becomes its baseline. Failures
 * mean "this fixture's rendered output changed since last time" — a real drift signal even
 * without a Figma reference image — not "this doesn't match the real design."
 */
// Rendering is deterministic on a given machine/Chromium build (confirmed: unchanged fixtures
// re-run at exactly 100.00%), so this stays tight — small amount of slack for cross-platform
// font/subpixel rendering noise in CI, not for tolerating real regressions.
const MATCH_THRESHOLD = 0.999;

interface FixtureResult {
  name: string;
  matchPercentage: number;
  passed: boolean;
  baselineEstablished: boolean;
}

async function runFixture(name: string, node: FigmaNode, generator: CodeGenerator, browser: Browser): Promise<FixtureResult> {
  const ir = await generator.figmaNodeToIR(node, 'auto');
  const hasLit = generator.collectLitElements(ir).length > 0;
  const html = generator.generateHTML(ir, hasLit);
  const scss = generator.generateSCSS(ir, name);
  const css = flattenScssToCss(scss);

  // Wraps the template in a `.componentName` shell to stand in for the Angular host element
  // that generateSCSS's `.componentName { ... }` wrapper assumes exists at runtime.
  const fullHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>` +
    `html,body{margin:0;padding:0;}${css}</style></head>` +
    `<body><div class="${name}">${html}</div></body></html>`;

  // Sized to the fixture's own content instead of a fixed large canvas — otherwise a small
  // rotated/shifted element gets diluted by surrounding whitespace and the diff underreports it.
  const viewportWidth = Math.ceil(node.absoluteBoundingBox?.width ?? 400);
  const viewportHeight = Math.ceil(node.absoluteBoundingBox?.height ?? 300);
  const page = await browser.newPage({ viewport: { width: viewportWidth, height: viewportHeight } });
  let screenshotBuffer: Buffer;
  try {
    await page.setContent(fullHtml, { waitUntil: 'load' });
    screenshotBuffer = await page.screenshot();
  } finally {
    await page.close();
  }

  const baselinePath = path.join(BASELINES_DIR, `${name}.png`);
  if (!fs.existsSync(baselinePath)) {
    fs.writeFileSync(baselinePath, screenshotBuffer);
    return { name, matchPercentage: 100, passed: true, baselineEstablished: true };
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pixelmatch = require('pixelmatch') as (img1: Buffer, img2: Buffer, out: Buffer, w: number, h: number, opts?: object) => number;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { PNG } = require('pngjs') as typeof import('pngjs');

  const img1 = PNG.sync.read(fs.readFileSync(baselinePath));
  const img2 = PNG.sync.read(screenshotBuffer);
  const width = Math.min(img1.width, img2.width);
  const height = Math.min(img1.height, img2.height);
  const diff = new PNG({ width, height });
  const pixelsDifferent = pixelmatch(img1.data, img2.data, diff.data, width, height, { threshold: 0.1 });
  const totalPixels = width * height;
  const matchPercentage = totalPixels === 0 ? 0 : (1 - pixelsDifferent / totalPixels) * 100;
  const passed = matchPercentage / 100 >= MATCH_THRESHOLD;

  if (!passed) {
    fs.writeFileSync(path.join(BASELINES_DIR, `${name}.diff.png`), PNG.sync.write(diff));
  }

  return { name, matchPercentage: Math.round(matchPercentage * 100) / 100, passed, baselineEstablished: false };
}

function appendHistory(results: FixtureResult[]): void {
  const dir = path.dirname(HISTORY_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const history: Array<{ timestamp: string; results: FixtureResult[] }> = fs.existsSync(HISTORY_PATH)
    ? JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf-8'))
    : [];
  history.push({ timestamp: new Date().toISOString(), results });
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2));
}

function printReport(results: FixtureResult[]): void {
  console.log('\n=== Visual Regression Suite ===\n');
  const sorted = [...results].sort((a, b) => a.matchPercentage - b.matchPercentage);
  for (const r of sorted) {
    const icon = r.baselineEstablished ? '○' : (r.passed ? '✓' : '✗');
    const label = r.baselineEstablished ? 'BASELINE SAVED' : (r.passed ? 'PASS' : 'FAIL');
    console.log(`  ${icon} [${label}] ${r.name}: ${r.matchPercentage.toFixed(2)}%`);
  }

  const measured = results.filter(r => !r.baselineEstablished);
  if (measured.length) {
    const avg = measured.reduce((sum, r) => sum + r.matchPercentage, 0) / measured.length;
    const worst = [...measured].sort((a, b) => a.matchPercentage - b.matchPercentage)[0];
    console.log(`\n  Avg match: ${avg.toFixed(2)}% | Worst offender: ${worst.name} (${worst.matchPercentage.toFixed(2)}%)`);
  }

  const failed = results.filter(r => !r.passed && !r.baselineEstablished).length;
  console.log(`\n  ${results.length - failed} passed, ${failed} failed out of ${results.length} fixtures\n`);
}

async function main(): Promise<void> {
  // Isolated from the real dev DB so this suite's results are reproducible and don't depend on
  // (or pollute) whatever a developer has indexed locally.
  process.env.DB_PATH = TEST_DB_PATH;
  if (!fs.existsSync(BASELINES_DIR)) fs.mkdirSync(BASELINES_DIR, { recursive: true });

  await libIndexComponents({ sourcePath: ANGULAR_COMPONENT_FIXTURES, force: true });
  await libIndexLit({ litSourcePath: LIT_COMPONENT_FIXTURES, force: true });

  const index = new ComponentIndex();
  const tokenMapper = new TokenMapper();
  const layoutAnalyzer = new LayoutAnalyzer();
  const generator = new CodeGenerator(index, tokenMapper, layoutAnalyzer);

  const fixtureFiles = fs.readdirSync(FIXTURES_DIR).filter(f => f.endsWith('.json'));
  const browser = await chromium.launch();
  const results: FixtureResult[] = [];

  try {
    for (const file of fixtureFiles) {
      const name = path.basename(file, '.json');
      const node = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, file), 'utf-8')) as FigmaNode;
      results.push(await runFixture(name, node, generator, browser));
    }
  } finally {
    await browser.close();
  }

  appendHistory(results);
  printReport(results);

  const anyFailed = results.some(r => !r.passed && !r.baselineEstablished);
  process.exit(anyFailed ? 1 : 0);
}

main().catch(err => {
  console.error('Visual regression runner error:', err);
  process.exit(1);
});
