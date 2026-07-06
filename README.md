# Figma-Angular-Lit MCP Server

## What This Does

This MCP (Model Context Protocol) server bridges Figma designs and your Angular + Lit codebase. The primary flow converts Figma frames into pixel-perfect Angular component code (`.ts` + `.html` + `.scss`), automatically choosing **Lit custom elements** for UI primitives (buttons, inputs, badges, icons) and **Angular components** for feature-level containers (cards, page shells, forms). The server indexes both component libraries into a local SQLite database so Claude Code has deep knowledge of your actual component APIs.

The secondary flow goes the other direction: it parses Angular templates and generates Figma Plugin scripts that recreate your components as Figma frames. A token sync tool matches your SCSS variables to Figma styles and generates update scripts to keep designs and code in lockstep.

## Quick Start

```bash
# 1. Clone/copy the server
cd figma-angular-mcp

# 2. Configure environment
cp .env.example .env
# Edit .env and fill in FIGMA_PAT, ANGULAR_SOURCE_PATH, LIT_SOURCE_PATH

# 3. Install and build
npm install
npm run build

# 4. Index components
npm run index          # Index Angular components
npm run index:lit      # Index Lit web components

# 5. Run tests
npm test               # Unit/logic tests (generator, layout, matching, tokens)
npm run test:visual    # Visual regression suite (renders fixtures, pixel-diffs vs baselines)

# 6. Start server (for MCP integration)
npm start
```

## MCP Configuration

Add to your Claude Code MCP config (usually `~/.claude/claude_desktop_config.json` or project `.mcp.json`):

```json
{
  "mcpServers": {
    "figma-angular": {
      "command": "node",
      "args": ["/absolute/path/to/figma-angular-mcp/dist/index.js"],
      "env": {
        "FIGMA_PAT": "your_figma_personal_access_token",
        "ANGULAR_SOURCE_PATH": "/path/to/your/angular/src",
        "LIT_SOURCE_PATH": "/path/to/your/lit/components/src",
        "SCSS_TOKENS_PATH": "/path/to/tokens/_variables.scss",
        "DB_PATH": "/path/to/figma-angular-mcp/data/component-map.db"
      }
    }
  }
}
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `FIGMA_PAT` | Yes | Figma Personal Access Token (Settings → Account → Personal access tokens) |
| `ANGULAR_SOURCE_PATH` | Yes | Absolute path to Angular project `/src` directory |
| `LIT_SOURCE_PATH` | Yes | Absolute path to Lit components source directory |
| `SCSS_TOKENS_PATH` | No | Path to SCSS variables file for token mapping |
| `DB_PATH` | No | SQLite database path (default: `./data/component-map.db`) |
| `CACHE_TTL_SECONDS` | No | Figma API response cache duration (default: 300) |
| `LOG_LEVEL` | No | `debug` / `info` / `warn` / `error` (default: `info`) |
| `FIGMA_VARIABLE_MODE` | No | Name of the Figma Variable mode to resolve (e.g. `Light`, `Dark`). Defaults to each collection's default mode. |
| `CODEGEN_MAX_DEPTH` | No | Max IR recursion depth (default: 16). Subtrees beyond this are reported via `truncated`/`truncatedNodes` in `codegen_from_node`'s output rather than silently dropped. |

## Figma Variables Support

If a node's fill is bound to a Figma Variable (Enterprise plans), codegen resolves that binding — including through alias chains and a specific mode via `FIGMA_VARIABLE_MODE` — to a `var(--variable-name)` CSS custom property, instead of reverse-matching the fill's resolved hex value against your SCSS file. This is more accurate for:

- Semantic tokens whose hex value doesn't happen to match an SCSS variable exactly
- Files with light/dark or other mode variants
- Gradients and other non-solid fills bound per-stop (still fall back to SCSS/raw hex today)

If the file has no Variables, or the API call fails (e.g. non-Enterprise plan), generation falls back to the existing SCSS hex-matching behavior automatically — no configuration required. Run `figma_extract_tokens` to see which colors resolved via a Figma Variable (`variables` in the result) versus a plain style/hex value (`colors`).

## Annotating Components for Figma Mapping

Add Figma component IDs directly in your source code for deterministic mapping:

**Angular components:**
```typescript
// @figma-component: 1234:5678
@Component({ selector: 'app-button', ... })
export class ButtonComponent { ... }
```

**Lit web components:**
```typescript
/**
 * @figma-component 9999:1111
 */
@customElement('my-button')
export class MyButton extends LitElement { ... }
```

Find the component ID in Figma by right-clicking a component → "Copy/Paste as" → "Copy link" and extracting the node ID from the URL.

## How Lit Elements Are Used in Generated Code

When a Lit custom element is matched, the generator produces Angular-compatible template syntax:

```html
<!-- Requires CUSTOM_ELEMENTS_SCHEMA in the Angular module/component -->
<my-button
  .variant="primary"
  .size="md"
  (click-action)="onClickAction($event)">
  Click me
