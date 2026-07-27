#!/usr/bin/env node
/**
 * figma-angular-sync — bidirectional pixel-perfect Figma <-> Angular MCP server.
 *
 * Model-agnostic: it's an MCP server, so Claude / ChatGPT / GitHub Copilot / any
 * MCP host drives the same binary. LLM-touching steps use MCP sampling (the
 * host's own model) or a config-selected provider adapter; the deterministic core
 * never calls a model.
 *
 * Pipeline state flows through an in-memory doc store keyed by "screen" so the
 * agent chains tools by passing a small screen id instead of the whole IR tree.
 */

import { config as loadEnv } from "dotenv";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Load .env from the project root regardless of the MCP host's cwd (it launches
// this script with `node <abs-path>/dist/index.js`, so cwd is not reliable).
// quiet: true — dotenv's startup log line would otherwise corrupt the MCP stdio JSON-RPC stream.
loadEnv({ path: join(dirname(fileURLToPath(import.meta.url)), "..", ".env"), quiet: true });

import { getImageUrl, getLocalVariables, getNode } from "./figma/rest.js";
import {
  imageBase64ToBuffer,
  parseCodeConnectMap,
  variableDefsToTokenInput,
  type CodeConnectMap,
  type VariableDefs,
} from "./figma/devmode.js";
import { normalizeRest } from "./ir/normalizeRest.js";
import { applyTokensToIR, tokensToCss } from "./tokens/extract.js";
import { attachAssets, collectExportTargets, exportAssetsViaRest, processSvg } from "./assets/export.js";
import { generateAngular } from "./codegen/angular.js";
import { codegenValidate } from "./verify/validate.js";
import { ComponentIndex, type LibComponent } from "./lib/index.js";
import { LlmProvider } from "./llm/provider.js";
import { MetricsCollector, buildReport, estimateCost } from "./metrics/collector.js";
import { parseAngular } from "./reverse/parseAngular.js";
import { buildFigmaPlan } from "./reverse/buildPlan.js";
import { FigmaBridge, createWsTransport } from "./bridge/wsBridge.js";
import type { IRDocument } from "./ir/schema.js";

// ---- runtime state ----
let runId = `run-${new Date().toISOString().replace(/[:.]/g, "-")}`;
// Shared, file-backed store (default ./data/metrics-log.json, override via
// FIGMA_METRICS_STORE) so both servers can log to one place.
const metrics = new MetricsCollector(runId);
const docStore = new Map<string, IRDocument>();
const componentIndex = new ComponentIndex();
let bridge: FigmaBridge | null = null;

const server = new McpServer({ name: "figma-angular-sync", version: "0.1.0" });
const llm = new LlmProvider(server.server, metrics);

/** Record a zero-token entry for a deterministic stage so metrics_report lists it. */
function recordDeterministic(screen: string, tool: string, stage: string, ms: number): void {
  metrics.record({ screen, tool, stage, provider: "none", model: "-", inputTokens: 0, outputTokens: 0, ms });
}

const ok = (obj: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }] });
const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });

// ============================================================
// Direction 1: Figma -> Angular
// ============================================================

