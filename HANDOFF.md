# Client Handoff Checklist

## Before First Use

- [ ] Generate a Figma Personal Access Token: Figma → Settings → Account → Personal access tokens
- [ ] Copy `.env.example` to `.env` and fill in all required values
- [ ] Set `ANGULAR_SOURCE_PATH` to the absolute path of your Angular project's `/src` folder
- [ ] Set `LIT_SOURCE_PATH` to the absolute path of your Lit components source
- [ ] Set `SCSS_TOKENS_PATH` to your design tokens SCSS file (e.g. `_variables.scss`)
- [ ] Run `npm install && npm run build`
- [ ] Run `npm run index` to index Angular components
- [ ] Run `npm run index:lit` to index Lit web components
- [ ] Run `npm test` to verify the integration tests pass
- [ ] Add the MCP server config to your AI client of choice — Claude Code, Cursor, VS Code/GitHub Copilot, etc. (see README's MCP Configuration section for each client's JSON config)
- [ ] Test with a simple Figma node ID to verify end-to-end

## Adding New Components

**Angular components** are auto-discovered when you run `npm run index`. Any `.component.ts` file in `ANGULAR_SOURCE_PATH` with a `@Component` decorator will be indexed.

**Lit web components** are auto-discovered when you run `npm run index:lit`. Any `.ts` file in `LIT_SOURCE_PATH` with a `@customElement` decorator or `customElements.define()` call will be indexed.

For **watch mode** during development (auto-reindex on file save):
```bash
npm run dev:watch
```

This watches `ANGULAR_SOURCE_PATH` for changes and incrementally updates the index.

## Improving Mapping Accuracy

The server uses FTS (full-text search) to match Figma node names to component selectors. You can improve accuracy in two ways:

**1. Add `@figma-component` annotations** (recommended for frequently-used components):

Angular:
```typescript
// @figma-component: <figma-component-node-id>
@Component({ selector: 'app-my-button', ... })
```

Lit:
```typescript
/**
 * @figma-component <figma-component-node-id>
 */
@customElement('my-button')
```

Get the node ID: In Figma, right-click a master component → "Copy link". The node ID is in the URL after `node-id=`.

**2. Use `lib_map_figma_to_component`** via your AI client:
```
Ask: "Map Figma component 1234:5678 to the my-button Lit element"
The assistant will call: lib_map_figma_to_component({ figmaComponentId: "1234:5678", selector: "my-button" })
```

## Adding SCSS Token Mappings

The token mapper reads your SCSS variables file and matches hex color values to `$variable-name` declarations. Format your tokens file like this:

```scss
$color-primary: #1a73e8;
$color-secondary: #5f6368;
$color-background: #ffffff;
$spacing-sm: 8px;
$spacing-md: 16px;
$border-radius-base: 4px;
```

Run `npm run index` after changing the tokens file — the token mapper reloads on each generation call.

## Watch Mode During Development

Start the server in watch mode to get automatic re-indexing:

```bash
npm run dev:watch
```

When a `.component.ts` file changes, the affected component is re-indexed automatically. Lit components require a manual `npm run index:lit` re-run (Lit file watching is not included in v1).

## CI Integration

Add this to your CI pipeline to keep the index in sync with your codebase:

```yaml
- name: Index Angular components
  run: npm --prefix /path/to/figma-angular-mcp run index
  env:
    ANGULAR_SOURCE_PATH: ${{ github.workspace }}/src
    DB_PATH: /path/to/figma-angular-mcp/data/component-map.db

- name: Index Lit components  
  run: npm --prefix /path/to/figma-angular-mcp run index:lit
  env:
    LIT_SOURCE_PATH: ${{ github.workspace }}/packages/web-components/src
```

## Directory Reference

```
figma-angular-mcp/
├── src/index.ts              ← MCP server entry point & tool registry
├── src/tools/figma/          ← Figma API tools
├── src/tools/library/        ← Component index tools
├── src/tools/codegen/        ← Code generation tools  
├── src/services/             ← Core services (FigmaClient, ComponentIndex, CodeGenerator)
├── src/parsers/              ← Angular and Lit AST parsers
├── src/test/fixtures/        ← Sample components for integration tests
├── data/component-map.db     ← SQLite index (auto-created)
├── data/token-cache.json     ← Figma API cache (auto-created)
├── .env                      ← Your configuration (do not commit)
└── .env.example              ← Template for .env
```
