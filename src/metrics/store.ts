/**
 * Shared, file-backed metrics store — the single source of truth for token usage
 * across BOTH servers. Path defaults to ./data/metrics-log.json (matching the
 * figma-angular server's location) and is overridable via FIGMA_METRICS_STORE, so
 * both servers can be pointed at the exact same file. Route all LLM logging
 * through one server's metrics_record_llm_usage and metrics_report scope:"all"
 * becomes a true combined total instead of two reports added by hand.
 *
 * Stored as a JSON array. The reader is tolerant: any record carrying token
 * counts is aggregated, with missing fields defaulted, so entries written by the
 * other server (or older runs) still merge.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { estimateCost } from "./pricing.js";

export interface UsageRecord {
  ts: number;
  runId: string;
  server: string;
  screen: string;
  tool: string;
  stage: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costEstimate: number;
  ms: number;
  note?: string;
}

/**
 * Server install root, derived from this module's location (dist/metrics/store.js
 * -> up two dirs). Using the module dir instead of process.cwd() is critical: MCP
 * hosts often spawn the server with cwd = C:\WINDOWS\system32, so a cwd-relative
 * path would read/write a nonexistent (and unwritable) store — record succeeds
 * but report reads a different file and stays empty (#5).
 */
function serverRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

/**
 * Resolve the shared store path. Precedence:
 *   1. METRICS_STORE / FIGMA_METRICS_STORE (absolute) — point BOTH servers here
 *      for one unified total (#6).
 *   2. <server-install>/data/metrics-log.json
 */
export function defaultStorePath(): string {
  const env = process.env.METRICS_STORE ?? process.env.FIGMA_METRICS_STORE;
  if (env) return resolve(env);
  return join(serverRoot(), "data", "metrics-log.json");
}

export class MetricsStore {
  constructor(public readonly path: string = defaultStorePath()) {}

  private readRaw(): unknown[] {
    try {
      const parsed = JSON.parse(readFileSync(this.path, "utf8"));
      if (Array.isArray(parsed)) return parsed;
      // tolerate { records: [...] } or a single object
      if (parsed && Array.isArray((parsed as { records?: unknown[] }).records)) {
        return (parsed as { records: unknown[] }).records;
      }
      return [parsed];
    } catch {
      return []; // missing/unreadable/corrupt -> empty history
    }
  }

  /** Normalize any stored entry into a UsageRecord; return null if it has no token data. */
  private normalize(raw: unknown): UsageRecord | null {
    if (!raw || typeof raw !== "object") return null;
    const r = raw as Record<string, unknown>;
    const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
    const str = (v: unknown, d = "") => (typeof v === "string" ? v : d);
    const inputTokens = num(r.inputTokens);
    const outputTokens = num(r.outputTokens);
    // an entry with neither token count nor a stage is not usage data
    if (inputTokens === 0 && outputTokens === 0 && !r.stage && !r.tool) return null;
    const model = str(r.model, "-");
    // Recompute cost from the shared price table when the record didn't carry one
    // (foreign records from the other server, or older entries). This is what
    // makes cross-server totals correct instead of undercounting.
    const costEstimate =
      typeof r.costEstimate === "number" ? r.costEstimate : estimateCost(model, inputTokens, outputTokens);
    return {
      ts: num(r.ts),
      runId: str(r.runId, "unknown"),
      server: str(r.server, "unknown"),
      screen: str(r.screen, "-"),
      tool: str(r.tool, str(r.stage)),
      stage: str(r.stage, str(r.tool)),
      provider: str(r.provider, "unknown"),
      model,
      inputTokens,
      outputTokens,
      costEstimate,
      ms: num(r.ms),
      note: typeof r.note === "string" ? r.note : undefined,
    };
  }

  readAll(): UsageRecord[] {
    return this.readRaw()
      .map((r) => this.normalize(r))
      .filter((r): r is UsageRecord => r !== null);
  }

  append(record: UsageRecord): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      const all = this.readRaw();
      all.push(record);
      writeFileSync(this.path, JSON.stringify(all, null, 2));
    } catch (e) {
      console.error(`[metrics] failed to persist usage record: ${String(e)}`);
    }
  }
}