server.tool(
  "figma_import_node",
  "Fetch a Figma node subtree (REST) and normalize it to the shared IR. Optionally pull Variables as tokens. Returns a screen id used by later tools.",
  {
    fileKey: z.string().describe("Figma file key"),
    nodeId: z.string().describe("Figma node id, e.g. 1:23"),
    screen: z.string().optional().describe("name for this screen/run (defaults to node name)"),
    withTokens: z.boolean().default(false).describe("also fetch local Variables (Enterprise)"),
    figmaToken: z.string().optional().describe("override FIGMA_TOKEN env"),
  },
  async ({ fileKey, nodeId, screen, withTokens, figmaToken }) => {
    const t0 = Date.now();
    const node = await getNode(fileKey, nodeId, { token: figmaToken });
    const screenName = screen ?? node.name ?? nodeId;
    let doc = normalizeRest(node, { screen: screenName, source: `${fileKey}#${nodeId}` });
    let tokenWarning: string | undefined;
    if (withTokens) {
      try {
        const vars = await getLocalVariables(fileKey, { token: figmaToken });
        const { map } = tokensToCss(vars);
        doc = applyTokensToIR(doc, map);
      } catch (e) {
        // Variables REST is Enterprise-scoped; a 403 shouldn't fail the whole
        // import. Continue with literal colors and warn (#9).
        tokenWarning = `Variables not available (${String(e)}). Continuing without tokens — colors use literal values. Use figma_ingest_variable_defs (Dev Mode MCP) for tokens on non-Enterprise plans.`;
      }
    }
    docStore.set(screenName, doc);
    recordDeterministic(screenName, "figma_import_node", "import", Date.now() - t0);
    return ok({
      screen: screenName,
      nodeCount: countNodes(doc),
      hasTokens: Object.keys(doc.tokens).length > 0,
      tokenWarning,
      layoutWarnings: doc.warnings,
    });
  }
);

server.tool(
  "figma_extract_tokens",
  "Extract Figma Variables/styles to CSS custom properties and rewrite the screen's IR to reference tokens instead of literals.",
  {
    fileKey: z.string(),
    screen: z.string().describe("screen id from figma_import_node"),
    figmaToken: z.string().optional(),
  },
  async ({ fileKey, screen, figmaToken }) => {
    const t0 = Date.now();
    const doc = requireDoc(screen);
    try {
      const vars = await getLocalVariables(fileKey, { token: figmaToken });
      const { css, map } = tokensToCss(vars);
      applyTokensToIR(doc, map);
      recordDeterministic(screen, "figma_extract_tokens", "tokens", Date.now() - t0);
      return text(`Extracted ${Object.keys(map).length} tokens for "${screen}".\n\n${css}`);
    } catch (e) {
      // Degrade gracefully instead of erroring the whole token stage (#9).
      recordDeterministic(screen, "figma_extract_tokens", "tokens", Date.now() - t0);
      return text(
        `WARNING: Variables endpoint failed (${String(e)}). ` +
          `This endpoint needs an Enterprise/org-scoped token. Continuing without tokens — ` +
          `colors fall back to literal values. On non-Enterprise plans use figma_ingest_variable_defs ` +
          `with the Dev Mode MCP's get_variable_defs output instead.`
      );
    }
  }
);

server.tool(
  "figma_ingest_variable_defs",
  "Ingest the OFFICIAL Figma Dev Mode MCP `get_variable_defs` output as design tokens and rewrite the screen's IR to reference them. Works on any Figma plan (no Enterprise Variables REST). Call after figma_import_node; the agent pastes get_variable_defs here.",
  {
    screen: z.string().describe("screen id from figma_import_node"),
    variableDefs: z
      .union([z.record(z.union([z.string(), z.number()])), z.array(z.object({ name: z.string(), value: z.union([z.string(), z.number()]) }))])
      .describe("verbatim output of the Dev Mode MCP get_variable_defs tool"),
  },
  async ({ screen, variableDefs }) => {
    const t0 = Date.now();
    const doc = requireDoc(screen);
    const { css, map } = tokensToCss(variableDefsToTokenInput(variableDefs as VariableDefs));
    applyTokensToIR(doc, map);
    recordDeterministic(screen, "figma_ingest_variable_defs", "tokens", Date.now() - t0);
    return text(`Ingested ${Object.keys(map).length} tokens (from Dev Mode MCP) for "${screen}".\n\n${css}`);
  }
);

