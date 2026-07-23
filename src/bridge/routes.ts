import { Router } from 'express';
import { runGenerateAngularComponent } from '../core/generate-angular-component.js';
import { runGenerateAngularPage } from '../core/generate-angular-page.js';
import { runFigmaGetFile } from '../core/figma-get-file.js';
import { runFigmaGetNode } from '../core/figma-get-node.js';
import { runFigmaExtractTokens } from '../core/figma-extract-tokens.js';
import { runFigmaGetComponentSet } from '../core/figma-get-component-set.js';
import { runFigmaExportNodeImage } from '../core/figma-export-node-image.js';
import { runLibIndexComponents } from '../core/lib-index-components.js';
import { runLibSearchComponent } from '../core/lib-search-component.js';
import { runLibGetComponent } from '../core/lib-get-component.js';
import { runLibMapFigmaToComponent } from '../core/lib-map-figma-to-component.js';
import { runLibListMappings } from '../core/lib-list-mappings.js';
import { runCodegenDiff } from '../core/codegen-diff.js';
import { runCodegenValidate } from '../core/codegen-validate.js';
import { runCodegenDetectDrift } from '../core/codegen-detect-drift.js';
import { runManifestList } from '../core/manifest-list.js';
import { runCodegenAutoRegenerate } from '../core/codegen-auto-regenerate.js';
import {
  GenerateAngularComponentInput,
  GenerateAngularPageInput,
  FigmaGetFileInput,
  FigmaGetNodeInput,
  FigmaExtractTokensInput,
  FigmaGetComponentSetInput,
  FigmaExportNodeImageInput,
  LibIndexComponentsInput,
  LibSearchComponentInput,
  LibGetComponentInput,
  LibMapFigmaToComponentInput,
  LibListMappingsInput,
  CodegenDiffInput,
  CodegenValidateInput,
  CodegenDetectDriftInput,
  ManifestListInput,
  CodegenAutoRegenerateInput,
} from '../types.js';

/**
 * REST bridge routes. Each route wraps one MCP tool so AI systems that only
 * speak plain HTTP/JSON (custom GPT Actions, LangChain HTTP tools, internal
 * agent frameworks, curl/Postman, etc.) can use the same functionality as
 * MCP-native clients, without needing an MCP client implementation.
 *
 * To expose a new tool over REST: add a route here calling the same
 * src/core/<tool>.ts function used by its MCP tool registration, and add an
 * entry to the TOOL_MANIFEST below so GET /tools stays accurate.
 */

const TOOL_MANIFEST = [
  {
    name: 'generate_angular_component',
    method: 'POST',
    path: '/tools/generate-angular-component',
    description:
      'Fetches a Figma component/frame from a share link and generates an equivalent standalone ' +
      'Angular component (TypeScript, HTML template, and SCSS). By default also serves it on a local ' +
      'Angular dev server (see `serve` / the response\'s `preview` field) — requires the one-time ' +
      '`npm run preview:setup` to have been run first.',
    exampleRequestBody: {
      figmaLink: 'https://www.figma.com/design/<fileKey>/<title>?node-id=12-34',
      writeToDisk: false,
      serve: true,
    },
  },
  {
    name: 'generate_angular_page',
    method: 'POST',
    path: '/tools/generate-angular-page',
    description:
      'Fetches a whole Figma screen/frame and generates a composing Angular "page" component plus one ' +
      'standalone component per top-level section, instead of one flat file covering the entire screen.',
    exampleRequestBody: {
      figmaLink: 'https://www.figma.com/design/<fileKey>/<title>?node-id=12-34',
      writeToDisk: false,
      serve: true,
    },
  },
  {
    name: 'figma_get_file',
    method: 'POST',
    path: '/tools/figma-get-file',
    description: "Fetches a Figma file's document tree as a depth-limited summary.",
    exampleRequestBody: { figmaLink: 'https://www.figma.com/design/<fileKey>/<title>', maxDepth: 4 },
  },
  {
    name: 'figma_get_node',
    method: 'POST',
    path: '/tools/figma-get-node',
    description: 'Fetches the full raw Figma node a share link points to.',
    exampleRequestBody: { figmaLink: 'https://www.figma.com/design/<fileKey>/<title>?node-id=12-34' },
  },
  {
    name: 'figma_extract_tokens',
    method: 'POST',
    path: '/tools/figma-extract-tokens',
    description: 'Fetches and normalizes every design-token variable defined in a Figma file.',
    exampleRequestBody: { figmaLink: 'https://www.figma.com/design/<fileKey>/<title>' },
  },
  {
    name: 'figma_get_component_set',
    method: 'POST',
    path: '/tools/figma-get-component-set',
    description: "Fetches a Figma COMPONENT_SET's variant property definitions and variants.",
    exampleRequestBody: { figmaLink: 'https://www.figma.com/design/<fileKey>/<title>?node-id=12-34' },
  },
  {
    name: 'figma_export_node_image',
    method: 'POST',
    path: '/tools/figma-export-node-image',
    description: 'Renders a Figma node to PNG as a signed URL or inline base64.',
    exampleRequestBody: { figmaLink: 'https://www.figma.com/design/<fileKey>/<title>?node-id=12-34', scale: 2, format: 'url' },
  },
  {
    name: 'lib_index_components',
    method: 'POST',
    path: '/tools/lib-index-components',
    description: 'Scans an Angular workspace/library for @Component classes and persists a searchable index.',
    exampleRequestBody: { libraryDir: '/path/to/angular-library' },
  },
  {
    name: 'lib_search_component',
    method: 'POST',
    path: '/tools/lib-search-component',
    description: 'Searches the persisted component index by selector/class-name substring.',
    exampleRequestBody: { query: 'button' },
  },
  {
    name: 'lib_get_component',
    method: 'POST',
    path: '/tools/lib-get-component',
    description: 'Looks up one component by exact selector or class name in the persisted index.',
    exampleRequestBody: { selector: 'cat-button' },
  },
  {
    name: 'lib_map_figma_to_component',
    method: 'POST',
    path: '/tools/lib-map-figma-to-component',
    description: 'Persists a Figma component -> Angular selector + property mapping.',
    exampleRequestBody: {
      figmaComponentKey: 'abc123',
      figmaComponentName: 'CAT/Button',
      angularSelector: 'cat-button',
      propertyMappings: { Style: 'variant', Size: 'size' },
    },
  },
  {
    name: 'lib_list_mappings',
    method: 'POST',
    path: '/tools/lib-list-mappings',
    description: 'Returns every persisted Figma -> Angular component mapping.',
    exampleRequestBody: {},
  },
  {
    name: 'codegen_diff',
    method: 'POST',
    path: '/tools/codegen-diff',
    description:
      'Generates + serves the component, screenshots it live via a headless browser, and pixel-diffs it ' +
      'against Figma\'s own PNG export. Requires preview:setup and `npx playwright install chromium`.',
    exampleRequestBody: {
      figmaLink: 'https://www.figma.com/design/<fileKey>/<title>?node-id=12-34',
      maxMismatchRatio: 0.02,
    },
  },
  {
    name: 'codegen_validate',
    method: 'POST',
    path: '/tools/codegen-validate',
    description: 'Reports which component instances in a frame have no lib_map_figma_to_component mapping.',
    exampleRequestBody: { figmaLink: 'https://www.figma.com/design/<fileKey>/<title>?node-id=12-34' },
  },
  {
    name: 'codegen_detect_drift',
    method: 'POST',
    path: '/tools/codegen-detect-drift',
    description: "Compares a Figma node's current content hash against its last recorded generation.",
    exampleRequestBody: { figmaLink: 'https://www.figma.com/design/<fileKey>/<title>?node-id=12-34' },
  },
  {
    name: 'manifest_list',
    method: 'POST',
    path: '/tools/manifest-list',
    description: 'Returns every persisted round-trip manifest entry (generation history).',
    exampleRequestBody: {},
  },
  {
    name: 'codegen_auto_regenerate',
    method: 'POST',
    path: '/tools/codegen-auto-regenerate',
    description:
      'Skips regeneration if the manifest shows this node unchanged and already passing; otherwise ' +
      'regenerates + diffs and, on failure, bundles codegen_validate\'s unmapped-instance list as the next fix.',
    exampleRequestBody: {
      figmaLink: 'https://www.figma.com/design/<fileKey>/<title>?node-id=12-34',
      maxMismatchRatio: 0.02,
    },
  },
];

