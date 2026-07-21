import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '..', '.env') });
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { logger } from './utils/logger.js';

// Tool implementations
import { figmaGetFile } from './tools/figma/getFile.js';
import { figmaGetNode } from './tools/figma/getNode.js';
import { figmaGetNodeOutline } from './tools/figma/getNodeOutline.js';
import { figmaGetNodeVariables } from './tools/figma/getNodeVariables.js';
import { figmaExtractTokens } from './tools/figma/extractTokens.js';
import { figmaGetComponentSet } from './tools/figma/getComponentSet.js';
import { figmaExportNodeImage } from './tools/figma/exportNodeImage.js';
import { libIndexComponents } from './tools/library/indexComponents.js';
import { libIndexLit } from './tools/library/indexLit.js';
import { libSearchComponent } from './tools/library/searchComponent.js';
import { libGetComponent } from './tools/library/getComponent.js';
import { libMapFigmaToComponent } from './tools/library/mapFigmaToComponent.js';
import { libListMappings } from './tools/library/listMappings.js';
import { codegenFromNode } from './tools/codegen/fromNode.js';
import { codegenFromFile } from './tools/codegen/fromFile.js';
import { codegenValidate } from './tools/codegen/validate.js';
import { codegenDiff } from './tools/codegen/diff.js';

const args = process.argv.slice(2);
const watchMode = args.includes('--watch');
const indexOnly = args.includes('--index-only');
const indexLitOnly = args.includes('--index-lit-only');

