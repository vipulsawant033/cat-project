# figma-angular-mcp-vipul

An MCP (Model Context Protocol) server for pixel-perfect **Figma → Angular**
(one direction only — no Angular → Figma sync). Turns a Figma component link
into a standalone Angular component (`.ts` + `.html` + `.scss`), plus a set of
supporting tools for extracting design tokens/variants, mapping Figma
components onto your real Angular/design-system component library, and a REST
bridge so AI tools that don't speak MCP natively can use the same
functionality.

## How it fits together

```
Figma component link
        │
        ▼
 src/figma/client.ts   -- parses the link, calls the Figma REST API
        │                 (file/node fetch, variables, component sets, image export)
        ▼
 src/figma/parser.ts    -- Figma node tree -> simplified IR (IrNode)
        │
        ▼
 src/codegen/*          -- IR -> Angular component files (naming, HTML, SCSS, TS)
        │
        ▼
 src/core/generate-angular-component.ts   -- orchestrates the above, shared logic
        │
   ┌────┴─────┐
   ▼          ▼
MCP tool   REST route
(src/mcp)  (src/bridge)

 src/library/*  -- indexes your Angular component library and persists
                   Figma-component -> Angular-selector mappings (local
                   equivalent of Figma Code Connect), independent of the
                   generation pipeline above

 src/visual/*   -- headless-browser screenshots (Playwright) + pixel-diffing
                   (pixelmatch/pngjs) against Figma's own PNG export
```

The **core logic lives in `src/core`** and knows nothing about MCP or HTTP.
Both entry points (`src/mcp/tools/*` and `src/bridge/routes.ts`) call the
same core function, validate input with the same Zod schema
(`src/types.ts`), and return the same JSON shape — so MCP-native and
non-MCP AI tools get identical results.

This server currently has 17 tools, organized in six groups:

| Group | Tools |
|---|---|
| Generation | `generate_angular_component`, `generate_angular_page` |
| Figma extraction | `figma_get_file`, `figma_get_node`, `figma_extract_tokens`, `figma_get_component_set`, `figma_export_node_image` |
| Component-library mapping | `lib_index_components`, `lib_search_component`, `lib_get_component`, `lib_map_figma_to_component`, `lib_list_mappings` |
| Pixel-fidelity validation | `codegen_diff`, `codegen_validate` |
| Round-trip manifest | `codegen_detect_drift`, `manifest_list` |
| Closed-loop entry point | `codegen_auto_regenerate` |

## Setup

```bash
npm install
cp .env.example .env
# then edit .env and set FIGMA_TOKEN (Figma > Settings > Personal access tokens)
npm run build
```

Try the codegen stub offline first (no Figma token/network needed) against
the sample fixture in `examples/sample-figma-node.json`:

```bash
npm run example
```

### Live preview (one-time setup)

By default, every generation is also served on a local Angular dev server so
you can view the result in a browser immediately. This needs a small Angular
workspace scaffolded once:

```bash
npm run preview:setup
# runs `ng new preview-app` + installs Angular deps into ./preview-app — a few
# minutes, one-time only. Skip this if you only want the raw generated files
# (pass "serve": false in the tool input).
#
# Pinned to @angular/cli@19 rather than @latest: newer Angular CLI releases
# enforce Node patch-level minimums (e.g. requiring 22.22.3+) that can be
# newer than what's actually installed even on an otherwise-current Node 22.
# Bump the version in the "preview:setup" script once your Node matches.
```

After that, every `generate_angular_component` call writes the generated
component into `preview-app/src/app/generated/<name>/`, wires it in as the
app root, and starts (or reuses) `ng serve` — the response's `preview.url`
field is where to look. If something looks wrong, run `npm run preview:dev`
to see `ng serve`'s own console output directly.

### Pixel-diff validation (one-time setup)

`codegen_diff` screenshots the live preview via a headless Chromium browser,
which needs its own one-time binary install (separate from the npm packages):

```bash
npx playwright install chromium
```

### Option A — Run as an MCP server (for MCP-native AI tools)

Any MCP-native client (Claude Code, Claude Desktop, Cursor, Windsurf, etc.)
can spawn `dist/index.js` and talk to it over stdio. Example client config:

```json
{
  "mcpServers": {
    "figma-angular-mcp-vipul": {
      "command": "node",
      "args": ["dist/index.js"],
      "env": { "FIGMA_TOKEN": "figd_..." }
    }
  }
}
```

