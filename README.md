# figma-angular-sync

Bidirectional, **pixel-perfect Figma ⇄ Angular** MCP server.

- **Deterministic core** (import, tokens, layout, codegen, build-plan, apply) — never calls a model, so it behaves identically under every host.
- **Model-agnostic** — it's an MCP server, so **Claude / ChatGPT / GitHub Copilot / any MCP host** drives the same binary. LLM-touching steps (component-reuse matching) use **MCP sampling** (the host's own model) or a config-selected provider adapter. No model id is hardcoded.
- **One-shot codegen** + `codegen_validate` that **reports** a pixel-diff score (no auto-correction loop; that's a documented future upgrade).
- **Token accounting** — `metrics_report` shows tokens **per screen** and **per tool/stage**.

## Division of labor (Figma → Angular)

The official **Figma Dev Mode MCP** is the read/ground-truth source; this server is the value-add layer.

| Official Dev Mode MCP | This server |
|---|---|
| `get_code` → accurate styles | `lib_search_component` → match to YOUR Angular/Lit atoms |
| `get_variable_defs` → resolved tokens | `codegen_from_node` → scaffold ts/html/scss (your conventions) |
| `get_image` → ground-truth screenshot | `codegen_validate` → one-shot pixel diff vs that image |
| `get_code_connect_map` → real code components | `metrics_report` → tokens per screen + per stage |

(This server can also read Figma directly via REST when the desktop app / Dev Mode MCP isn't available — set `FIGMA_TOKEN`.)

## Install & build

```bash
npm install
npm run build
npx playwright install chromium   # needed for codegen_validate & angular_parse_component
```

Copy `.env.example` to `.env` and fill in your Figma token (Figma → Settings → Security → Generate new token):

```bash
cp .env.example .env
```

```
FIGMA_TOKEN=figd_your_token_here
```

The server loads `.env` from the project root at startup (via `dotenv`), so the token doesn't need to be duplicated into every host's MCP config.

## Register with a host (same binary everywhere)

Claude Code / Desktop (`mcp` config), ChatGPT (connectors/developer mode), or GitHub Copilot (VS Code `.vscode/mcp.json`):

```json
{
  "servers": {
    "figma-angular-sync": {
      "command": "node",
      "args": ["<abs-path>/figma-angular-sync/dist/index.js"]
    }
  }
}
```

`FIGMA_TOKEN` comes from `.env` (see above). If your host lacks MCP sampling, also set `LLM_PROVIDER` + the matching API key — either in `.env` or in the config's `env` block, which overrides `.env`.

## Tools

**Figma → Angular:** `figma_import_node` → (`figma_extract_tokens` | `figma_ingest_variable_defs`) → `figma_export_assets` → `lib_index_components` / `lib_ingest_code_connect` / `lib_search_component` → `codegen_from_node` → `codegen_validate`
**Angular → Figma:** `angular_parse_component` → `figma_build_plan` → `figma_apply_plan` (needs the plugin)
**Libraries/reuse:** `lib_index_components`, `lib_ingest_code_connect`, `lib_search_component`
**Cross-cutting:** `metrics_record_llm_usage`, `metrics_report`

## Token accounting & real cost

One **shared, file-backed store** and one **price table**, so cost is a single number — not two reports added by hand.

- **Shared store:** `<server-install>/data/metrics-log.json` by default — resolved against the **module dir, not `process.cwd()`** (MCP hosts often spawn the server with cwd `C:\WINDOWS\system32`, which is why a cwd-relative store made `metrics_report` come back empty). Override with an absolute `METRICS_STORE` (or `FIGMA_METRICS_STORE`). Point both servers at the same absolute path and `metrics_report scope:"all"` becomes the true combined total. The reader is tolerant — foreign/older records are merged and **re-priced** with the shared table if they lack a cost.
- **Exact agent cost:** the server can't see the host's LLM usage, so the SDK orchestrator calls `metrics_record_llm_usage { stage, inputTokens, outputTokens, model }` after each LLM step (planning, semantic naming, fixups) with the response's exact `usage`. Cost = tokens × the model's rate.
- **Price table** (`src/metrics/pricing.ts`): `model → $/Mtok`, the single authority applied identically to deterministic stages ($0) and agent usage. Override without a rebuild:
  - `FIGMA_MODEL_PRICES='{"gpt-5":{"in":1.25,"out":10}}'` (inline JSON), or
  - `FIGMA_MODEL_PRICES_FILE=/path/to/prices.json`
- **`metrics_report`**: `scope:"session"` (this run) or `scope:"all"` (whole store, both servers); `reset:true` clears the session tally; `budgetPerScreen` flags over-budget screens.

Result: `$0` for deterministic transforms + measured tokens for orchestration/fixups = one honest total.

State flows through an in-memory doc store keyed by `screen`, so you chain tools by passing the small `screen` id, not the whole IR.

## Combining with the official Figma MCP (Model A — host-orchestrated)

MCP servers can't call each other — the **host agent** is the hub. So "figma MCP + custom MCP" means: register **both** servers, and the agent feeds the official Dev Mode MCP's outputs into this server's *ingest* tools. This server does the transforms the official one can't (map to your components, codegen, validate, token accounting).

```
Agent (host)
  1. Figma Dev Mode MCP: get_variable_defs   ─┐
  2. Figma Dev Mode MCP: get_code_connect_map ─┼─► paste into figma-angular-sync:
  3. Figma Dev Mode MCP: get_image            ─┘
  4. figma-angular-sync: figma_import_node(fileKey,nodeId)   # geometry (REST — Dev Mode has no node tree)
  5. figma-angular-sync: figma_ingest_variable_defs(screen, <get_variable_defs>)   # tokens, any plan (no Enterprise REST)
  6. figma-angular-sync: lib_ingest_code_connect(<get_code_connect_map>)           # deterministic reuse, no LLM
  7. figma-angular-sync: lib_search_component(screen) → codegen_from_node(screen)
  8. figma-angular-sync: codegen_validate(screen, html, width, figmaImageBase64=<get_image>)
  9. figma-angular-sync: metrics_record_llm_usage(...)  # after each LLM step, with exact usage
 10. figma-angular-sync: metrics_report(scope="all")     # unified $0-deterministic + measured-agent total
```

Division of labor:

| From the official Dev Mode MCP | Ingested by this server via |
|---|---|
| `get_variable_defs` | `figma_ingest_variable_defs` (tokens without Enterprise REST) |
| `get_code_connect_map` | `lib_ingest_code_connect` (node→component, confidence 1.0, no model) |
| `get_image` | `codegen_validate(figmaImageBase64=…)` |

**Geometry still comes from REST** (`figma_import_node`) because the Dev Mode MCP does not expose a raw node tree. If you skip the Dev Mode MCP entirely, use `figma_extract_tokens` (Enterprise Variables REST) instead of `figma_ingest_variable_defs` — everything else is unchanged.

## Angular → Figma write path

REST can't create nodes, so writes go through the Figma plugin in `figma-plugin/`:

1. Import `figma-plugin/manifest.json` in Figma (Plugins → Development → Import plugin from manifest).
2. Run the plugin — its UI connects to the WS bridge on `localhost:8787`.
3. Call `figma_apply_plan { screen }`; the plugin builds the nodes and returns the created root id.

## Architecture

```
src/
  ir/        schema.ts (shared IR) · normalizeRest.ts (Figma REST → IR)
  figma/     rest.ts (nodes / images / variables)
  tokens/    extract.ts (Variables ⇄ CSS custom properties)
  layout/    mapper.ts (auto-layout ⇄ flexbox, single source of truth) + tests
  codegen/   angular.ts (IR → Angular ts/html/scss, one-shot)
  verify/    validate.ts (Playwright render + pixelmatch diff, report-only)
  lib/       index.ts (component index + reuse matching)
  llm/       provider.ts (MCP sampling first, adapter fallback — model-agnostic)
  metrics/   store.ts (shared file store) · pricing.ts (model→$/Mtok) · collector.ts (aggregation)
  reverse/   parseAngular.ts (render+measure → IR) · buildPlan.ts (IR → Figma plan)
  bridge/    wsBridge.ts (MCP ↔ Figma plugin socket)
  index.ts   MCP server: registers all tools
figma-plugin/  manifest.json · code.js · ui.html (the only write path into Figma)
```

## Icons, logos & vectors (SVG assets)

Figma vector nodes carry only paths, so codegen alone renders them as empty boxes (icons/logos show as solid colored blocks). `figma_export_assets` fixes this:

- It finds export **boundaries** — a vector leaf, or a frame/group whose whole subtree is vectors (a multi-path logo/icon) — and exports each as **one crisp SVG** (raster images become PNG).
- The SVG is attached to the IR node; `codegen_from_node` **inlines** it (`<span>…<svg>…</svg></span>`) and suppresses the fill-as-background, so the graphic renders instead of a block.
- Uses REST image export (`format=svg`) — works on **any Figma plan** with a token. You can also pass a pre-exported `nodeId → {svg}` map (e.g. from another source) via the tool's `assets` param.
- Run it **before** `codegen_from_node`. `unresolvedVectorNodes` in the result tells you if any vectors weren't exported.

**Icon theming (`currentColor`).** By default (`themeIcons: true`), a **single-color, icon-sized** vector (search, refresh, ⋯) is rewritten so its `fill`/`stroke` use `currentColor` — it then inherits CSS `color`, so it themes automatically (dark mode, hover, brand). "Icon-sized" means max dimension ≤ `FIGMA_ICON_MAX_PX` (default 64), so large data-viz strokes (chart trend lines) are **not** themed and keep their exact design colors:

```css
.search-icon { color: #666; }
.search-icon:hover { color: #2166f5; }   /* icon recolors with CSS */
```

A **multi-color logo** (2+ colors) is always left with its exact Figma colors — never flattened. `fill="none"` and gradients are preserved. Set `themeIcons: false` to keep every asset's baked-in colors. The tool returns `themedIcons` = how many icons were made themeable.

## Real components (not static HTML/CSS)

`codegen_from_node` emits genuinely data-driven Angular:

- **Responsive sizing** from Figma's own model — `layoutSizingHorizontal/Vertical` = **FILL → `flex:1`** (main axis) / `align-self:stretch` (cross), **HUG → content-sized** (no width), **FIXED → px**. The screen root becomes `width:100%; max-width:<design width>`, height auto — no more fixed-to-Figma-dimensions.
- **State + bindings** — text nodes bind to class fields (`{{ title }}` + `title = 'Revenue';`), not hardcoded markup.
- **`*ngFor`** — runs of repeated reused components collapse to `<app-card *ngFor="let item of cards" [title]="item.title">` with a generated typed data array.
- **Figma variants → `@Input`s** — an INSTANCE's `componentProperties` (Variant/State/text props) are read and bound on the reused component: `<app-button [variant]="'Primary'" [label]="'Save'">`.

## Codegen behavior worth knowing

- **Valid CSS idents:** class names are sanitized — a Figma layer named `300px`/`0` becomes `.n300px`/`.n0` (never `.300px`, which breaks Sass). Property values like `width: 300px` are untouched.
- **Root is anchored:** the screen root emits `position: relative; left: 0; top: 0` so canvas coordinates never push it off-viewport; absolute offsets cascade only to descendants that need them.
- **Text nodes** get `white-space: nowrap` and size to content (no fixed hug width), so labels/breadcrumbs don't wrap under a wider fallback font. `codegen_from_node` returns `fonts` (design fonts to load via `@font-face`/links) and `styleBytes` + a `styleBudgetNote` when the SCSS exceeds Angular's default 4 KB `anyComponentStyle` budget.

## Notes / limitations

- `codegen_validate` is **one-shot** (report, not repair). See the plan's "Future: closed-loop refinement".
- `figma_apply_plan` requires the `ws` package and the plugin connected.
- Variables REST is Enterprise-only. `figma_extract_tokens` / `figma_import_node withTokens` **degrade gracefully** on a 403 — they warn and continue with literal colors instead of failing the stage. Use `figma_ingest_variable_defs` (Dev Mode MCP) for tokens on non-Enterprise plans.
