/**
 * Token-accounting layer. Every tool call records a usage entry into the SHARED
 * store; LLM-touching steps report real token counts (agent-reported exact usage
 * or the model response's own usage field), deterministic steps report zero.
 * metrics_report aggregates per-screen and per-tool/stage over either this
 * session (this run) or the whole persisted history (both servers).
 */

import { MetricsStore, type UsageRecord } from "./store.js";
import { estimateCost } from "./pricing.js";

export type { UsageRecord } from "./store.js";
export { estimateCost } from "./pricing.js";

export class MetricsCollector {
  constructor(
    private runId: string,
    private readonly store: MetricsStore = new MetricsStore(),
    private readonly server = "figma-angular-sync"
  ) {}

  /** Current session id (changes on reset). */
  get session(): string {
    return this.runId;
  }

  /** Path of the shared store, for reporting/diagnostics. */
  get storePath(): string {
    return this.store.path;
  }

  record(entry: {
    screen: string;
    tool: string;
    stage: string;
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    ms: number;
    note?: string;
    costEstimate?: number;
  }): void {
    const costEstimate = entry.costEstimate ?? estimateCost(entry.model, entry.inputTokens, entry.outputTokens);
    const full: UsageRecord = {
      ts: Date.now(),
      runId: this.runId,
      server: this.server,
      costEstimate,
      screen: entry.screen,
      tool: entry.tool,
      stage: entry.stage,
      provider: entry.provider,
      model: entry.model,
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      ms: entry.ms,
      note: entry.note,
    };
    this.store.append(full);
  }

  /** Records for this session (this run only). */
  sessionRecords(): UsageRecord[] {
    return this.store.readAll().filter((r) => r.runId === this.runId);
  }

  /** Every record in the shared store — across both servers and all runs. */
  allRecords(): UsageRecord[] {
    return this.store.readAll();
  }

  /** Start a fresh session so the next report's "session" scope excludes prior work. */
  reset(newRunId: string): void {
    this.runId = newRunId;
  }
}

export interface MetricsReport {
  scope: "session" | "all";
  storePath: string;
  perScreen: Array<{ screen: string; inputTokens: number; outputTokens: number; cost: number; overBudget: boolean }>;
  perStage: Array<{ screen: string; stage: string; tool: string; server: string; model: string; inputTokens: number; outputTokens: number; cost: number }>;
  total: { screens: number; inputTokens: number; outputTokens: number; cost: number };
  table: string;
}

export function buildReport(
  records: UsageRecord[],
  scope: "session" | "all",
  storePath: string,
  budgetPerScreen = Infinity
): MetricsReport {
  const perStage = records.map((r) => ({
    screen: r.screen,
    stage: r.stage,
    tool: r.tool,
    server: r.server,
    model: r.model,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    cost: r.costEstimate,
  }));

  const screenMap = new Map<string, { inputTokens: number; outputTokens: number; cost: number }>();
  for (const r of records) {
    const acc = screenMap.get(r.screen) ?? { inputTokens: 0, outputTokens: 0, cost: 0 };
    acc.inputTokens += r.inputTokens;
    acc.outputTokens += r.outputTokens;
    acc.cost += r.costEstimate;
    screenMap.set(r.screen, acc);
  }
  const perScreen = [...screenMap.entries()].map(([screen, v]) => ({
    screen,
    inputTokens: v.inputTokens,
    outputTokens: v.outputTokens,
    cost: Number(v.cost.toFixed(4)),
    overBudget: v.cost > budgetPerScreen,
  }));

  const total = {
    screens: screenMap.size,
    inputTokens: records.reduce((s, r) => s + r.inputTokens, 0),
    outputTokens: records.reduce((s, r) => s + r.outputTokens, 0),
    cost: Number(records.reduce((s, r) => s + r.costEstimate, 0).toFixed(4)),
  };

  return { scope, storePath, perScreen, perStage, total, table: renderTable(perStage, total, scope) };
}

function renderTable(
  perStage: MetricsReport["perStage"],
  total: MetricsReport["total"],
  scope: "session" | "all"
): string {
  const header = ["Screen", "Stage/Tool", "Server", "Model", "In", "Out", "Cost"];
  const rows = perStage.map((r) => [
    r.screen,
    `${r.stage}${r.tool && r.tool !== r.stage ? ` (${r.tool})` : ""}`,
    r.server,
    r.model,
    r.inputTokens.toLocaleString(),
    r.outputTokens.toLocaleString(),
    `$${r.cost.toFixed(2)}`,
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...(rows.length ? rows.map((row) => row[i].length) : [0])));
  const fmt = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join("  ");
  const lines = [fmt(header), widths.map((w) => "-".repeat(w)).join("  "), ...rows.map(fmt)];
  lines.push(
    `── ${scope} total: ${total.screens} screens · ${total.inputTokens.toLocaleString()} in · ${total.outputTokens.toLocaleString()} out · $${total.cost.toFixed(2)} ──`
  );
  return lines.join("\n");
}