### Generation: `generate_angular_component`

Input:
```json
{
  "figmaLink": "https://www.figma.com/design/<fileKey>/<title>?node-id=12-34",
  "writeToDisk": false,
  "serve": true
}
```

Output (`structuredContent`):
```json
{
  "source": { "fileKey": "...", "nodeId": "12:34", "fileName": "...", "nodeName": "Profile Card" },
  "component": {
    "selector": "app-profile-card",
    "className": "ProfileCardComponent",
    "folder": "profile-card",
    "files": [
      { "fileName": "profile-card.component.ts", "content": "..." },
      { "fileName": "profile-card.component.html", "content": "..." },
      { "fileName": "profile-card.component.scss", "content": "..." }
    ]
  },
  "preview": { "status": "started", "url": "http://localhost:4300" }
}
```

`preview.status` is one of:
- `started` — a new `ng serve` was just spawned on `preview.url`
- `already-running` — a dev server from an earlier call is already serving `preview.url` (it live-reloads on its own)
- `setup-required` — `npm run preview:setup` hasn't been run yet; the component files themselves are still returned, just not served
- `error` — serving failed for some other reason (see `preview.message`); the component files are still returned

Pass `"serve": false` to skip all of this and just get the file contents back.

### Generation: `generate_angular_page`

For a whole screen/dashboard, `generate_angular_component` would flatten
everything into one file — on a real production dashboard we tested this
against, that was a single ~2900-line SCSS file. `generate_angular_page`
splits a screen into a composing **page** component plus one standalone
component per **top-level section** instead:

- Only direct children of the root that are containers with their own
  children get split out (e.g. a page's "Menu" and "Body" wrappers); leaves
  (icons/text/images) and already-mapped component instances stay inlined,
  since they're already a single unit either way.
- Each section is generated from the already-parsed IR (no extra Figma API
  calls) with its own responsive root sizing, written under
  `sections/<folder>/` relative to the page.
- The page component's template just references each section by selector
  (`<app-menu-desktop>`, `<app-body>`), with real resolved imports —
  same import-resolution logic as `generate_angular_component`.

Input/output shape mirrors `generate_angular_component` (`figmaLink`,
`figmaToken`, `writeToDisk`, `outputDir`, `serve`), except the output has
`page` and `sections` (an array) instead of a single `component`:

```json
{
  "source": { "fileKey": "...", "nodeId": "...", "fileName": "...", "nodeName": "Dashboard (Desktop)" },
  "page": { "selector": "app-dashboard-desktop", "className": "DashboardDesktopComponent", "folder": "dashboard-desktop", "files": [...] },
  "sections": [
    { "selector": "app-menu-desktop", "className": "MenuDesktopComponent", "folder": "menu-desktop", "files": [...] },
    { "selector": "app-body", "className": "BodyComponent", "folder": "body", "files": [...] }
  ],
  "preview": { "status": "started", "url": "http://localhost:4300" }
}
```

Splitting is currently **one level deep only** — a top-level "Body" section
that itself wraps most of the screen's content won't be recursively broken
down further. Extend `src/codegen/page-generator.ts`'s split condition (e.g.
by depth or a size/complexity threshold) if you need finer-grained sections.

### Figma extraction tools

| Tool | Input | Purpose |
|---|---|---|
| `figma_get_file` | `figmaLink`, `maxDepth?` | Depth-limited document tree summary (id/name/type/childCount) — find node ids before drilling in |
| `figma_get_node` | `figmaLink` (with node-id) | Full raw node — layout, fills, strokes, text style, variant properties |
| `figma_extract_tokens` | `figmaLink` (file-level) | Every design-token variable, normalized to a CSS custom-property name + resolved value per mode |
| `figma_get_component_set` | `figmaLink` (node-id on a COMPONENT_SET) | Variant property definitions (e.g. Style/Size) and every concrete variant's values |
| `figma_export_node_image` | `figmaLink`, `scale?`, `format?` | PNG export as a signed URL or inline base64 — raster assets and the pixel-diff reference image |

### Component-library mapping tools

These give the codegen pipeline a way to emit real design-system components
(`<cat-button>`) instead of plain `<div>` trees — the local equivalent of
Figma's Code Connect. `lib_index_components` scans an Angular workspace via
the TypeScript compiler API for `@Component` classes (classic decorator-based
`@Input()`/`@Output()` only — signal-based `input()`/`output()` isn't parsed
yet) and persists the result; the other tools read/write from that persisted
state.