export function createBridgeRouter(): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  router.get('/tools', (_req, res) => {
    res.json({ tools: TOOL_MANIFEST });
  });

  router.post('/tools/generate-angular-component', async (req, res) => {
    const parsed = GenerateAngularComponentInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request body', details: parsed.error.flatten() });
      return;
    }

    try {
      const output = await runGenerateAngularComponent(parsed.data);
      res.json(output);
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  registerJsonRoute(router, '/tools/generate-angular-page', GenerateAngularPageInput, runGenerateAngularPage);
  registerJsonRoute(router, '/tools/figma-get-file', FigmaGetFileInput, runFigmaGetFile);
  registerJsonRoute(router, '/tools/figma-get-node', FigmaGetNodeInput, runFigmaGetNode);
  registerJsonRoute(router, '/tools/figma-extract-tokens', FigmaExtractTokensInput, runFigmaExtractTokens);
  registerJsonRoute(router, '/tools/figma-get-component-set', FigmaGetComponentSetInput, runFigmaGetComponentSet);
  registerJsonRoute(router, '/tools/figma-export-node-image', FigmaExportNodeImageInput, runFigmaExportNodeImage);
  registerJsonRoute(router, '/tools/lib-index-components', LibIndexComponentsInput, runLibIndexComponents);
  registerJsonRoute(router, '/tools/lib-search-component', LibSearchComponentInput, runLibSearchComponent);
  registerJsonRoute(router, '/tools/lib-get-component', LibGetComponentInput, runLibGetComponent);
  registerJsonRoute(router, '/tools/lib-map-figma-to-component', LibMapFigmaToComponentInput, runLibMapFigmaToComponent);
  registerJsonRoute(router, '/tools/lib-list-mappings', LibListMappingsInput, runLibListMappings);
  registerJsonRoute(router, '/tools/codegen-diff', CodegenDiffInput, runCodegenDiff);
  registerJsonRoute(router, '/tools/codegen-validate', CodegenValidateInput, runCodegenValidate);
  registerJsonRoute(router, '/tools/codegen-detect-drift', CodegenDetectDriftInput, runCodegenDetectDrift);
  registerJsonRoute(router, '/tools/manifest-list', ManifestListInput, runManifestList);
  registerJsonRoute(router, '/tools/codegen-auto-regenerate', CodegenAutoRegenerateInput, runCodegenAutoRegenerate);

  return router;
}

/** Shared shape for the simpler read-only tool routes: validate body against `schema`, call `run`, return JSON. */
function registerJsonRoute<Input, Output>(
  router: Router,
  path: string,
  schema: { safeParse: (data: unknown) => { success: true; data: Input } | { success: false; error: { flatten: () => unknown } } },
  run: (input: Input) => Promise<Output>
): void {
  router.post(path, async (req, res) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request body', details: parsed.error.flatten() });
      return;
    }
    try {
      const output = await run(parsed.data);
      res.json(output);
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });
}
