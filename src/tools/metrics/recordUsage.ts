import { metricsTracker } from '../../services/metrics.js';

export async function metricsRecordLlmUsage(args: {
  stage: string;
  model?: string;
  inputTokens: number;
  outputTokens: number;
  note?: string;
}) {
  if (!args.stage) throw new Error('stage is required');
  if (typeof args.inputTokens !== 'number' || typeof args.outputTokens !== 'number') {
    throw new Error('inputTokens and outputTokens must be numbers');
  }
  metricsTracker.recordExternalUsage(args.stage, args.model, args.inputTokens, args.outputTokens, args.note);
  return { recorded: true, stage: args.stage, model: args.model, totalTokens: args.inputTokens + args.outputTokens };
}
