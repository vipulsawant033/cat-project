import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger.js';
import { projectPath } from '../utils/paths.js';

const LOG_PATH = process.env.METRICS_LOG_PATH ? path.resolve(process.env.METRICS_LOG_PATH) : projectPath('data', 'metrics-log.json');
const MAX_LOG_ENTRIES = 5000;

interface ToolAggregate {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  durationMs: number;
}

interface LogEntry {
  timestamp: string;
  tool: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  durationMs: number;
  model?: string;
  note?: string;
}

function emptyAggregate(): ToolAggregate {
  return { calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, durationMs: 0 };
}

function addToAggregate(agg: ToolAggregate, inputTokens: number, outputTokens: number, durationMs: number): void {
  agg.calls += 1;
  agg.inputTokens += inputTokens;
  agg.outputTokens += outputTokens;
  agg.totalTokens += inputTokens + outputTokens;
  agg.durationMs += durationMs;
}

export interface SessionSummary {
  scope: 'session';
  sessionStartedAt: string;
  generatedAt: string;
  estimateNote: string;
  totals: ToolAggregate;
  byTool: Array<{ tool: string } & ToolAggregate>;
  reportedByStage: Array<{ stage: string; models: string[] } & ToolAggregate>;
}

export interface AllTimeSummary {
  scope: 'all';
  generatedAt: string;
  entryCount: number;
  totals: ToolAggregate;
  byTool: Array<{ tool: string } & ToolAggregate>;
}

class MetricsTracker {
  private sessionStartedAt = new Date().toISOString();
  private byTool = new Map<string, ToolAggregate>();
  private externalByStage = new Map<string, ToolAggregate & { models: Set<string> }>();

  recordToolCall(tool: string, inputTokens: number, outputTokens: number, durationMs: number): void {
    const agg = this.byTool.get(tool) ?? emptyAggregate();
    addToAggregate(agg, inputTokens, outputTokens, durationMs);
    this.byTool.set(tool, agg);
    this.appendToLog({
      timestamp: new Date().toISOString(),
      tool, inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, durationMs,
    });
  }

  recordExternalUsage(stage: string, model: string | undefined, inputTokens: number, outputTokens: number, note?: string): void {
    const key = model ? `${stage}::${model}` : stage;
    const agg = this.externalByStage.get(key) ?? { ...emptyAggregate(), models: new Set<string>() };
    addToAggregate(agg, inputTokens, outputTokens, 0);
    if (model) agg.models.add(model);
    this.externalByStage.set(key, agg);
    this.appendToLog({
      timestamp: new Date().toISOString(),
      tool: `external:${stage}`, model, note, durationMs: 0,
      inputTokens, outputTokens, totalTokens: inputTokens + outputTokens,
    });
  }

  getSessionSummary(): SessionSummary {
    const byTool = Array.from(this.byTool.entries())
      .map(([tool, agg]) => ({ tool, ...agg }))
      .sort((a, b) => b.totalTokens - a.totalTokens);
    const reportedByStage = Array.from(this.externalByStage.entries()).map(([, agg]) => {
      const { models, ...rest } = agg;
      return { stage: [...models].join(',') || 'unspecified', models: Array.from(models), ...rest };
    });
    // totals combines tool-call estimates with exactly-reported external usage, since
    // both are ultimately measuring the same thing: tokens spent generating this screen.
    const totals = [...byTool, ...reportedByStage].reduce((acc, t) => {
      addToAggregate(acc, t.inputTokens, t.outputTokens, t.durationMs);
      return acc;
    }, emptyAggregate());

    return {
      scope: 'session',
      sessionStartedAt: this.sessionStartedAt,
      generatedAt: new Date().toISOString(),
      estimateNote: 'byTool figures are approximations based on serialized JSON payload size (~4 chars/token), not an exact per-model tokenizer count. reportedByStage reflects exact numbers self-reported via metrics_record_llm_usage.',
      totals,
      byTool,
      reportedByStage,
    };
  }

  getAllTimeSummary(): AllTimeSummary {
    const entries = this.readLog();
    const byTool = new Map<string, ToolAggregate>();
    for (const e of entries) {
      const agg = byTool.get(e.tool) ?? emptyAggregate();
      addToAggregate(agg, e.inputTokens, e.outputTokens, e.durationMs);
      byTool.set(e.tool, agg);
    }
    const list = Array.from(byTool.entries())
      .map(([tool, agg]) => ({ tool, ...agg }))
      .sort((a, b) => b.totalTokens - a.totalTokens);
    const totals = list.reduce((acc, t) => {
      addToAggregate(acc, t.inputTokens, t.outputTokens, t.durationMs);
      return acc;
    }, emptyAggregate());
    return { scope: 'all', generatedAt: new Date().toISOString(), entryCount: entries.length, totals, byTool: list };
  }

  reset(): void {
    this.byTool.clear();
    this.externalByStage.clear();
    this.sessionStartedAt = new Date().toISOString();
  }

  private appendToLog(entry: LogEntry): void {
    try {
      const entries = this.readLog();
      entries.push(entry);
      const trimmed = entries.length > MAX_LOG_ENTRIES ? entries.slice(entries.length - MAX_LOG_ENTRIES) : entries;
      fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
      fs.writeFileSync(LOG_PATH, JSON.stringify(trimmed, null, 2));
    } catch (err) {
      logger.warn('metrics: failed to persist log', { error: String(err) });
    }
  }

  private readLog(): LogEntry[] {
    try {
      if (!fs.existsSync(LOG_PATH)) return [];
      return JSON.parse(fs.readFileSync(LOG_PATH, 'utf-8')) as LogEntry[];
    } catch {
      return [];
    }
  }
}

export const metricsTracker = new MetricsTracker();
