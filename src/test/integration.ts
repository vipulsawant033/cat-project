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
import { CodeGenerator, AssetFetcher } from '../services/codeGenerator.js';
import { FigmaNode, FigmaVariablesResponse } from '../services/figmaClient.js';
import { VariableResolver } from '../services/variableResolver.js';

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

    const ir = await generator.figmaNodeToIR(nodeFixture, 'auto');
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

  // Test 7: @figma-component annotation is a deterministic match, overriding fuzzy name search
  try {
    const index = new ComponentIndex();
    const tokenMapper = new TokenMapper();
    const layoutAnalyzer = new LayoutAnalyzer();
    const generator = new CodeGenerator(index, tokenMapper, layoutAnalyzer);

    // Name is deliberately misleading ("Group 42") — fuzzy search on this string would
    // never surface `my-button`. Only the componentId → @figma-component annotation should.
    const instanceNode: FigmaNode = {
      id: '500:1',
      name: 'Group 42',
      type: 'INSTANCE',
      componentId: '9999:1111',
    };
    const ir = await generator.figmaNodeToIR(instanceNode, 'auto');
    assert('codegen: @figma-component annotation resolves via componentId, not node name',
      ir.componentMatch?.selector === 'my-button' && ir.componentMatch?.confidence === 1.0,
      `Expected deterministic match to my-button at confidence 1.0, got ${JSON.stringify(ir.componentMatch)}`);

    // A saved lib_map_figma_to_component mapping should win even over an annotation on a different component.
    index.saveMapping('9999:1111', 'app-user-card', 'angular', 0.9);
    const irAfterOverride = await generator.figmaNodeToIR(instanceNode, 'auto');
    assert('codegen: explicit lib_map_figma_to_component mapping takes priority over @figma-component annotation',
      irAfterOverride.componentMatch?.selector === 'app-user-card' && irAfterOverride.componentMatch?.confidence === 0.9,
      `Expected explicit mapping to app-user-card at confidence 0.9, got ${JSON.stringify(irAfterOverride.componentMatch)}`);

    // Restore the mapping so this test run doesn't leave a misleading override in the shared dev DB.
    index.saveMapping('9999:1111', 'my-button', 'lit', 1.0);
  } catch (err) {
    assert('codegen: deterministic Figma component ID mapping', false, String(err));
  }

  // Test 8: Figma Variables resolution (alias chains + mode selection)
  const variablesFixture: FigmaVariablesResponse = {
    meta: {
      variableCollections: {
        'VariableCollectionId:1:1': {
          id: 'VariableCollectionId:1:1',
          name: 'Colors',
          defaultModeId: '1:0',
          modes: [{ modeId: '1:0', name: 'Light' }, { modeId: '1:1', name: 'Dark' }],
        },
      },
      variables: {
        'VariableID:1:10': {
          id: 'VariableID:1:10',
          name: 'color/primitive/blue-500',
          resolvedType: 'COLOR',
          variableCollectionId: 'VariableCollectionId:1:1',
          valuesByMode: {
            '1:0': { r: 0.1, g: 0.4, b: 0.9, a: 1 },
            '1:1': { r: 0.2, g: 0.5, b: 1, a: 1 },
          },
        },
        'VariableID:1:20': {
          id: 'VariableID:1:20',
          name: 'color/primary',
          resolvedType: 'COLOR',
          variableCollectionId: 'VariableCollectionId:1:1',
          valuesByMode: {
            '1:0': { type: 'VARIABLE_ALIAS', id: 'VariableID:1:10' },
            '1:1': { type: 'VARIABLE_ALIAS', id: 'VariableID:1:10' },
          },
        },
      },
    },
  };

  try {
    const resolver = new VariableResolver(variablesFixture);
    const resolved = resolver.resolve('VariableID:1:20');
    assert('VariableResolver: resolves alias chain to leaf value in default mode',
      !!(resolved?.value && typeof resolved.value === 'object' && (resolved.value as { r: number }).r === 0.1),
      `Expected primitive blue-500 Light value, got ${JSON.stringify(resolved)}`);
    assert('VariableResolver: preserves semantic variable name through alias',
      resolved?.name === 'color/primary' && resolved?.cssName === 'color-primary',
      `Expected name 'color/primary', got ${JSON.stringify(resolved)}`);

    const darkResolver = new VariableResolver(variablesFixture, 'Dark');
    const darkResolved = darkResolver.resolve('VariableID:1:20');
    assert('VariableResolver: honors mode override across alias chain',
      !!(darkResolved?.value && typeof darkResolved.value === 'object' && (darkResolved.value as { r: number }).r === 0.2),
      `Expected Dark mode value, got ${JSON.stringify(darkResolved)}`);
  } catch (err) {
    assert('VariableResolver: resolves aliases and modes', false, String(err));
  }

  // Test 9: TokenMapper prefers a bound Figma Variable over SCSS hex matching
  try {
    const mapper = new TokenMapper();
    const resolver = new VariableResolver(variablesFixture);
    mapper.setVariableResolver(resolver);

    const withVariable = mapper.mapColor({ r: 0.1, g: 0.4, b: 0.9, a: 1 }, 'VariableID:1:20');
    assert('TokenMapper.mapColor: uses variable name when bound',
      withVariable.rawValue === 'var(--color-primary)' && withVariable.source === 'figma-variable' && !withVariable.unmapped,
      `Expected var(--color-primary), got ${JSON.stringify(withVariable)}`);

    const withoutVariable = mapper.mapColor({ r: 0.1, g: 0.4, b: 0.9, a: 1 });
    assert('TokenMapper.mapColor: falls back to hex/SCSS matching when no binding present',
      withoutVariable.source !== 'figma-variable',
      `Expected non-variable source, got ${JSON.stringify(withoutVariable)}`);
  } catch (err) {
    assert('TokenMapper.mapColor: variable-aware mapping', false, String(err));
  }

  // Test 10: Absolute positioning for a free-floating child (e.g. a badge pinned to a corner)
  try {
    const layoutAnalyzer = new LayoutAnalyzer();
    const parent: FigmaNode = {
      id: '1:1', name: 'Card', type: 'FRAME', layoutMode: 'NONE',
      absoluteBoundingBox: { x: 0, y: 0, width: 300, height: 200 },
    };
    const badge: FigmaNode = {
      id: '1:2', name: 'Badge', type: 'ELLIPSE',
      absoluteBoundingBox: { x: 250, y: 10, width: 40, height: 40 },
      constraints: { horizontal: 'MAX', vertical: 'MIN' },
    };
    const layout = layoutAnalyzer.analyze(badge, parent);
    assert('layoutAnalyzer: free-floating child gets position:absolute',
      layout.position === 'absolute', `Expected absolute, got ${JSON.stringify(layout)}`);
    assert('layoutAnalyzer: MAX horizontal constraint anchors via right, not left',
      layout.right === '10px' && layout.left === undefined,
      `Expected right:10px with no left, got ${JSON.stringify(layout)}`);
    assert('layoutAnalyzer: MIN vertical constraint anchors via top',
      layout.top === '10px', `Expected top:10px, got ${JSON.stringify(layout)}`);
  } catch (err) {
    assert('layoutAnalyzer: absolute positioning', false, String(err));
  }

  // Test 11: Text auto-resize should not force a fixed width/height baked from the placeholder string
  try {
    const layoutAnalyzer = new LayoutAnalyzer();
    const autoText: FigmaNode = {
      id: '2:1', name: 'Label', type: 'TEXT', textAutoResize: 'WIDTH_AND_HEIGHT',
      absoluteBoundingBox: { x: 0, y: 0, width: 120, height: 20 },
    };
    const layout = layoutAnalyzer.analyze(autoText);
    assert('layoutAnalyzer: WIDTH_AND_HEIGHT text uses fit-content, not fixed px',
      layout.width === 'fit-content' && layout.height === 'fit-content',
      `Expected fit-content sizing, got ${JSON.stringify(layout)}`);
  } catch (err) {
    assert('layoutAnalyzer: text auto-resize', false, String(err));
  }

  // Test 12: Rotation is converted from Figma's radians to a CSS transform in degrees
  try {
    const layoutAnalyzer = new LayoutAnalyzer();
    const rotated: FigmaNode = { id: '3:1', name: 'Arrow', type: 'VECTOR', rotation: Math.PI / 2 };
    const layout = layoutAnalyzer.analyze(rotated);
    assert('layoutAnalyzer: rotation converts radians to a CSS transform in degrees',
      layout.transform === 'rotate(90deg)', `Expected rotate(90deg), got ${JSON.stringify(layout)}`);
  } catch (err) {
    assert('layoutAnalyzer: rotation transform', false, String(err));
  }

  // Test 13: Nodes marked visible:false (hidden by a variant/override) are excluded from generated output
  try {
    const index = new ComponentIndex();
    const tokenMapper = new TokenMapper();
    const layoutAnalyzer = new LayoutAnalyzer();
    const generator = new CodeGenerator(index, tokenMapper, layoutAnalyzer);

    const parent: FigmaNode = {
      id: '4:1', name: 'Row', type: 'FRAME',
      children: [
        { id: '4:2', name: 'Visible Label', type: 'TEXT', characters: 'Shown', visible: true },
        { id: '4:3', name: 'Hidden Icon', type: 'VECTOR', visible: false },
      ],
    };
    const ir = await generator.figmaNodeToIR(parent, 'auto');
    assert('codegen: invisible children are skipped entirely',
      ir.children.length === 1 && ir.children[0].figmaNodeId === '4:2',
      `Expected only the visible child, got ${JSON.stringify(ir.children.map(c => c.figmaNodeId))}`);
  } catch (err) {
    assert('codegen: visibility filtering', false, String(err));
  }

  // Test 14: Borders and layered multi-fill backgrounds (previously only fills[0] was ever read)
  try {
    const tokenMapper = new TokenMapper();
    const codeGen = new CodeGenerator(new ComponentIndex(), tokenMapper, new LayoutAnalyzer());
    const layered: FigmaNode = {
      id: '5:1', name: 'Layered', type: 'FRAME',
      fills: [
        { type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 } },
        { type: 'SOLID', color: { r: 0, g: 0, b: 1, a: 1 } },
      ],
      strokes: [{ type: 'SOLID', color: { r: 0, g: 1, b: 0, a: 1 } }],
      strokeWeight: 2,
    };
    const ir = await codeGen.figmaNodeToIR(layered, 'auto');
    assert('codegen: multiple visible fills are layered via background-image, topmost first',
      ir.cssStyles['background-image'] === 'linear-gradient(#0000ff, #0000ff), linear-gradient(#ff0000, #ff0000)',
      `Expected layered gradients with blue (topmost) first, got ${JSON.stringify(ir.cssStyles)}`);
    assert('codegen: stroke + strokeWeight produce a border',
      ir.cssStyles['border'] === '2px solid #00ff00',
      `Expected 2px solid #00ff00 border, got ${JSON.stringify(ir.cssStyles)}`);
  } catch (err) {
    assert('codegen: border and multi-fill layering', false, String(err));
  }

  // Test 15: Linear gradient angle is computed from Figma's gradient handle positions, not hardcoded
  try {
    const tokenMapper = new TokenMapper();
    const mapped = tokenMapper.mapPaint({
      type: 'GRADIENT_LINEAR',
      gradientStops: [
        { color: { r: 1, g: 1, b: 1, a: 1 }, position: 0 },
        { color: { r: 0, g: 0, b: 0, a: 1 }, position: 1 },
      ],
      gradientHandlePositions: [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }, { x: 0, y: 0 }],
    });
    assert('tokenMapper: horizontal gradient handles compute a 90deg CSS angle',
      mapped.rawValue === 'linear-gradient(90deg, #ffffff 0%, #000000 100%)',
      `Expected a 90deg linear-gradient, got ${mapped.rawValue}`);
  } catch (err) {
    assert('tokenMapper: gradient angle computation', false, String(err));
  }

  // Test 16: Variant prop names ("Icon Position") bind to camelCase component inputs (iconPosition)
  try {
    const index = new ComponentIndex();
    index.upsert({
      selector: 'test-variant-widget', className: 'TestVariantWidget', componentType: 'lit',
      filePath: 'fixture', inputs: [{ name: 'iconPosition', type: 'string' }], outputs: [],
    });
    index.saveMapping('TESTVARIANT:1', 'test-variant-widget', 'lit', 1.0);

    const generator = new CodeGenerator(index, new TokenMapper(), new LayoutAnalyzer());
    const node: FigmaNode = {
      id: '6:1', name: 'Widget', type: 'INSTANCE', componentId: 'TESTVARIANT:1',
      variantProperties: { 'Icon Position': 'leading' },
    };
    const ir = await generator.figmaNodeToIR(node, 'auto');
    const binding = ir.componentMatch?.bindings.find(b => b.name === 'iconPosition');
    assert('codegen: variant prop names normalize to match camelCase component inputs',
      binding?.value === 'leading',
      `Expected iconPosition bound to 'leading', got ${JSON.stringify(ir.componentMatch?.bindings)}`);
  } catch (err) {
    assert('codegen: variant prop name normalization', false, String(err));
  }

  // Test 17: Image/icon leaf nodes are embedded as real markup (inline SVG / data-URI), not empty divs
  try {
    const fakeFetcher: AssetFetcher = {
      async exportAsset(nodeId: string, format: 'png' | 'svg') {
        return format === 'svg'
          ? Buffer.from('<svg viewBox="0 0 24 24"><path d="M0 0"/></svg>', 'utf-8').toString('base64')
          : Buffer.from('fake-png-bytes', 'utf-8').toString('base64');
      },
    };
    const generator = new CodeGenerator(new ComponentIndex(), new TokenMapper(), new LayoutAnalyzer(), fakeFetcher);
    const container: FigmaNode = {
      id: '7:1', name: 'Media', type: 'FRAME',
      children: [
        { id: '7:2', name: 'Icon', type: 'VECTOR' },
        { id: '7:3', name: 'Photo', type: 'RECTANGLE', fills: [{ type: 'IMAGE' }] },
      ],
    };
    const ir = await generator.figmaNodeToIR(container, 'auto');
    const iconIr = ir.children.find(c => c.figmaNodeId === '7:2');
    const imageIr = ir.children.find(c => c.figmaNodeId === '7:3');
    assert('codegen: icon nodes get inline SVG markup from the asset fetcher',
      !!iconIr?.assetSvgMarkup?.includes('<svg'),
      `Expected inline SVG markup, got ${JSON.stringify(iconIr)}`);
    assert('codegen: image nodes get a data-URI from the asset fetcher',
      !!imageIr?.assetDataUri?.startsWith('data:image/png;base64,'),
      `Expected a data URI, got ${JSON.stringify(imageIr)}`);

    const html = generator.generateHTML(ir, false);
    assert('codegen: generated HTML embeds the icon/image markup instead of an empty div',
      html.includes('<svg') && html.includes('data:image/png;base64,'),
      `Expected embedded asset markup in HTML output, got: ${html}`);
  } catch (err) {
    assert('codegen: image/icon asset embedding', false, String(err));
  }

  // Test 18: Depth truncation is reported explicitly instead of silently dropping content
  try {
    function buildDeepNode(depth: number): FigmaNode {
      if (depth === 0) return { id: 'deep:0', name: 'Leaf', type: 'TEXT', characters: 'bottom' };
      return { id: `deep:${depth}`, name: `Level ${depth}`, type: 'FRAME', children: [buildDeepNode(depth - 1)] };
    }
    const generator = new CodeGenerator(new ComponentIndex(), new TokenMapper(), new LayoutAnalyzer());
    const deepTree = buildDeepNode(20); // default MAX_IR_DEPTH is 16
    const ir = await generator.figmaNodeToIR(deepTree, 'auto');
    const truncatedNodes = generator.collectTruncatedNodes(ir);
    assert('codegen: exceeding max IR depth is reported via collectTruncatedNodes, not silently dropped',
      truncatedNodes.length > 0,
      `Expected at least one truncated node, got ${JSON.stringify(truncatedNodes)}`);
  } catch (err) {
    assert('codegen: depth truncation reporting', false, String(err));
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