| Tool | Input | Purpose |
|---|---|---|
| `lib_index_components` | `libraryDir?` (or `COMPONENT_LIBRARY_DIR` env) | Scans the library, writes `component-library-index.json` (gitignored — regenerate, don't commit) |
| `lib_search_component` | `query` | Substring search over the index by selector/class name |
| `lib_get_component` | `selector` | Exact lookup — full API (inputs/outputs/file path) for one component |
| `lib_map_figma_to_component` | `figmaComponentKey`, `figmaComponentName`, `angularSelector`, `propertyMappings?` | Persists one Figma → Angular mapping to `figma-library-mappings.json` (commit this file — it's the manifest) |
| `lib_list_mappings` | *(none)* | Returns every persisted mapping |

### Pixel-fidelity validation tools

`codegen_diff` is what turns "pixel perfect" into a measurable pass/fail
instead of an eyeballed comparison: it generates + serves the component
(reusing `generate_angular_component`'s exact pipeline), screenshots it live
via a headless browser, fetches Figma's own PNG export as ground truth, and
pixel-diffs the two (via `pixelmatch`/`pngjs`). It correctly crops Figma's
export down to the node's layout box first (Figma renders to
`absoluteRenderBounds`, which includes shadow/effect bleed and is normally
larger than the layout box an element screenshot captures), and clusters
differing pixels into coarse bounding-box regions rather than reporting a
single opaque percentage.

`codegen_validate` is a complementary *structural* check — no browser, no
pixels — reporting which INSTANCE nodes in a frame have no
`lib_map_figma_to_component` mapping, so you know exactly which components to
map next for the biggest fidelity/reuse improvement.

| Tool | Input | Purpose |
|---|---|---|
| `codegen_diff` | `figmaLink`, `maxMismatchRatio?`, `pixelThreshold?`, `includeDiffImage?` | Live screenshot vs. Figma PNG export, pixel-diffed; returns mismatch ratio, pass/fail, and diff regions |
| `codegen_validate` | `figmaLink` | Lists every unmapped component instance in the frame (with its Figma key/name, ready for `lib_map_figma_to_component`) |

Example `codegen_diff` output (verified against a real production Figma file):
```json
{
  "source": { "fileKey": "...", "nodeId": "568:27477", "nodeName": "Menu (Desktop" },
  "width": 88, "height": 1048,
  "totalPixels": 92224, "differingPixels": 6066, "mismatchRatio": 0.066,
  "maxMismatchRatio": 0.02, "passed": false,
  "regions": [
    { "x": 0, "y": 72, "width": 88, "height": 264, "differingPixels": 3475 },
    { "x": 0, "y": 384, "width": 88, "height": 120, "differingPixels": 1859 }
  ],
  "regionsTruncated": false,
  "previewUrl": "http://localhost:4300"
}
```

Region clustering is deliberately coarse (24px grid cells, not exact
pixel-level connected-component tracing) — good enough to point at the right
area of the screen without the cost of pixel-exact region boundaries.

### Round-trip manifest tools

`generate_angular_component`/`generate_angular_page` record a manifest entry
on every call (keyed by `fileKey:nodeId`), and `codegen_diff` attaches its
result to that same entry — see `src/manifest/store.ts`. The "version" tracked
isn't Figma's own file-level `version` field (too coarse — it bumps on any
edit anywhere in the file, not just this node); it's a content hash
(`src/figma/content-hash.ts`) of the specific node's own JSON, so drift
detection is accurate per-node regardless of what else changed in the file.

| Tool | Input | Purpose |
|---|---|---|
| `codegen_detect_drift` | `figmaLink` | Compares the node's current content hash against its last recorded generation; reports `drifted`, the last output info, and last diff result if any |
| `manifest_list` | *(none)* | Returns every persisted generation-history entry |

**Important**: neither tool auto-regenerates anything. A hash match only
means "the Figma content is unchanged" — it doesn't mean nothing else is
worth regenerating for (e.g. you may have added a new
`lib_map_figma_to_component` mapping since). Regenerating is always a
deliberate, separate call. Regenerating with a *different* content hash than
what's stored clears any `lastDiff` on that entry, since a diff result is
only meaningful relative to the exact design content it measured against;
regenerating with the *same* hash (e.g. after only a mapping change) preserves
it.

### Closed-loop entry point: `codegen_auto_regenerate`

Generation here is a pure, deterministic function of (Figma content, library
mappings, tokens) — calling `generate` → `diff` → `generate` → `diff` again
with nothing else changed produces bit-identical results every time. So this
tool does **not** retry internally; there's nothing an internal loop could
change. What it actually does, in one round:

1. Unless `force: true`, checks the manifest via the node's content hash and
   **skips regeneration entirely** if it's unchanged since a passing
   generation — no browser launch, no screenshot, no diff.
2. Otherwise, regenerates + diffs (identical to `codegen_diff`, which also
   records the result to the manifest).
3. If it still fails, also runs `codegen_validate` and bundles its
   unmapped-instance list directly into the response — the concrete next fix,
   in the same call, instead of a follow-up round-trip.

The actual "closed loop" happens **across** repeated calls to this tool, with
a real change made in between by whoever — human or agent — is fixing things
(adding a mapping, editing the Figma design). This tool's job is to make each
of those calls cheap when nothing changed and actionable when something's
still wrong — not to fabricate progress by retrying identical input.

```json
{
  "source": { "fileKey": "...", "nodeId": "210:7326", "nodeName": "themeToggle" },
  "skipped": false,
  "reason": "Regenerated but still exceeds maxMismatchRatio. See unmappedInstances and regions below for what to fix next...",
  "passed": false,
  "mismatchRatio": 0.426, "maxMismatchRatio": 0.02,
  "regions": [{ "x": 0, "y": 0, "width": 60, "height": 30, "differingPixels": 767 }],
  "totalInstances": 3, "mappedInstances": 0,
  "unmappedInstances": [
    { "nodeId": "210:7326", "name": "themeToggle", "componentKey": "7aac...", "componentName": "Theme=Light" },
    { "nodeId": "I210:7326;210:7303", "name": "sun", "componentKey": "4fb5...", "componentName": "sun" }
  ]
}
```

### Option B — Run the REST bridge (for non-MCP AI tools)

Some AI systems (custom GPT Actions, internal agent frameworks, simple HTTP
tool-callers) can't consume the MCP spec directly. The bridge exposes the
exact same tool as a plain HTTP JSON endpoint:

```bash
npm run bridge
# -> REST bridge listening on http://localhost:4000
```

| Method | Path                                  | Description                        |
|--------|----------------------------------------|-------------------------------------|
| GET    | `/health`                              | Liveness check                      |
| GET    | `/tools`                               | Lists available tools + example body|
| POST   | `/tools/generate-angular-component`    | Same input/output as the MCP tool   |
| POST   | `/tools/generate-angular-page`         | Same input/output as `generate_angular_page` |
| POST   | `/tools/figma-get-file`                | Same input/output as `figma_get_file` |
| POST   | `/tools/figma-get-node`                | Same input/output as `figma_get_node` |
| POST   | `/tools/figma-extract-tokens`          | Same input/output as `figma_extract_tokens` |
| POST   | `/tools/figma-get-component-set`       | Same input/output as `figma_get_component_set` |
| POST   | `/tools/figma-export-node-image`       | Same input/output as `figma_export_node_image` |
| POST   | `/tools/lib-index-components`          | Same input/output as `lib_index_components` |
| POST   | `/tools/lib-search-component`          | Same input/output as `lib_search_component` |
| POST   | `/tools/lib-get-component`             | Same input/output as `lib_get_component` |
| POST   | `/tools/lib-map-figma-to-component`    | Same input/output as `lib_map_figma_to_component` |
| POST   | `/tools/lib-list-mappings`             | Same input/output as `lib_list_mappings` |
| POST   | `/tools/codegen-diff`                  | Same input/output as `codegen_diff` |
| POST   | `/tools/codegen-validate`              | Same input/output as `codegen_validate` |
| POST   | `/tools/codegen-detect-drift`          | Same input/output as `codegen_detect_drift` |
| POST   | `/tools/manifest-list`                 | Same input/output as `manifest_list` |
| POST   | `/tools/codegen-auto-regenerate`       | Same input/output as `codegen_auto_regenerate` |

```bash
curl -X POST http://localhost:4000/tools/generate-angular-component \
  -H "Content-Type: application/json" \
  -d '{"figmaLink": "https://www.figma.com/design/<fileKey>/<title>?node-id=12-34"}'
```

Because both entry points call `runGenerateAngularComponent` in
`src/core`, the REST bridge is not a reimplementation — it's a thin HTTP
wrapper around the exact same MCP tool logic.

## Extending with additional tools

1. Add the pure implementation in `src/core/<tool-name>.ts` (input in,
   output out — no MCP or Express types).
2. Add its Zod input schema to `src/types.ts`.
3. Register it as an MCP tool in `src/mcp/tools/<tool-name>.ts`, following
   `generate-angular-component.ts` as a template, and call your
   `register<ToolName>Tool(server)` from `src/mcp/server.ts`.
4. Add a matching Express route in `src/bridge/routes.ts` (and an entry in
   its `TOOL_MANIFEST`) so REST clients get the new tool too.

This server is scoped to Figma → Angular only — deliberately not building an
Angular → Figma sync path (`sync_angular_to_figma` and similar are out of
scope here).

## Known limitations of the codegen stub

The transformation in `src/codegen` (fed by `src/figma/parser.ts`'s IR) covers:

- Auto-layout -> flexbox; non-auto-layout frames -> per-side Figma constraints
  (MIN/MAX/CENTER/STRETCH) resolved to absolute `top`/`left`/`right`/`bottom`
  positioning, not just a fixed-size box with no placement.
- Solid fills and linear/radial/angular gradients; strokes/borders; corner
  radius; opacity; drop/inner shadows and layer/background blur (`box-shadow`,
  `filter`, `backdrop-filter`).
- Basic text styling; vector/icon export (via the Figma Images API — see
  `src/figma/icon-detector.ts`); root-level responsive sizing (`width: 100%;
  max-width: <frame width>px` instead of a hardcoded viewport size).
- Design tokens: a fill/stroke/text-color bound to a Figma variable (via
  `boundVariables`) renders as `var(--token, <literal-fallback>)` instead of a
  raw hex value, using the same variable set `figma_extract_tokens` reports.
- Component substitution: an INSTANCE whose main component has a
  `lib_map_figma_to_component` mapping renders as the real Angular element
  (`<cat-badge [variant]="'Primary'">`) instead of a div tree, with its import
  resolved from the `lib_index_components` index when a `package.json` name
  could be found near its source file (falls back to a `// TODO: import`
  comment otherwise — codegen never silently drops an unresolvable import).

It does **not** yet handle: raster image fills (`kind: 'image'` in the IR has
no real asset source wired up — only solid/gradient fills and exported vector
icons), `SCALE`-constraint children (treated the same as `MIN`), or gradient
stops/corner-radius bound to variables (only fill/stroke/text color are
token-aware). Extend `src/figma/parser.ts` (IR fields) and
`src/codegen/templates.ts` (rendering) together when adding support for these.

The `lib_index_components` scanner only recognizes classic decorator-based
`@Input()`/`@Output()` members, not Angular's newer signal-based `input()`/
`output()` functions. The resolved import for a mapped component assumes the
library is imported by its package name (nearest ancestor `package.json`) —
components consumed via a relative path within the same workspace instead
will fall back to the TODO-comment case.

## Project layout

```
src/
  figma/      Figma URL parsing, REST API client (file/node/variables/component-sets/images), icon detector,
              node-tree -> IR parser, token helpers (tokens.ts), content-hash.ts (drift-detection hashing)
  codegen/    IR -> Angular component files (naming, HTML/CSS/TS templates, angular-generator.ts) plus page-generator.ts (whole-screen splitting)
  core/       Shared tool implementations (Figma link in -> component/page out; one file per tool, plus write-component-files.ts shared by both)
  library/    Angular component-library scanner + persisted index/mapping stores
  manifest/   Persisted round-trip generation history (store.ts) — Figma node -> generated output -> last diff result
  visual/     Headless-browser screenshots (screenshot.ts) + pixel-diffing (diff.ts)
  mcp/        MCP server + tool registration (stdio transport)
  bridge/     Express REST bridge wrapping the same core logic
  preview/    Manages the local Angular dev server used for live preview
  types.ts    Shared Zod input schema / output types for every tool
examples/
  sample-figma-node.json       Offline fixture for testing the codegen stub
  generate-from-sample.ts      Runs parser+codegen against the fixture, no network
preview-app/  (generated by `npm run preview:setup`, gitignored) Angular workspace
              used only to host/serve whichever component was generated last
component-library-index.json     (generated by lib_index_components, gitignored)
figma-library-mappings.json      (generated by lib_map_figma_to_component — commit this, it's the mapping table)
figma-generation-manifest.json   (generated by generate_angular_component/_page — commit this, it's the round-trip manifest)
```
