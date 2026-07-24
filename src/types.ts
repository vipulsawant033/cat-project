import { z } from 'zod';
import type { AngularComponentInfo } from './library/scanner.js';
import type { ComponentMapping } from './library/mapping-store.js';
import type { ManifestDiffResult, ManifestEntry, ManifestGeneratedComponent } from './manifest/store.js';

/**
 * Shared input/output contracts for the "generate_angular_component" tool.
 * Both the MCP tool handler (src/mcp/tools/generate-angular-component.ts)
 * and the REST bridge (src/bridge/routes.ts) validate against this same
 * schema and call the same core function, so behavior never drifts between
 * the two entry points.
 */
export const GenerateAngularComponentInput = z.object({
  figmaLink: z
    .string()
    .url()
    .describe('A Figma component/frame share link, e.g. https://www.figma.com/design/<key>/<title>?node-id=12-34'),
  figmaToken: z
    .string()
    .optional()
    .describe('Optional Figma personal access token override; defaults to FIGMA_TOKEN env var'),
  writeToDisk: z
    .boolean()
    .optional()
    .default(false)
    .describe('If true, also writes the generated files under outputDir (or OUTPUT_DIR env var)'),
  outputDir: z.string().optional().describe('Directory to write generated files into when writeToDisk is true'),
  iconsDir: z
    .string()
    .optional()
    .describe(
      'Directory to write exported icon .svg files into when writeToDisk is true (or ICONS_DIR env var). ' +
        'Defaults to ./public/icons — icons are referenced from generated templates as "/icons/<file>", ' +
        'matching Angular\'s default public/ asset convention, so this should point at the target ' +
        'workspace\'s public/icons folder (e.g. the consuming app\'s public/icons, not this server\'s own).'
    ),
  serve: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      'If true (default), also serves the generated component on a local Angular dev server so it can be ' +
        'viewed in a browser immediately. Requires the one-time `npm run preview:setup` to have been run; ' +
        'otherwise the output reports status "setup-required" instead of failing the whole request.'
    ),
});

export type GenerateAngularComponentInput = z.infer<typeof GenerateAngularComponentInput>;

export interface PreviewResult {
  status: 'started' | 'already-running' | 'setup-required' | 'error';
  /** e.g. "http://localhost:4300" — present when status is 'started' or 'already-running'. */
  url?: string;
  message?: string;
}

export interface GenerateAngularComponentOutput {
  source: {
    fileKey: string;
    nodeId: string;
    fileName: string;
    nodeName: string;
  };
  component: {
    selector: string;
    className: string;
    folder: string;
    files: { fileName: string; content: string }[];
    /** Exported icon .svg files referenced by the template's <img src> — written under iconsDir when writeToDisk is true. */
    iconAssets: { fileName: string; content: string }[];
  };
  writtenPaths?: string[];
  preview?: PreviewResult;
}

/**
 * Shared contracts for the "generate_angular_page" tool (Phase 4 — whole-screen
 * generation). Splits a screen into a composing page component plus one
 * component per top-level section, instead of one flat tree — see
 * src/codegen/page-generator.ts.
 */
export const GenerateAngularPageInput = z.object({
  figmaLink: z
    .string()
    .url()
    .describe(
      'A Figma frame/screen share link, e.g. https://www.figma.com/design/<key>/<title>?node-id=12-34 — ' +
        'typically a whole page/screen frame rather than a single component'
    ),
  figmaToken: z
    .string()
    .optional()
    .describe('Optional Figma personal access token override; defaults to FIGMA_TOKEN env var'),
  writeToDisk: z
    .boolean()
    .optional()
    .default(false)
    .describe('If true, also writes the page + every section\'s files under outputDir (or OUTPUT_DIR env var)'),
  outputDir: z.string().optional().describe('Directory to write generated files into when writeToDisk is true'),
  iconsDir: z
    .string()
    .optional()
    .describe(
      'Directory to write exported icon .svg files into when writeToDisk is true (or ICONS_DIR env var). ' +
        'Defaults to ./public/icons — icons are referenced from generated templates as "/icons/<file>", ' +
        'matching Angular\'s default public/ asset convention, so this should point at the target ' +
        'workspace\'s public/icons folder (e.g. the consuming app\'s public/icons, not this server\'s own).'
    ),
  serve: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      'If true (default), also serves the generated page (with its sections) on a local Angular dev server. ' +
        'Requires the one-time `npm run preview:setup` to have been run; otherwise the output reports status ' +
        '"setup-required" instead of failing the whole request.'
    ),
});
export type GenerateAngularPageInput = z.infer<typeof GenerateAngularPageInput>;