</my-button>
```

Key differences from Angular components:
- **Property binding**: `.propertyName="value"` (dot prefix = JavaScript property, not attribute)
- **Reflected attributes**: `attribute-name="value"` (kebab-case, no brackets)
- **Event binding**: `(custom-event-name)="handler($event)"` 
- **Slot content**: child elements passed directly, `<span slot="name">` for named slots
- **Schema**: Must add `CUSTOM_ELEMENTS_SCHEMA` to the Angular component/module

The TypeScript wrapper is auto-generated with the schema:
```typescript
import { Component, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';

@Component({
  selector: 'app-my-page',
  standalone: true,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  // ...
})
export class MyPageComponent {}
```

CSS custom property overrides for Lit elements go in the parent SCSS:
```scss
.my-page {
  my-button {
    --my-button-bg: var(--color-primary);
    --my-button-radius: 8px;
  }
}
```

## How Code Generation Works

1. **Figma node → IR**: The Figma node tree is converted to an Intermediate Representation (IR) with layout models, CSS styles, and component matches
2. **Component matching**: Deterministic matches (`@figma-component` annotations, `lib_map_figma_to_component` mappings) are checked first. Otherwise the server searches the SQLite index — leaf/primitive nodes prefer Lit; container/feature nodes prefer Angular. Falls back to the other type, then plain HTML
3. **Confidence scoring**: Matches below 0.5 confidence are skipped (plain HTML used instead); deterministic matches always score 1.0 (or the confidence passed to `lib_map_figma_to_component`)
4. **Binding synthesis**: Bindings are generated with the correct syntax per component type. Variant prop names are matched to component inputs on a normalized (case/punctuation-insensitive) basis, so a Figma variant like "Icon Position" binds to a component input named `iconPosition`
5. **Code output**: `.html` template, `.scss` with delta styles and Lit CSS custom property overrides, `.ts` Angular component wrapper

### Layout fidelity

- **Auto-layout** frames map to CSS flexbox (`display: flex`, `gap`, `padding`, `align-items`, `justify-content`).
- **Free-floating nodes** — children with no auto-layout parent, or explicitly marked `layoutPositioning: ABSOLUTE` inside one — are positioned with `position: absolute` and `top`/`left`/`right`/`bottom` derived from their offset within the parent's bounding box, honoring Figma's edge constraints (`MIN`/`MAX`/`STRETCH`; `CENTER`/`SCALE` are approximated as left/top-anchored, since exact reproduction needs percentage math relative to a resized parent). The parent automatically receives `position: relative` so the offsets resolve correctly.
- **Text sizing** respects `textAutoResize`: `WIDTH_AND_HEIGHT`/`HEIGHT` render as `fit-content` instead of a fixed pixel size baked from the placeholder string (important once real, longer app data replaces it); `TRUNCATE` adds `overflow: hidden; text-overflow: ellipsis; white-space: nowrap`.
- **Rotation** converts Figma's REST API radians to a CSS `transform: rotate(deg)`.
- **Fills**: the topmost visible fill becomes `background-color`/`background-image`; if a node has more than one visible fill (e.g. a color covered by a gradient overlay), all are layered via stacked `background-image` entries in the correct visual order. **Strokes** become a CSS `border` (single solid stroke only — gradient/dashed strokes aren't modeled yet).
- **Gradients**: linear gradients compute a real CSS angle from Figma's gradient handle positions (not hardcoded); radial and angular gradients map to `radial-gradient`/`conic-gradient`. Diamond gradients have no CSS equivalent and are approximated with an elliptical radial gradient.
- **Images and icons**: leaf `RECTANGLE`/`ELLIPSE`/image-fill nodes render as `<img>` with an inline `data:` URI; `VECTOR`/`BOOLEAN_OPERATION` nodes render as inline `<svg>` markup — both fetched live via the Figma image export API during generation. If a matching Lit/Angular icon component exists, that's used instead of the raw exported asset. If export fails (e.g. transient rate limit), a `<!-- TODO -->` comment marks the gap instead of silently emitting an empty element.
- **Hidden layers**: nodes with `visible: false` (e.g. an instance override hiding a badge on one card but not another) are excluded from output entirely, matching what's actually visible in Figma.
- **Truncation is reported, not silent**: `codegen_from_node` returns `truncated`/`truncatedNodes` for subtrees deeper than `CODEGEN_MAX_DEPTH`; `codegen_from_file` returns `skippedFrameNames`/`truncatedFrames` instead of silently dropping frames past `maxFrames`.

### Known limitations

- `CENTER`/`SCALE` constraint anchoring and `flex-wrap` (Figma's wrapping auto-layout) aren't modeled — both are approximated or omitted.
- Only the first visible stroke is used for borders; multiple strokes or gradient strokes fall back to no border.
- Image/icon assets are embedded as inline data URIs/SVG rather than written to separate asset files — fine for review and small icon sets, but can bloat HTML for image-heavy screens.
- `codegen_diff`'s style comparison is only as good as its snapshot history — the first `codegen_diff`/`codegen_from_node` run for a selector establishes the baseline with nothing to compare against yet.

## Visual Regression Suite

`npm run test:visual` ([src/test/visual/](src/test/visual/)) automates what used to require a human to manually screenshot generated output before `codegen_validate` could run:

1. **Corpus** — one synthetic Figma-node fixture per known generator weak spot: [absolute-positioning](src/test/visual/fixtures/absolute-positioning.json), [rotation](src/test/visual/fixtures/rotation.json), [gradient-and-shadow](src/test/visual/fixtures/gradient-and-shadow.json), [text-truncate](src/test/visual/fixtures/text-truncate.json), [nested-variant-override](src/test/visual/fixtures/nested-variant-override.json), and [mixed-lit-angular-tree](src/test/visual/fixtures/mixed-lit-angular-tree.json).
2. **Render** — each fixture is run through the real `CodeGenerator`, its SCSS is flattened to plain CSS (a minimal flattener for the generator's own known nesting shape, not a general SCSS compiler — see [scssFlatten.ts](src/test/visual/scssFlatten.ts)), wrapped in a static HTML shell, and screenshotted headlessly via Playwright/Chromium — no manual screenshot step.
3. **Diff & track** — the first run per fixture saves its screenshot as the baseline under [baselines/](src/test/visual/baselines/) (committed to the repo); every run after that pixelmatches the new screenshot against that baseline and appends `{timestamp, results}` to `data/visual-regression-history.json`, so you can see a fixture's match percentage trend over commits, not just today's pass/fail. The report also prints the average match and the single worst offender, so "the generator got worse at rotation" surfaces even when everything is still technically above threshold.

**This is a regression suite, not a Figma-fidelity suite.** Fixtures are hand-authored `FigmaNode` JSON, not real Figma exports (there's no live Figma file wired in) — a passing run proves the generator's output hasn't drifted from its own last known-good rendering, not that it matches a real design pixel-for-pixel. Wiring in real Figma reference images (via `figma_export_node_image` against an actual test file) would upgrade this from drift-detection to true fidelity-verification; ask for that if/when a suitable test Figma file is available.

To intentionally update a baseline after a deliberate visual change, delete its PNG under `baselines/` and re-run — the next run re-establishes it.

## Available Tools

| Tool | Purpose |
|------|---------|
| `figma_get_file` | Fetch full Figma file tree |
| `figma_get_node` | Fetch a specific node |
| `figma_extract_tokens` | Extract design tokens |
| `figma_get_component_set` | Get component variants |
| `figma_export_node_image` | Export as PNG for visual reference |
| `lib_index_components` | Index Angular components |
| `lib_index_lit` | Index Lit web components |
| `lib_search_component` | Search the component library |
| `lib_get_component` | Get full component API |
| `lib_map_figma_to_component` | Save Figma ↔ component mapping |
| `lib_list_mappings` | List all mappings |
| `codegen_from_node` | Generate code from a Figma node |
| `codegen_from_file` | Generate code for an entire page (`maxFrames`, default 30; extras reported, not dropped) |
| `codegen_validate` | Pixel-diff comparison |
| `codegen_diff` | Detect design changes since the last run for a selector (style diff needs a prior snapshot — first run establishes the baseline) |
| `sync_to_figma` | Generate Figma Plugin script from component |
| `sync_update_tokens` | Sync SCSS tokens to Figma styles |

## Troubleshooting

**Lit elements not indexed**: Check that `LIT_SOURCE_PATH` points to the directory containing `.ts` files with `@customElement` decorators. Run `npm run index:lit` and check the output count.

**Missing CUSTOM_ELEMENTS_SCHEMA**: This appears when Lit elements are detected in generated code. Add `schemas: [CUSTOM_ELEMENTS_SCHEMA]` to the Angular component decorator and import it from `@angular/core`.

**Token not found**: Add your SCSS variables file path to `SCSS_TOKENS_PATH`. The token mapper matches hex values to `$variable-name` declarations.

**Figma rate limits**: The server retries with exponential backoff up to 3 times. Responses are cached for `CACHE_TTL_SECONDS`. If you hit persistent rate limits, increase the TTL.

**Component not matched (confidence too low)**: Use `lib_map_figma_to_component` to add a deterministic mapping, or add a `@figma-component` annotation to the component source.

**Image/icon renders as a `<!-- TODO -->` comment**: The asset export call to Figma failed (rate limit, deleted node, or unsupported node type for export). Re-run generation, or check `LOG_LEVEL=debug` output for the underlying error.

**Content missing from generated output**: Check `truncated`/`truncatedNodes` (from `codegen_from_node`) or `skippedFrameNames`/`truncatedFrames` (from `codegen_from_file`) in the tool result — deep subtrees and page frames beyond the configured limits are reported there rather than silently dropped. Raise `CODEGEN_MAX_DEPTH` or pass a higher `maxFrames` if needed.
