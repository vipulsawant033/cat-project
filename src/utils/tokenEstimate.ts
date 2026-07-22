// Every LLM provider (Claude, GPT, Gemini, ...) tokenizes differently, so no single count
// is exact across all of them. This uses the ~4-chars-per-token rule of thumb as a
// consistent, dependency-free approximation that works regardless of which model/client
// is on the other end of the MCP connection.
export function estimateTokens(value: unknown): number {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}
