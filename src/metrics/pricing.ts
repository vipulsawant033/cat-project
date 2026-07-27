/**
 * Model price table — the single authority for turning tokens into dollars.
 * Exact cost = tokens x model rate, applied identically to deterministic stages
 * (0 tokens -> $0) and to agent-reported usage from metrics_record_llm_usage.
 *
 * Override/extend without a rebuild via:
 *   FIGMA_MODEL_PRICES        = '{"gpt-5":{"in":1.25,"out":10}}'   (inline JSON)
 *   FIGMA_MODEL_PRICES_FILE   = path to a JSON file of the same shape
 * Values are USD per 1,000,000 tokens.
 */

import { readFileSync } from "node:fs";

export type PriceTable = Record<string, { in: number; out: number }>;

const DEFAULT_PRICES: PriceTable = {
  // Anthropic
  "claude-opus-4-8": { in: 15, out: 75 },
  "claude-sonnet-5": { in: 3, out: 15 },
  "claude-haiku-4-5": { in: 0.8, out: 4 },
  // OpenAI
  "gpt-5": { in: 1.25, out: 10 },
  "gpt-4o": { in: 2.5, out: 10 },
  "gpt-4o-mini": { in: 0.15, out: 0.6 },
  // unknown host model (MCP sampling that doesn't report an id) -> $0, still counted in tokens
  "host/unknown": { in: 0, out: 0 },
};

let cachedTable: PriceTable | null = null;

function loadOverrides(): PriceTable {
  const out: PriceTable = {};
  try {
    if (process.env.FIGMA_MODEL_PRICES) Object.assign(out, JSON.parse(process.env.FIGMA_MODEL_PRICES));
    if (process.env.FIGMA_MODEL_PRICES_FILE) {
      Object.assign(out, JSON.parse(readFileSync(process.env.FIGMA_MODEL_PRICES_FILE, "utf8")));
    }
  } catch (e) {
    console.error(`[pricing] failed to load price overrides: ${String(e)}`);
  }
  return out;
}

export function priceTable(): PriceTable {
  if (!cachedTable) cachedTable = { ...DEFAULT_PRICES, ...loadOverrides() };
  return cachedTable;
}

/** Normalize a model id so "host/gpt-4o", "gpt-4o", "GPT-4O" all resolve. */
function lookup(model: string): { in: number; out: number } {
  const table = priceTable();
  const raw = (model || "").trim();
  const stripped = raw.replace(/^host\//, "");
  return (
    table[raw] ??
    table[stripped] ??
    table[raw.toLowerCase()] ??
    table[stripped.toLowerCase()] ??
    table["host/unknown"] ?? { in: 0, out: 0 }
  );
}

export function estimateCost(model: string, inTok: number, outTok: number): number {
  const rate = lookup(model);
  return Number(((inTok / 1e6) * rate.in + (outTok / 1e6) * rate.out).toFixed(4));
}