export interface GeneratedComponentFiles {
  selector: string;
  className: string;
  folder: string;
  files: { fileName: string; content: string }[];
  /** Exported icon .svg files referenced by this component's <img src> — written under iconsDir when writeToDisk is true. */
  iconAssets: { fileName: string; content: string }[];
}

export interface GenerateAngularPageOutput {
  source: {
    fileKey: string;
    nodeId: string;
    fileName: string;
    nodeName: string;
  };
  page: GeneratedComponentFiles;
  sections: GeneratedComponentFiles[];
  writtenPaths?: string[];
  preview?: PreviewResult;
}

/**
 * Shared contracts for the Phase 1 Figma-extraction tools (figma_get_file,
 * figma_get_node, figma_extract_tokens, figma_get_component_set,
 * figma_export_node_image). Same core/mcp/bridge pattern as above.
 */

const figmaLinkField = z
  .string()
  .url()
  .describe('A Figma file/frame/component share link, e.g. https://www.figma.com/design/<fileKey>/<title>?node-id=12-34');

const figmaTokenField = z
  .string()
  .optional()
  .describe('Optional Figma personal access token override; defaults to FIGMA_TOKEN env var');

export const FigmaGetFileInput = z.object({
  figmaLink: figmaLinkField.describe(
    'A Figma file/design share link. node-id is ignored — this always returns the whole file\'s document tree.'
  ),
  figmaToken: figmaTokenField,
  maxDepth: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .default(4)
    .describe('How many levels of the document tree to include before truncating children (keeps the response small)'),
});
export type FigmaGetFileInput = z.infer<typeof FigmaGetFileInput>;

export interface FigmaNodeSummary {
  id: string;
  name: string;
  type: string;
  childCount: number;
  children?: FigmaNodeSummary[];
  truncated?: boolean;
}

export interface FigmaGetFileOutput {
  fileKey: string;
  fileName: string;
  root: FigmaNodeSummary;
  componentCount: number;
  componentSetCount: number;
}

export const FigmaGetNodeInput = z.object({
  figmaLink: figmaLinkField.describe('A Figma share link whose node-id query param points at the node to fetch'),
  figmaToken: figmaTokenField,
});
export type FigmaGetNodeInput = z.infer<typeof FigmaGetNodeInput>;

export interface FigmaGetNodeOutput {
  fileKey: string;
  nodeId: string;
  fileName: string;
  node: unknown;
}

export const FigmaExtractTokensInput = z.object({
  figmaLink: figmaLinkField.describe('A Figma file/design share link (node-id is ignored — variables are file-scoped)'),
  figmaToken: figmaTokenField,
});
export type FigmaExtractTokensInput = z.infer<typeof FigmaExtractTokensInput>;

export interface ExtractedToken {
  /** Figma variable id, e.g. "VariableID:1:23" — matches FigmaNode.boundVariables entries */
  variableId: string;
  /** Original Figma variable name, e.g. "color/brand/primary" */
  name: string;
  /** Suggested CSS custom property name, e.g. "--color-brand-primary" */
  cssVariableName: string;
  type: string;
  collection: string;
  /** mode name -> resolved CSS value (colors as rgb()/rgba(), others stringified) */
  valuesByMode: Record<string, string>;
}

export interface FigmaExtractTokensOutput {
  fileKey: string;
  tokens: ExtractedToken[];
}

export const FigmaGetComponentSetInput = z.object({
  figmaLink: figmaLinkField.describe('A Figma share link whose node-id points directly at a COMPONENT_SET'),
  figmaToken: figmaTokenField,
});
export type FigmaGetComponentSetInput = z.infer<typeof FigmaGetComponentSetInput>;

export interface FigmaComponentSetProperty {
  type: string;
  defaultValue?: string | boolean;
  variantOptions?: string[];
}

export interface FigmaComponentSetVariant {
  id: string;
  name: string;
  variantProperties: Record<string, string>;
}

export interface FigmaGetComponentSetOutput {
  fileKey: string;
  nodeId: string;
  name: string;
  properties: Record<string, FigmaComponentSetProperty>;
  variants: FigmaComponentSetVariant[];
}

export const FigmaExportNodeImageInput = z.object({
  figmaLink: figmaLinkField.describe('A Figma share link whose node-id points at the node to export'),
  figmaToken: figmaTokenField,
  scale: z.number().min(0.5).max(4).optional().default(2).describe('Export scale factor, e.g. 2 for @2x'),
  format: z
    .enum(['url', 'base64'])
    .optional()
    .default('url')
    .describe(
      '"url" returns Figma\'s temporary signed image URL (small response, expires). "base64" fetches and ' +
        'inlines the PNG bytes (larger response, usable directly e.g. as a pixel-diff reference).'
    ),
});
export type FigmaExportNodeImageInput = z.infer<typeof FigmaExportNodeImageInput>;