server.tool(
  "figma_export_assets",
  "Export vector/icon/logo nodes as SVG (and raster images as PNG) and attach them to the screen's IR, so codegen inlines real graphics instead of empty boxes. Fixes 'vectors render as solid colored blocks'. Single-color icons are auto-rewritten to currentColor (themeable via CSS); multi-color logos keep their exact colors. Uses REST image export (any plan + token). Call before codegen_from_node.",
  {
    screen: z.string().describe("screen id from figma_import_node"),
    fileKey: z.string().optional().describe("required unless passing assets directly"),
    figmaToken: z.string().optional(),
    themeIcons: z
      .boolean()
      .default(true)
      .describe("rewrite single-color icons to currentColor so they theme with CSS; multi-color logos are always left untouched"),
    assets: z
      .record(z.object({ format: z.enum(["svg", "png"]), svg: z.string().optional(), url: z.string().optional() }))
      .optional()
      .describe("optional pre-exported nodeId->asset map (e.g. from another source) to attach instead of exporting"),
  },
  async ({ screen, fileKey, figmaToken, themeIcons, assets }) => {
    const t0 = Date.now();
    const doc = requireDoc(screen);
    let result: Record<string, number>;
    if (assets) {
      // Apply the same monochrome->currentColor treatment to provided SVGs.
      const processed: typeof assets = {};
      let themedIcons = 0;
      for (const [id, a] of Object.entries(assets)) {
        if (a.format === "svg" && a.svg) {
          const { svg, themed } = processSvg(a.svg, themeIcons);
          if (themed) themedIcons++;
          processed[id] = { ...a, svg };
        } else processed[id] = a;
      }
      result = { attached: attachAssets(doc, processed), themedIcons };
    } else {
      if (!fileKey) throw new Error("Provide fileKey to export assets, or pass an assets map.");
      result = await exportAssetsViaRest(doc, fileKey, { token: figmaToken }, themeIcons);
    }
    recordDeterministic(screen, "figma_export_assets", "assets", Date.now() - t0);
    const remaining = collectExportTargets(doc).length;
    return ok({ screen, exported: result, unresolvedVectorNodes: remaining });
  }
);

server.tool(
  "lib_index_components",
  "Register the Angular/Lit component library so nodes can be matched to existing atoms for reuse.",
  {
    components: z
      .array(
        z.object({
          selector: z.string(),
          name: z.string(),
          inputs: z.array(z.string()).default([]),
          keywords: z.array(z.string()).default([]),
        })
      )
      .describe("indexed components"),
  },
  async ({ components }) => {
    componentIndex.set(components as LibComponent[]);
    return text(`Indexed ${components.length} components.`);
  }
);

server.tool(
  "lib_ingest_code_connect",
  "Ingest the OFFICIAL Figma Dev Mode MCP `get_code_connect_map` output. Seeds authoritative node->component mappings so lib_search_component resolves reuse deterministically (confidence 1.0, no model call) for mapped nodes.",
  {
    codeConnectMap: z
      .record(z.object({ codeConnectName: z.string().optional(), component: z.string().optional(), codeConnectSrc: z.string().optional(), props: z.record(z.string()).optional() }))
      .describe("verbatim output of the Dev Mode MCP get_code_connect_map tool"),
  },
  async ({ codeConnectMap }) => {
    const mappings = parseCodeConnectMap(codeConnectMap as CodeConnectMap);
    componentIndex.setNodeMappings(mappings);
    return text(`Seeded ${Object.keys(mappings).length} node->component mappings from Code Connect.`);
  }
);

server.tool(
  "lib_search_component",
  "Match nodes in a screen's IR to existing library components (reuse). Prefers authoritative Code Connect mappings, then deterministic pre-filter, then host-model disambiguation (via sampling). Annotates the IR in place.",
  { screen: z.string() },
  async ({ screen }) => {
    const doc = requireDoc(screen);
    let matched = 0;
    const visit = async (node: IRDocument["root"]): Promise<void> => {
      const m = await componentIndex.match(node, llm, { screen });
      if (m) {
        node.componentMatch = m;
        matched++;
        return; // matched subtree becomes an instance; don't descend
      }
      for (const c of node.children) await visit(c);
    };
    await visit(doc.root);
    return ok({ screen, matched });
  }
);

