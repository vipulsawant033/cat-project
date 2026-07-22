import * as fs from 'fs';
import * as path from 'path';
import { projectPath } from './paths.js';

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

interface CacheStore {
  [key: string]: CacheEntry<unknown>;
}

const CACHE_PATH = process.env.CACHE_PATH ? path.resolve(process.env.CACHE_PATH) : projectPath('data', 'token-cache.json');
const TTL_MS = (parseInt(process.env.CACHE_TTL_SECONDS || '300', 10)) * 1000;

function load(): CacheStore {
  try {
    const dir = path.dirname(CACHE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(CACHE_PATH)) return {};
    return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8')) as CacheStore;
  } catch {
    return {};
  }
}

function save(store: CacheStore): void {
  try {
    fs.writeFileSync(CACHE_PATH, JSON.stringify(store, null, 2));
  } catch {
    // non-fatal
  }
}

export function cacheGet<T>(key: string): T | null {
  const store = load();
  const entry = store[key] as CacheEntry<T> | undefined;
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    delete store[key];
    save(store);
    return null;
  }
  return entry.data;
}

export function cacheSet<T>(key: string, data: T, ttlMs: number = TTL_MS): void {
  const store = load();
  store[key] = { data, expiresAt: Date.now() + ttlMs };
  save(store);
}