export interface FigmaExportNodeImageOutput {
  fileKey: string;
  nodeId: string;
  format: 'url' | 'base64';
  url?: string;
  base64?: string;
}

/**
 * Shared contracts for the Phase 2 design-system library tools (lib_index_components,
 * lib_search_component, lib_get_component, lib_map_figma_to_component, lib_list_mappings).
 */

export const LibIndexComponentsInput = z.object({
  libraryDir: z
    .string()
    .optional()
    .describe(
      'Path to the Angular workspace/library to scan for @Component classes; defaults to the ' +
        'COMPONENT_LIBRARY_DIR env var if omitted'
    ),
});
export type LibIndexComponentsInput = z.infer<typeof LibIndexComponentsInput>;

export interface LibIndexComponentsOutput {
  libraryDir: string;
  componentCount: number;
  components: AngularComponentInfo[];
}

export const LibSearchComponentInput = z.object({
  query: z.string().describe('Substring to match (case-insensitively) against component selector or class name'),
});
export type LibSearchComponentInput = z.infer<typeof LibSearchComponentInput>;

export interface LibSearchComponentOutput {
  query: string;
  matches: AngularComponentInfo[];
}

export const LibGetComponentInput = z.object({
  selector: z.string().describe('Exact component selector (e.g. "cat-button") or class name to look up in the index'),
});
export type LibGetComponentInput = z.infer<typeof LibGetComponentInput>;

export interface LibGetComponentOutput {
  component: AngularComponentInfo | null;
}

export const LibMapFigmaToComponentInput = z.object({
  figmaComponentKey: z
    .string()
    .describe('The Figma component/component-set key (from figma_get_file\'s components map) or node id'),
  figmaComponentName: z.string().describe('Human-readable Figma component name, e.g. "CAT/Button"'),
  angularSelector: z.string().describe('The Angular wrapper selector to render instead of a plain div, e.g. "cat-button"'),
  propertyMappings: z
    .record(z.string(), z.string())
    .optional()
    .default({})
    .describe('Figma variant/property name -> Angular @Input name, e.g. { "Style": "variant", "Size": "size" }'),
});
export type LibMapFigmaToComponentInput = z.infer<typeof LibMapFigmaToComponentInput>;

export interface LibMapFigmaToComponentOutput {
  mapping: ComponentMapping;
}

export const LibListMappingsInput = z.object({});
export type LibListMappingsInput = z.infer<typeof LibListMappingsInput>;

export interface LibListMappingsOutput {
  mappings: ComponentMapping[];
}

/**
 * Shared contracts for the Phase 5 pixel-fidelity tools (codegen_diff,
 * codegen_validate) — turning "pixel perfect" into a measurable, automatable
 * gate instead of a visual judgment call.
 */

export const CodegenDiffInput = z.object({
  figmaLink: figmaLinkField.describe('A Figma share link whose node-id points at the component/frame to validate'),
  figmaToken: figmaTokenField,
  maxMismatchRatio: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .default(0.02)
    .describe('Fraction of pixels allowed to differ before `passed` is false — default 0.02 (2%)'),
  pixelThreshold: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .default(0.1)
    .describe('Per-pixel color-difference sensitivity passed to pixelmatch: 0 = strict (any color delta counts), 1 = lax'),
  includeDiffImage: z
    .boolean()
    .optional()
    .default(false)
    .describe('If true, includes the diff visualization PNG (differing pixels in red) as base64 — can be large'),
});
export type CodegenDiffInput = z.infer<typeof CodegenDiffInput>;

export interface CodegenDiffRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  differingPixels: number;
}

export interface CodegenDiffOutput {
  source: { fileKey: string; nodeId: string; nodeName: string };
  width: number;
  height: number;
  totalPixels: number;
  differingPixels: number;
  mismatchRatio: number;
  maxMismatchRatio: number;
  /** mismatchRatio <= maxMismatchRatio */
  passed: boolean;
  /** Coarse bounding boxes of where pixels differ, largest first. */
  regions: CodegenDiffRegion[];
  regionsTruncated: boolean;
  dimensionsAdjusted?: {
    reference: { width: number; height: number };
    actual: { width: number; height: number };
  };
  diffImageBase64?: string;
  /** The local preview URL that was screenshotted, for manual inspection. */
  previewUrl: string;
}