server.tool(
  "codegen_from_node",
  "Generate a standalone Angular component (ts/html/scss) from a screen's IR: responsive sizing (Figma FILL/HUG/FIXED), text bound to class fields, *ngFor for repeated reused components, and Figma-variant [input] bindings. One-shot, deterministic.",
  { screen: z.string() },
  async ({ screen }) => {
    const t0 = Date.now();
    const doc = requireDoc(screen);
    const comp = generateAngular(doc);
    recordDeterministic(screen, "codegen_from_node", "codegen", Date.now() - t0);
    return ok(comp);
  }
);

server.tool(
  "codegen_validate",
  "One-shot pixel diff: render the generated component headless and compare against the Figma ground-truth PNG. Ground truth can be the OFFICIAL Dev Mode MCP get_image (as base64), a URL, or REST fileKey+nodeId. Reports score + optional diff mask. Does NOT auto-fix.",
  {
    screen: z.string(),
    html: z.string().describe("self-contained HTML (component markup + inlined scss/fonts)"),
    width: z.number().describe("frame width in CSS px"),
    height: z.number().optional(),
    figmaImageBase64: z.string().optional().describe("Dev Mode MCP get_image output (data URL or bare base64)"),
    fileKey: z.string().optional().describe("for fetching the ground-truth image via REST"),
    nodeId: z.string().optional(),
    figmaImageUrl: z.string().optional().describe("or pass a ready image url directly"),
    figmaToken: z.string().optional(),
    passScore: z.number().default(0.98).describe("score bar for the pass flag"),
  },
  async ({ screen, html, width, height, figmaImageBase64, fileKey, nodeId, figmaImageUrl, figmaToken, passScore }) => {
    const t0 = Date.now();
    const diffOut = join(process.cwd(), ".validate", `${screen}-diff.png`);
    let figmaImage: { url?: string; buffer?: Buffer };
    if (figmaImageBase64) figmaImage = { buffer: imageBase64ToBuffer(figmaImageBase64) };
    else {
      let url = figmaImageUrl;
      if (!url && fileKey && nodeId) url = await getImageUrl(fileKey, nodeId, 2, { token: figmaToken });
      if (!url) throw new Error("Provide figmaImageBase64 (Dev Mode get_image), figmaImageUrl, or fileKey+nodeId.");
      figmaImage = { url };
    }
    const result = await codegenValidate({ html, width, height, figmaImage, diffOut });
    result.pass = result.score >= passScore;
    recordDeterministic(screen, "codegen_validate", "validate", Date.now() - t0);
    return ok(result);
  }
);

// ============================================================
// Direction 2: Angular -> Figma
// ============================================================

server.tool(
  "angular_parse_component",
  "Render an Angular component's HTML headless, measure real geometry (getBoundingClientRect + getComputedStyle), and normalize to IR.",
  {
    html: z.string().describe("fully rendered component HTML"),
    width: z.number(),
    height: z.number().optional(),
    screen: z.string(),
    source: z.string().default("angular"),
  },
  async ({ html, width, height, screen, source }) => {
    const t0 = Date.now();
    const doc = await parseAngular({ html, width, height, screen, source });
    docStore.set(screen, doc);
    recordDeterministic(screen, "angular_parse_component", "parse", Date.now() - t0);
    return ok({ screen, nodeCount: countNodes(doc) });
  }
);

server.tool(
  "figma_build_plan",
  "Convert a screen's IR to a Figma build plan (JSON) the plugin can execute. Uses the reverse layout mapping.",
  { screen: z.string() },
  async ({ screen }) => {
    const t0 = Date.now();
    const plan = buildFigmaPlan(requireDoc(screen));
    recordDeterministic(screen, "figma_build_plan", "build-plan", Date.now() - t0);
    return ok(plan);
  }
);

