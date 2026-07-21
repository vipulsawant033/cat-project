# figma-angular-mcp-vipul

An MCP (Model Context Protocol) server that turns a Figma component link into
a standalone Angular component (`.ts` + `.html` + `.scss`), plus a REST bridge
so AI tools that don't speak MCP natively can use the same functionality.

## How it fits together

```
Figma component link
        │
        ▼
 src/figma/client.ts   -- parses the link, calls the Figma REST API
        │
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
```

The **core logic lives in `src/core`** and knows nothing about MCP or HTTP.
Both entry points (`src/mcp/tools/*` and `src/bridge/routes.ts`) call the
same core function, validate input with the same Zod schema
(`src/types.ts`), and return the same JSON shape — so MCP-native and
non-MCP AI tools get identical results.

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

The server exposes one tool today: **`generate_angular_component`**.

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

Ideas for natural next tools: `figma_extract_design_tokens` (colors/type
scale -> SCSS variables), `sync_angular_to_figma` (push component changes
back as a Figma library update), `generate_react_component` (same IR, a
different codegen backend).

## Known limitations of the codegen stub

The transformation in `src/codegen` covers auto-layout (-> flexbox), solid
fills, strokes/borders, corner radius, opacity, basic text styling, vector/icon
export (via the Figma Images API — see `src/figma/icon-detector.ts`), and
root-level responsive sizing (`width: 100%; max-width: <frame width>px`
instead of a hardcoded viewport size). It does **not** yet handle: gradients,
effects (shadow/blur), component variants/props, raster image fills (only
solid fills and exported vector icons), or per-node Figma layout constraints
(pinning/stretching) below the root — non-root auto-layout containers flex to
their content, but a plain (non-auto-layout) frame deep in the tree still gets
a fixed px box. Extend `src/figma/parser.ts` (IR fields) and
`src/codegen/templates.ts` (rendering) together when adding support for these.

## Project layout

```
src/
  figma/      Figma URL parsing, REST API client, icon detector, node-tree -> IR parser
  codegen/    IR -> Angular component files (naming, HTML/CSS/TS templates)
  core/       Shared tool implementations (Figma link in -> component out)
  mcp/        MCP server + tool registration (stdio transport)
  bridge/     Express REST bridge wrapping the same core logic
  preview/    Manages the local Angular dev server used for live preview
  types.ts    Shared Zod input schema / output types
examples/
  sample-figma-node.json       Offline fixture for testing the codegen stub
  generate-from-sample.ts      Runs parser+codegen against the fixture, no network
preview-app/  (generated by `npm run preview:setup`, gitignored) Angular workspace
              used only to host/serve whichever component was generated last
```
