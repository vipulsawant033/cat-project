import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GeneratedAngularComponent } from '../codegen/angular-generator.js';
import type { GeneratedAngularPage } from '../codegen/page-generator.js';
import type { PreviewResult } from '../types.js';
import { findAvailablePort, isHttpServerUp } from './port.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Two levels up from src/preview (or dist/preview) is the project root. */
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const PREVIEW_DIR = path.join(PROJECT_ROOT, 'preview-app');
const STATE_FILE = path.join(PREVIEW_DIR, '.preview-state.json');
const PORT_RANGE_START = 4300;

/** Tracks the dev server this process itself spawned, for reuse and shutdown. */
let activeServer: { port: number; child: ChildProcess } | null = null;

async function writeComponentFiles(component: GeneratedAngularComponent, dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  for (const file of component.files) {
    await writeFile(path.join(dir, file.fileName), file.content, 'utf-8');
  }
}

function generatedDirFor(folder: string): string {
  return path.join(PREVIEW_DIR, 'src', 'app', 'generated', folder);
}

/**
 * Overwrites the preview app's root component to render the freshly generated
 * component. Rewritten wholesale (inline template, no templateUrl) rather than
 * patched, since we fully own this file's content between generations.
 */
async function wireRootComponent(component: GeneratedAngularComponent): Promise<void> {
  const appDir = path.join(PREVIEW_DIR, 'src', 'app');
  const ts = `import { Component } from '@angular/core';
import { ${component.className} } from './generated/${component.folder}/${component.folder}.component';

/** Rewritten on every generate call to host whichever component was generated last. */
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [${component.className}],
  template: '<${component.selector}></${component.selector}>',
})
export class AppComponent {}
`;
  await mkdir(appDir, { recursive: true });
  await writeFile(path.join(appDir, 'app.component.ts'), ts, 'utf-8');
  await Promise.all(
    ['app.component.html', 'app.component.scss', 'app.component.spec.ts'].map((f) =>
      rm(path.join(appDir, f), { force: true })
    )
  );
}

async function waitForServerReady(port: number, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isHttpServerUp(port)) return true;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

async function readState(): Promise<{ port: number; pid?: number } | null> {
  if (!existsSync(STATE_FILE)) return null;
  try {
    return JSON.parse(await readFile(STATE_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

async function ensureDevServerRunning(): Promise<{ port: number; status: 'started' | 'already-running' }> {
  if (activeServer) {
    return { port: activeServer.port, status: 'already-running' };
  }

  // A previous MCP server process may still have a dev server up (ng serve watches
  // and rebuilds automatically) — reuse it instead of spawning a duplicate.
  const priorState = await readState();
  if (priorState?.port && (await isHttpServerUp(priorState.port))) {
    return { port: priorState.port, status: 'already-running' };
  }

  const port = await findAvailablePort(PORT_RANGE_START);
  // Invoke the CLI's own JS entry point via `node`, rather than the .bin/ng(.cmd) shim via a
  // shell: on Windows, shell:true + a project path containing spaces (e.g. "new mcp") breaks
  // command-line quoting and the child dies instantly instead of starting the dev server.
  const ngEntry = path.join(PREVIEW_DIR, 'node_modules', '@angular', 'cli', 'bin', 'ng.js');

  const child = spawn(process.execPath, [ngEntry, 'serve', '--port', String(port)], {
    cwd: PREVIEW_DIR,
    stdio: 'ignore',
  });
  activeServer = { port, child };
  child.on('exit', () => {
    if (activeServer?.child === child) activeServer = null;
  });

  await writeFile(STATE_FILE, JSON.stringify({ port, pid: child.pid }), 'utf-8');

  const ready = await waitForServerReady(port, 90_000);
  if (!ready) {
    throw new Error(
      `ng serve on port ${port} did not respond within 90s. Run "npm run preview:dev" manually in ` +
        `${PREVIEW_DIR} to see the actual error.`
    );
  }

  return { port, status: 'started' };
}

/**
 * Writes the generated component into the preview workspace, wires it as the
 * app root, and makes sure a dev server is serving it — spawning one on the
 * first call, reusing it (via live-reload) on later calls.
 *
 * Requires the one-time `npm run preview:setup` to have been run already;
 * returns a 'setup-required' result instead of failing if it hasn't.
 */
export async function ensurePreviewRunning(component: GeneratedAngularComponent): Promise<PreviewResult> {
  if (!existsSync(PREVIEW_DIR)) {
    return {
      status: 'setup-required',
      message:
        'No preview workspace found. From the figma-angular-mcp-vipul project root, run ' +
        '`npm run preview:setup` once (scaffolds a minimal Angular app and installs its dependencies — ' +
        'takes a few minutes, one-time only), then generate again.',
    };
  }

  await writeComponentFiles(component, generatedDirFor(component.folder));
  await wireRootComponent(component);

  const { port, status } = await ensureDevServerRunning();
  return { status, url: `http://localhost:${port}` };
}

/**
 * Same as ensurePreviewRunning, but for a whole generated page: writes the
 * page's own files plus every section's files (under `sections/<folder>/`
 * relative to the page, matching the import paths page-generator.ts baked
 * into the page's .ts file), then wires the page as the app root — Angular
 * resolves the page's own imports of each section from there.
 */
export async function ensurePagePreviewRunning(generated: GeneratedAngularPage): Promise<PreviewResult> {
  if (!existsSync(PREVIEW_DIR)) {
    return {
      status: 'setup-required',
      message:
        'No preview workspace found. From the figma-angular-mcp-vipul project root, run ' +
        '`npm run preview:setup` once (scaffolds a minimal Angular app and installs its dependencies — ' +
        'takes a few minutes, one-time only), then generate again.',
    };
  }

  const pageDir = generatedDirFor(generated.page.folder);
  await writeComponentFiles(generated.page, pageDir);
  for (const section of generated.sections) {
    await writeComponentFiles(section, path.join(pageDir, 'sections', section.folder));
  }
  await wireRootComponent(generated.page);

  const { port, status } = await ensureDevServerRunning();
  return { status, url: `http://localhost:${port}` };
}

/** Kills the dev server this process spawned, if any. Call on process shutdown. */
export function shutdownPreview(): void {
  if (activeServer) {
    activeServer.child.kill();
    activeServer = null;
  }
}