server.tool(
  "figma_apply_plan",
  "Send a Figma build plan to the connected Figma plugin (over the WS bridge) to create nodes on the canvas. Requires the plugin running.",
  {
    screen: z.string(),
    port: z.number().default(8787),
  },
  async ({ screen, port }) => {
    const t0 = Date.now();
    if (!bridge) bridge = new FigmaBridge(await createWsTransport(port));
    const plan = buildFigmaPlan(requireDoc(screen));
    const result = await bridge.applyPlan(plan);
    recordDeterministic(screen, "figma_apply_plan", "apply", Date.now() - t0);
    return ok(result);
  }
);

// ============================================================
// Cross-cutting: token accounting
// ============================================================

server.tool(
  "metrics_record_llm_usage",
  "Log EXACT LLM token usage for a step from the calling client's own model response (the server can't observe the host's LLM usage otherwise). The SDK orchestrator should call this after each LLM step (planning, semantic naming, fixups) with the response's usage. Cost is computed from the shared model price table and written to the shared store, so metrics_report becomes a true total: $0 deterministic + measured agent tokens.",
  {
    stage: z.string().describe('step label, e.g. "plan", "codegen_from_node review", "fixup"'),
    inputTokens: z.number().describe("exact prompt/input tokens from the model response"),
    outputTokens: z.number().describe("exact completion/output tokens from the model response"),
    model: z.string().default("host/unknown").describe("model id, e.g. claude-sonnet-5, gpt-5"),
    screen: z.string().default("orchestration").describe("screen this usage belongs to (for per-screen totals)"),
    provider: z.string().default("host").describe("host | anthropic | openai | ..."),
    note: z.string().optional(),
  },
  async ({ stage, inputTokens, outputTokens, model, screen, provider, note }) => {
    metrics.record({ screen, tool: "metrics_record_llm_usage", stage, provider, model, inputTokens, outputTokens, ms: 0, note });
    const cost = estimateCost(model, inputTokens, outputTokens);
    return text(`Recorded ${inputTokens} in / ${outputTokens} out on ${model} for "${stage}" (screen: ${screen}) = $${cost.toFixed(4)}.`);
  }
);

server.tool(
  "metrics_report",
  'Aggregate token usage per screen and per tool/stage, plus a total. scope:"session" (default) = this run only; scope:"all" = the whole shared store (both servers, all runs) — the true unified total. Deterministic stages report 0 tokens. Pass reset:true to start a fresh session tally after reporting.',
  {
    scope: z.enum(["session", "all"]).default("session").describe('"session" = this run; "all" = whole shared store across both servers'),
    reset: z.boolean().default(false).describe("start a new session tally after this report"),
    budgetPerScreen: z.number().optional().describe("USD budget to flag screens that exceed it"),
  },
  async ({ scope, reset, budgetPerScreen }) => {
    const records = scope === "all" ? metrics.allRecords() : metrics.sessionRecords();
    const report = buildReport(records, scope, metrics.storePath, budgetPerScreen ?? Infinity);
    if (reset) {
      runId = `run-${new Date().toISOString().replace(/[:.]/g, "-")}`;
      metrics.reset(runId);
    }
    return { content: [{ type: "text" as const, text: report.table + "\n\n" + JSON.stringify(report, null, 2) }] };
  }
);

// ---- helpers ----
function requireDoc(screen: string): IRDocument {
  const doc = docStore.get(screen);
  if (!doc) throw new Error(`Unknown screen "${screen}". Run figma_import_node / angular_parse_component first.`);
  return doc;
}
function countNodes(doc: IRDocument): number {
  let n = 0;
  const walk = (node: IRDocument["root"]) => {
    n++;
    node.children.forEach(walk);
  };
  walk(doc.root);
  return n;
}

// ---- boot ----
const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`figma-angular-sync ready (runId=${runId}). Shared metrics store -> ${metrics.storePath}`);