export const CodegenValidateInput = z.object({
  figmaLink: figmaLinkField.describe('A Figma share link whose node-id points at the frame/screen to validate'),
  figmaToken: figmaTokenField,
});
export type CodegenValidateInput = z.infer<typeof CodegenValidateInput>;

export interface UnmappedInstance {
  nodeId: string;
  name: string;
  componentKey: string;
  componentName: string;
}

export interface CodegenValidateOutput {
  source: { fileKey: string; nodeId: string; nodeName: string };
  totalInstances: number;
  mappedInstances: number;
  /** INSTANCE nodes with no lib_map_figma_to_component mapping — these render as generic divs instead of real components. */
  unmappedInstances: UnmappedInstance[];
}

/**
 * Shared contracts for the Phase 6 round-trip manifest tools (codegen_detect_drift,
 * manifest_list). generate_angular_component/generate_angular_page record a manifest
 * entry on every call (see src/manifest/store.ts); codegen_diff attaches its result
 * to that same entry — these tools just read that persisted history back.
 */

export const CodegenDetectDriftInput = z.object({
  figmaLink: figmaLinkField.describe('A Figma share link whose node-id points at the component/frame to check'),
  figmaToken: figmaTokenField,
});
export type CodegenDetectDriftInput = z.infer<typeof CodegenDetectDriftInput>;

export interface CodegenDetectDriftOutput {
  fileKey: string;
  nodeId: string;
  nodeName: string;
  /** False if generate_angular_component/generate_angular_page has never been called for this node. */
  everGenerated: boolean;
  /** True if the Figma node's content hash differs from what it was at last generation — i.e. the design changed since. */
  drifted: boolean;
  currentContentHash: string;
  lastGeneratedContentHash?: string;
  lastGeneratedAt?: string;
  lastGeneratedKind?: 'component' | 'page';
  lastComponent?: ManifestGeneratedComponent;
  lastSections?: ManifestGeneratedComponent[];
  /** Still present after drift if the Figma content is unchanged since the diff ran; cleared once the content actually changes. */
  lastDiff?: ManifestDiffResult;
}

export const ManifestListInput = z.object({});
export type ManifestListInput = z.infer<typeof ManifestListInput>;

export interface ManifestListOutput {
  entries: ManifestEntry[];
}

/**
 * Shared contracts for the Phase 7 closed-loop tool (codegen_auto_regenerate).
 *
 * Important: codegen generation is a pure, deterministic function of (Figma
 * content, library mappings, tokens) — given the same inputs, regenerating
 * and re-diffing produces bit-identical results every time. There is no
 * internal "keep retrying until it passes" loop here, because nothing would
 * change between retries without an external action (a new
 * lib_map_figma_to_component mapping, a Figma edit, a codegen fix). The real
 * loop happens across repeated calls to this tool by whoever — human or
 * agent — is fixing things in between; this tool's job is to make each of
 * those calls efficient (skip re-diffing when nothing changed) and
 * actionable (bundle codegen_validate's unmapped-instance list on failure).
 */
export const CodegenAutoRegenerateInput = z.object({
  figmaLink: figmaLinkField.describe('A Figma share link whose node-id points at the component/frame to check'),
  figmaToken: figmaTokenField,
  maxMismatchRatio: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .default(0.02)
    .describe('Fraction of pixels allowed to differ before this reports passed=false — default 0.02 (2%)'),
  pixelThreshold: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .default(0.1)
    .describe('Per-pixel color-difference sensitivity passed to pixelmatch: 0 = strict, 1 = lax'),
  force: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'If true, always regenerate + re-diff even when the manifest already shows this node unchanged and ' +
        'passing. Default false — skip the redundant work in that case.'
    ),
  includeDiffImage: z
    .boolean()
    .optional()
    .default(false)
    .describe('If true and a diff actually runs, includes the diff visualization PNG as base64 — can be large'),
});
export type CodegenAutoRegenerateInput = z.infer<typeof CodegenAutoRegenerateInput>;

export interface CodegenAutoRegenerateOutput {
  source: { fileKey: string; nodeId: string; nodeName: string };
  /** True if this short-circuited on an already-passing, unchanged manifest entry — no generation or diff ran. */
  skipped: boolean;
  /** Human-readable explanation of what happened and, on failure, what to try next. */
  reason: string;
  passed: boolean;
  mismatchRatio?: number;
  maxMismatchRatio: number;
  regions?: CodegenDiffRegion[];
  regionsTruncated?: boolean;
  diffImageBase64?: string;
  previewUrl?: string;
  /** Populated only when passed is false — the same data codegen_validate would report, to guide the next fix. */
  totalInstances?: number;
  mappedInstances?: number;
  unmappedInstances?: UnmappedInstance[];
}