const TOOLS = [
  {
    name: 'figma_get_file',
    description: 'Fetches the full Figma file tree trimmed to depth 5. USE THIS WHEN you need an overview of a Figma file structure, component catalog, or design system layout. Returns document tree, node count, styles, and optionally component definitions. If the tree is too large, automatically falls back to a structural outline instead of failing (see truncated/outline fields); pass forceRaw:true to bypass this and always get the full/raw shape.',
    inputSchema: {
      type: 'object',
      properties: {
        fileKey: { type: 'string', description: 'Figma file key from the URL (e.g. abc123XYZ)' },
        includeComponents: { type: 'boolean', description: 'Include component and component set definitions' },
        forceRaw: { type: 'boolean', description: 'Bypass the response-size guard and always return the full document shape, even if it may exceed the MCP size limit' },
      },
      required: ['fileKey'],
    },
  },
  {
    name: 'figma_get_node',
    description: 'Fetches a single Figma node and its subtree up to a configurable depth, plus a screenshot by default. USE THIS WHEN you have a specific Figma frame or component node ID and want to inspect its structure and properties for code generation. For a cheap structural preview before fetching full style data, use figma_get_node_outline first. If the tree is too large, automatically falls back to a structural outline instead of failing (see truncated/outline fields); pass forceRaw:true to bypass this and always get the full/raw shape.',
    inputSchema: {
      type: 'object',
      properties: {
        fileKey: { type: 'string', description: 'Figma file key' },
        nodeId: { type: 'string', description: 'Node ID (e.g. 123:456)' },
        depth: { type: 'number', description: 'Max depth of subtree to return (default 3)' },
        forceRaw: { type: 'boolean', description: 'Bypass the response-size guard and always return the full document shape, even if it may exceed the MCP size limit' },
        excludeScreenshot: { type: 'boolean', description: 'Skip exporting a screenshot of the node (default false — a screenshot is exported and its file path returned by default)' },
      },
      required: ['fileKey', 'nodeId'],
    },
  },
  {
    name: 'figma_get_node_outline',
    description: 'Returns a lightweight structural outline (id, name, type, depth, path, hasChildren, childCount) of a Figma node and all its descendants, with no style/geometry data. USE THIS FIRST to cheaply browse a node\'s structure and find the specific child nodeId you actually need, before calling figma_get_node (which returns full per-node style data and can be large for wide or deep trees) or codegen_from_node.',
    inputSchema: {
      type: 'object',
      properties: {
        fileKey: { type: 'string', description: 'Figma file key' },
        nodeId: { type: 'string', description: 'Node ID (e.g. 123:456)' },
        maxNodes: { type: 'number', description: 'Cap on number of outline entries returned (default 500)' },
      },
      required: ['fileKey', 'nodeId'],
    },
  },
  {
    name: 'figma_get_node_variables',
    description: 'Returns only the Figma Variables (design tokens) actually bound to a specific node and its descendants, resolved to concrete values. USE THIS WHEN you need the variables relevant to one component/frame rather than the whole file. For a file-wide token/variable catalog, use figma_extract_tokens instead.',
    inputSchema: {
      type: 'object',
      properties: {
        fileKey: { type: 'string', description: 'Figma file key' },
        nodeId: { type: 'string', description: 'Node ID (e.g. 123:456)' },
      },
      required: ['fileKey', 'nodeId'],
    },
  },
  {
    name: 'figma_extract_tokens',
    description: 'Extracts all design tokens (colors, typography, spacing, shadows, radii) from a Figma file. USE THIS BEFORE code generation to populate the token map for accurate CSS variable mapping. Writes results to data/token-cache.json.',
    inputSchema: {
      type: 'object',
      properties: {
        fileKey: { type: 'string', description: 'Figma file key' },
      },
      required: ['fileKey'],
    },
  },
  {
    name: 'figma_get_component_set',
    description: 'Retrieves Figma component sets and their variant definitions. USE THIS WHEN you need to understand what variants a Figma component supports before mapping to Angular @Input() or Lit @property() bindings.',
    inputSchema: {
      type: 'object',
      properties: {
        fileKey: { type: 'string', description: 'Figma file key' },
        componentSetId: { type: 'string', description: 'Optional specific component set ID to fetch' },
      },
      required: ['fileKey'],
    },
  },
  {
    name: 'figma_export_node_image',
    description: 'Exports a Figma node as a PNG or SVG image, saved to disk (default response includes only the file path to save tokens). USE THIS WHEN you need a visual reference for the design, or when running codegen_validate to compare rendered output against the Figma design.',
    inputSchema: {
      type: 'object',
      properties: {
        fileKey: { type: 'string', description: 'Figma file key' },
        nodeId: { type: 'string', description: 'Node ID to export' },
        scale: { type: 'number', description: 'Export scale (1-4, default 2)' },
        format: { type: 'string', enum: ['png', 'svg'], description: 'Export format (default png)' },
        enableBase64Response: { type: 'boolean', description: 'Include the full base64-encoded image inline in the response (default false — response includes only a filePath by default to save tokens)' },
      },
      required: ['fileKey', 'nodeId'],
    },
  },
  {
    name: 'lib_index_components',
    description: 'Scans the Angular source directory and indexes all Angular components into the SQLite database. USE THIS WHEN setting up the server for the first time, or after adding/changing Angular components. Returns count of indexed and updated components.',
    inputSchema: {
      type: 'object',
      properties: {
        sourcePath: { type: 'string', description: 'Angular source path (overrides ANGULAR_SOURCE_PATH env)' },
        type: { type: 'string', enum: ['angular', 'all'], description: 'Component types to index' },
        force: { type: 'boolean', description: 'Force re-index even if unchanged' },
      },
    },
  },
  {
    name: 'lib_index_lit',
    description: 'Scans the Lit web components source directory and indexes all custom elements into the SQLite database. USE THIS WHEN setting up the Lit component library or after adding new Lit components. Extracts @property(), slots, CSS custom properties, and @fires events.',
    inputSchema: {
      type: 'object',
      properties: {
        litSourcePath: { type: 'string', description: 'Lit source path (overrides LIT_SOURCE_PATH env)' },
        force: { type: 'boolean', description: 'Force re-index' },
      },
    },
  },
  {
    name: 'lib_search_component',
    description: 'Searches the indexed Angular + Lit component library for components that visually or functionally match a description. USE THIS WHEN you have a Figma frame/node and want to find the best matching component. Returns ranked matches with componentType (angular|lit), confidence scores, and full API. Use preferType:"lit" for leaf/primitive nodes like buttons and inputs.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query (component name, description, or functionality)' },
        preferType: { type: 'string', enum: ['angular', 'lit'], description: 'Boost results of this component type' },
        limit: { type: 'number', description: 'Max results to return (default 10)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'lib_get_component',
    description: 'Returns the full API of a specific component by selector. USE THIS WHEN you need complete details about a component including all @Input()/@property() definitions, @Output()/events, slots, and CSS custom properties before generating code.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'Component selector (e.g. app-button or my-button)' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'lib_map_figma_to_component',
    description: 'Saves a permanent mapping between a Figma component ID and an Angular/Lit component selector. USE THIS to improve future code generation accuracy — mapped components are always used deterministically when that Figma component appears.',
    inputSchema: {
      type: 'object',
      properties: {
        figmaComponentId: { type: 'string', description: 'Figma component or instance node ID' },
        selector: { type: 'string', description: 'Component selector in the index' },
        confidence: { type: 'number', description: 'Confidence score 0-1 (default 1.0)' },
      },
      required: ['figmaComponentId', 'selector'],
    },
  },
  {
    name: 'lib_list_mappings',
    description: 'Lists all saved Figma component ID ↔ Angular/Lit component selector mappings. USE THIS to audit which Figma components are mapped, find unmapped components, or see the full component catalog.',
    inputSchema: {
      type: 'object',
      properties: {
        unmappedOnly: { type: 'boolean', description: 'Only show components without a Figma mapping' },
        filterType: { type: 'string', enum: ['angular', 'lit'], description: 'Filter by component type' },
      },
    },
  },
  {
    name: 'codegen_from_node',
    description: 'Generates pixel-perfect Angular component code (.ts + .html + .scss) from a Figma node. Automatically uses Lit custom elements for UI primitives and Angular components for feature containers. USE THIS as the main code generation call after inspecting the design with figma_get_node.',
    inputSchema: {
      type: 'object',
      properties: {
        fileKey: { type: 'string', description: 'Figma file key' },
        nodeId: { type: 'string', description: 'Node ID to generate code for' },
        componentName: { type: 'string', description: 'Override component name (kebab-case)' },
        outputFormat: { type: 'string', enum: ['files', 'inline'], description: 'Output as separate files or inline (default inline)' },
        forceGeneric: { type: 'boolean', description: 'Skip component matching and use generic HTML' },
        preferComponentType: { type: 'string', enum: ['angular', 'lit', 'auto'], description: 'Force preference for component type (default auto)' },
      },
      required: ['fileKey', 'nodeId'],
    },
  },
  {
    name: 'codegen_from_file',
    description: 'Generates Angular component code for all frames in a Figma page. USE THIS for generating an entire page or screen worth of components at once.',
    inputSchema: {
      type: 'object',
      properties: {
        fileKey: { type: 'string', description: 'Figma file key' },
        pageId: { type: 'string', description: 'Specific page ID (default: first page)' },
        maxFrames: { type: 'number', description: 'Max top-level frames to generate (default: 30). Extras are reported in skippedFrameNames rather than silently dropped.' },
      },
      required: ['fileKey'],
    },
  },
  {
    name: 'codegen_validate',
    description: 'Compares a rendered Angular component screenshot against the Figma design using pixel-by-pixel diff. USE THIS to verify generated code matches the design within the pixel accuracy threshold. Returns match percentage, pixel diff count, and a diff image.',
    inputSchema: {
      type: 'object',
      properties: {
        fileKey: { type: 'string', description: 'Figma file key' },
        nodeId: { type: 'string', description: 'Figma node to compare against' },
        screenshotPath: { type: 'string', description: 'Absolute path to the PNG screenshot of the rendered Angular component' },
        threshold: { type: 'number', description: 'Mismatch threshold 0-1 (default 0.05 = 5%)' },
      },
      required: ['fileKey', 'nodeId', 'screenshotPath'],
    },
  },
  {
    name: 'codegen_diff',
    description: 'Diffs a new Figma design against an existing Angular/Lit component to detect what changed. USE THIS when a design has been updated and you need to know what code changes are required.',
    inputSchema: {
      type: 'object',
      properties: {
        fileKey: { type: 'string', description: 'Figma file key' },
        nodeId: { type: 'string', description: 'Updated Figma node ID' },
        selector: { type: 'string', description: 'Existing component selector to diff against' },
      },
      required: ['fileKey', 'nodeId', 'selector'],
    },
  },
];

