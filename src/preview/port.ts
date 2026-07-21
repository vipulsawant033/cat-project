import { createServer } from 'node:net';

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = createServer()
      .once('error', () => resolve(false))
      .once('listening', () => tester.close(() => resolve(true)))
      .listen(port, '127.0.0.1');
  });
}

/** Finds the first free TCP port at or after `start`, scanning at most `attempts` ports. */
export async function findAvailablePort(start = 4300, attempts = 50): Promise<number> {
  for (let port = start; port < start + attempts; port++) {
    if (await isPortFree(port)) return port;
  }
  throw new Error(`No free port found in range ${start}-${start + attempts - 1}`);
}

/** True if something is already answering HTTP on this port (e.g. a dev server from a prior run). */
export async function isHttpServerUp(port: number, timeoutMs = 800): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`http://localhost:${port}`, { signal: controller.signal });
    return res.ok || res.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
