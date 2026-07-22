import * as path from 'path';

// Anchored to this file's compiled location (dist/utils/paths.js -> project root),
// not process.cwd() — MCP clients (Claude Desktop, VS Code, etc.) launch this server
// with an arbitrary working directory, so cwd-relative defaults would scatter the
// SQLite index/cache/log files depending on who started the process.
export const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

export function projectPath(...segments: string[]): string {
  return path.join(PROJECT_ROOT, ...segments);
}
