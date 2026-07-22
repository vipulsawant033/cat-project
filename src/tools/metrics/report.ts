import { metricsTracker, SessionSummary, AllTimeSummary } from '../../services/metrics.js';

export async function metricsReport(args: { scope: 'all'; reset?: boolean }): Promise<AllTimeSummary>;
export async function metricsReport(args?: { scope?: 'session'; reset?: boolean }): Promise<SessionSummary>;
export async function metricsReport(args: { scope?: 'session' | 'all'; reset?: boolean } = {}): Promise<SessionSummary | AllTimeSummary> {
  const scope = args.scope ?? 'session';
  const result = scope === 'all' ? metricsTracker.getAllTimeSummary() : metricsTracker.getSessionSummary();
  if (args.reset) metricsTracker.reset();
  return result;
}
