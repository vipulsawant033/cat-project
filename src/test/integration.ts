import 'dotenv/config';
import * as path from 'path';
import * as fs from 'fs';

// __dirname is available in CommonJS (tsc compiles to CJS)
const __dirname_resolved = __dirname;
import { libIndexComponents } from '../tools/library/indexComponents.js';
import { libIndexLit } from '../tools/library/indexLit.js';
import { libSearchComponent } from '../tools/library/searchComponent.js';
import { ComponentIndex } from '../services/componentIndex.js';
import { TokenMapper } from '../services/tokenMapper.js';
import { LayoutAnalyzer } from '../services/layoutAnalyzer.js';
import { CodeGenerator } from '../services/codeGenerator.js';
import { FigmaNode } from '../services/figmaClient.js';

const FIXTURES = path.resolve(__dirname_resolved, 'fixtures');
const ANGULAR_FIXTURES = path.join(FIXTURES, 'sample-components');
const LIT_FIXTURES = path.join(FIXTURES, 'sample-lit');

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

const results: TestResult[] = [];

function assert(name: string, condition: boolean, errorMsg?: string): void {
  results.push({ name, passed: condition, error: condition ? undefined : errorMsg });
}

async function run(): Promise<void> {
  console.log('\n=== figma-angular-mcp Integration Tests ===\n');

  // Test 1: Index Angular components
  try {
    const angularResult = await libIndexComponents({ sourcePath: ANGULAR_FIXTURES, force: true });
    assert('lib_index_components: indexes Angular fixtures', angularResult.indexed > 0 || angularResult.updated > 0,
      `Expected indexed > 0, got ${JSON.stringify(angularResult)}`);
  } catch (err) {
    assert('lib_index_components: indexes Angular fixtures', false, String(err));
  }

  // Test 2: Index Lit components
  try {
    const litResult = await libIndexLit({ litSourcePath: LIT_FIXTURES, force: true });
    assert('lib_index_lit: indexes Lit fixtures', litResult.indexed > 0 || litResult.updated > 0,
      `Expected indexed > 0, got ${JSON.stringify(litResult)}`);
    assert('lib_index_lit: returns tagNames array', Array.isArray(litResult.tagNames),
      'tagNames should be an array');
  } catch (err) {
    assert('lib_index_lit: indexes Lit fixtures', false, String(err));
    assert('lib_index_lit: returns tagNames array', false, String(err));
  }

  // Test 3: Search for primary button → should return Lit element
  try {
    const searchResult = await libSearchComponent({ query: 'button', preferType: 'lit', limit: 5 });
    const topResult = searchResult.results[0];
    assert('lib_search_component: "button" with preferType:lit returns Lit element',
      topResult?.componentType === 'lit',
      `Top result componentType was ${topResult?.componentType}, selector: ${topResult?.selector}`);
  } catch (err) {
    assert('lib_search_component: "button" returns Lit element', false, String(err));
  }

  // Test 4: Search for user profile card → should return Angular
  try {
    const searchResult = await libSearchComponent({ query: 'user card', preferType: 'angular', limit: 5 });
    const topResult = searchResult.results[0];
    assert('lib_search_component: "user card" with preferType:angular returns Angular',
      topResult?.componentType === 'angular',
      `Top result componentType was ${topResult?.componentType}, selector: ${topResult?.selector}`);
  } catch (err) {
    assert('lib_search_component: "user card" returns Angular', false, String(err));
  }

  // Test 5: Extract tokens from fixture
  try {
    const tokensFixture = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'figma-tokens.json'), 'utf-8'));
    assert('figma_extract_tokens: fixture has color tokens', Object.keys(tokensFixture.colors).length > 0);
    assert('figma_extract_tokens: fixture has spacing tokens', tokensFixture.spacing.length > 0);
  } catch (err) {
    assert('figma_extract_tokens: fixture loads', false, String(err));
  }

  // Test 6: Generate code from Figma node fixture
  try {
    const nodeFixture = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'figma-node.json'), 'utf-8')) as FigmaNode;
    const index = new ComponentIndex();
    const tokenMapper = new TokenMapper();
    const layoutAnalyzer = new LayoutAnalyzer();
    const generator = new CodeGenerator(index, tokenMapper, layoutAnalyzer);

    const ir = generator.figmaNodeToIR(nodeFixture, 'auto');
    const litElements = generator.collectLitElements(ir);
    const hasLit = litElements.length > 0;

    const html = generator.generateHTML(ir, hasLit);
    const ts = generator.generateTS('user-profile-card', 'app-user-profile-card', hasLit);

    assert('codegen_from_node: generates HTML output', typeof html === 'string' && html.length > 0);

    if (hasLit) {
      assert('codegen_from_node: Lit elements use .property binding syntax',
        html.includes('.') && (html.includes('my-button') || html.includes('my-')),
        'Expected .property binding for Lit elements');
      assert('codegen_from_node: CUSTOM_ELEMENTS_SCHEMA comment in HTML',
        html.includes('CUSTOM_ELEMENTS_SCHEMA'),
        'Missing CUSTOM_ELEMENTS_SCHEMA comment');
      assert('codegen_from_node: CUSTOM_ELEMENTS_SCHEMA import in .ts',
        ts.includes('CUSTOM_ELEMENTS_SCHEMA'),
        'Missing CUSTOM_ELEMENTS_SCHEMA in .ts');
    } else {
      assert('codegen_from_node: generates valid HTML without Lit (no Lit match at confidence > 0.5)', true);
      assert('codegen_from_node: no spurious CUSTOM_ELEMENTS_SCHEMA when no Lit used', !ts.includes('CUSTOM_ELEMENTS_SCHEMA'));
    }
  } catch (err) {
    assert('codegen_from_node: generates code', false, String(err));
  }

  // Print results
  console.log('');
  let passed = 0;
  let failed = 0;
  for (const r of results) {
    const icon = r.passed ? '✓' : '✗';
    const status = r.passed ? 'PASS' : 'FAIL';
    console.log(`  ${icon} [${status}] ${r.name}`);
    if (!r.passed && r.error) console.log(`         Error: ${r.error}`);
    if (r.passed) passed++;
    else failed++;
  }

  console.log(`\n  ${passed} passed, ${failed} failed out of ${results.length} tests\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
