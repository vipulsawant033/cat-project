export const MAX_RESPONSE_CHARS = parseInt(process.env.MCP_MAX_RESPONSE_CHARS || '50000', 10);

export interface SizeCheckResult {
  chars: number;
  exceeds: boolean;
}

export function measureSerialized(payload: unknown): SizeCheckResult {
  const chars = JSON.stringify(payload).length;
  return { chars, exceeds: chars > MAX_RESPONSE_CHARS };
}