type ToolArgs = Record<string, unknown>;

async function runTool(name: string, args: ToolArgs): Promise<unknown> {
  switch (name) {
    case 'figma_get_file': return figmaGetFile(args as Parameters<typeof figmaGetFile>[0]);
    case 'figma_get_node': return figmaGetNode(args as Parameters<typeof figmaGetNode>[0]);
    case 'figma_get_node_outline': return figmaGetNodeOutline(args as Parameters<typeof figmaGetNodeOutline>[0]);
    case 'figma_get_node_variables': return figmaGetNodeVariables(args as Parameters<typeof figmaGetNodeVariables>[0]);
    case 'figma_extract_tokens': return figmaExtractTokens(args as Parameters<typeof figmaExtractTokens>[0]);
    case 'figma_get_component_set': return figmaGetComponentSet(args as Parameters<typeof figmaGetComponentSet>[0]);
    case 'figma_export_node_image': return figmaExportNodeImage(args as Parameters<typeof figmaExportNodeImage>[0]);
    case 'lib_index_components': return libIndexComponents(args as Parameters<typeof libIndexComponents>[0]);
    case 'lib_index_lit': return libIndexLit(args as Parameters<typeof libIndexLit>[0]);
    case 'lib_search_component': return libSearchComponent(args as Parameters<typeof libSearchComponent>[0]);
    case 'lib_get_component': return libGetComponent(args as Parameters<typeof libGetComponent>[0]);
    case 'lib_map_figma_to_component': return libMapFigmaToComponent(args as Parameters<typeof libMapFigmaToComponent>[0]);
    case 'lib_list_mappings': return libListMappings(args as Parameters<typeof libListMappings>[0]);
    case 'codegen_from_node': return codegenFromNode(args as Parameters<typeof codegenFromNode>[0]);
    case 'codegen_from_file': return codegenFromFile(args as Parameters<typeof codegenFromFile>[0]);
    case 'codegen_validate': return codegenValidate(args as Parameters<typeof codegenValidate>[0]);
    case 'codegen_diff': return codegenDiff(args as Parameters<typeof codegenDiff>[0]);
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

async function startWatchMode(): Promise<void> {
  const { default: chokidar } = await import('chokidar');
  const sourcePath = process.env.ANGULAR_SOURCE_PATH;
  if (!sourcePath) {
    logger.warn('ANGULAR_SOURCE_PATH not set, watch mode disabled');
    return;
  }

  logger.info('Watch mode active', { sourcePath });

  const watcher = chokidar.watch([`${sourcePath}/**/*.ts`, `${sourcePath}/**/*.scss`], {
    ignoreInitial: true,
    persistent: true,
  });

  watcher.on('change', async (filePath) => {
    if (!filePath.endsWith('.component.ts')) return;
    try {
      const { AngularParser } = await import('./parsers/angularParser.js');
      const { ComponentIndex } = await import('./services/componentIndex.js');
      const parser = new AngularParser();
      const index = new ComponentIndex();
      const rec = parser.parseFile(filePath);
      if (rec) {
        index.upsert(rec);
        logger.info('Component index updated', { selector: rec.selector });
      }
    } catch (err) {
      logger.error('Watch update failed', { file: filePath, error: String(err) });
    }
  });
}

async function main(): Promise<void> {
  if (indexOnly) {
    logger.info('Running index-only mode for Angular components');
    const result = await libIndexComponents({});
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    process.exit(0);
  }

  if (indexLitOnly) {
    logger.info('Running index-only mode for Lit components');
    const result = await libIndexLit({});
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    process.exit(0);
  }

  const server = new Server(
    { name: 'figma-angular-mcp', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: toolArgs } = request.params;
    logger.debug('Tool called', { name, args: toolArgs });

    try {
      const result = await runTool(name, (toolArgs || {}) as ToolArgs);
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('Tool error', { name, error: message });
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: message, code: 'TOOL_ERROR' }) }],
        isError: true,
      };
    }
  });

  if (watchMode) await startWatchMode();

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info('figma-angular-mcp server started', { watchMode });
}

main().catch(err => {
  logger.error('Server startup failed', { error: String(err) });
  process.exit(1);
});
