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
npm test

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
2. **Component matching**: For each node, the server searches the SQLite index. Leaf/primitive nodes prefer Lit; container/feature nodes prefer Angular. Falls back to the other type, then plain HTML
3. **Confidence scoring**: Matches below 0.5 confidence are skipped (plain HTML used instead)
4. **Binding synthesis**: Bindings are generated with the correct syntax per component type
5. **Code output**: `.html` template, `.scss` with delta styles and Lit CSS custom property overrides, `.ts` Angular component wrapper

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
| `codegen_from_file` | Generate code for an entire page |
| `codegen_validate` | Pixel-diff comparison |
| `codegen_diff` | Detect design changes |
| `sync_to_figma` | Generate Figma Plugin script from component |
| `sync_update_tokens` | Sync SCSS tokens to Figma styles |

## Troubleshooting

**Lit elements not indexed**: Check that `LIT_SOURCE_PATH` points to the directory containing `.ts` files with `@customElement` decorators. Run `npm run index:lit` and check the output count.

**Missing CUSTOM_ELEMENTS_SCHEMA**: This appears when Lit elements are detected in generated code. Add `schemas: [CUSTOM_ELEMENTS_SCHEMA]` to the Angular component decorator and import it from `@angular/core`.

**Token not found**: Add your SCSS variables file path to `SCSS_TOKENS_PATH`. The token mapper matches hex values to `$variable-name` declarations.

**Figma rate limits**: The server retries with exponential backoff up to 3 times. Responses are cached for `CACHE_TTL_SECONDS`. If you hit persistent rate limits, increase the TTL.

**Component not matched (confidence too low)**: Use `lib_map_figma_to_component` to add a deterministic mapping, or add a `@figma-component` annotation to the component source.
