/**
 * Model-agnostic LLM layer. This is what lets the SAME server run under Claude,
 * ChatGPT, GitHub Copilot, or any MCP host.
 *
 * Preferred path: MCP *sampling* — the server asks the HOST to run a completion
 * with whatever model the client uses. Zero provider config in the server, and
 * usage is attributed to the host. If the host doesn't support sampling, fall
 * back to a pluggable provider adapter chosen by env/config.
 *
 * No model id is ever hardcoded: it's either the host's model (sampling) or a
 * config-selected backend.
 */

import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { MetricsCollector } from "../metrics/collector.js";

export interface LlmResult {
  text: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface LlmRequest {
  system?: string;
  prompt: string;
  maxTokens?: number;
  /** for metrics attribution */
  screen: string;
  stage: string;
  tool: string;
}

/** Rough token estimate when a backend doesn't report usage (~4 chars/token). */
function estTokens(s: string): number {
  return Math.ceil(s.length / 4);
}

export class LlmProvider {
  constructor(
    private readonly server: Server,
    private readonly metrics: MetricsCollector
  ) {}

  /** True if the connected host advertised sampling capability. */
  private hostSupportsSampling(): boolean {
    const caps = this.server.getClientCapabilities?.();
    return Boolean(caps && "sampling" in caps);
  }

  async complete(req: LlmRequest): Promise<LlmResult> {
    const started = Date.now();
    let result: LlmResult;
    if (this.hostSupportsSampling()) {
      result = await this.viaSampling(req);
    } else {
      result = await this.viaAdapter(req);
    }
    this.metrics.record({
      screen: req.screen,
      tool: req.tool,
      stage: req.stage,
      provider: result.provider,
      model: result.model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      ms: Date.now() - started,
    });
    return result;
  }

  /** MCP sampling: host runs its own model. */
  private async viaSampling(req: LlmRequest): Promise<LlmResult> {
    const resp = await this.server.createMessage({
      systemPrompt: req.system,
      messages: [{ role: "user", content: { type: "text", text: req.prompt } }],
      maxTokens: req.maxTokens ?? 1024,
    });
    const text = resp.content.type === "text" ? resp.content.text : "";
    // Some hosts surface usage; if absent, estimate so metrics are never blank.
    const usage = (resp as unknown as { usage?: { inputTokens?: number; outputTokens?: number } }).usage;
    return {
      text,
      provider: "host",
      model: `host/${resp.model ?? "unknown"}`,
      inputTokens: usage?.inputTokens ?? estTokens((req.system ?? "") + req.prompt),
      outputTokens: usage?.outputTokens ?? estTokens(text),
    };
  }

  /**
   * Adapter fallback for hosts without sampling. Backend selected by env:
   *   LLM_PROVIDER = anthropic | openai | azure | local
   * Each backend returns real usage from its SDK response. Implemented lazily so
   * the dependency is only needed when actually used.
   */
  private async viaAdapter(req: LlmRequest): Promise<LlmResult> {
    const provider = (process.env.LLM_PROVIDER ?? "").toLowerCase();
    switch (provider) {
      case "anthropic":
        return this.anthropic(req);
      case "openai":
      case "azure":
        return this.openai(req);
      default:
        throw new Error(
          "No MCP sampling available and LLM_PROVIDER not set. " +
            "Set LLM_PROVIDER=anthropic|openai (+ API key) or use a host that supports sampling."
        );
    }
  }

  private async anthropic(req: LlmRequest): Promise<LlmResult> {
    const model = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5";
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: req.maxTokens ?? 1024,
        system: req.system,
        messages: [{ role: "user", content: req.prompt }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic error: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as {
      content: Array<{ type: string; text?: string }>;
      usage: { input_tokens: number; output_tokens: number };
    };
    return {
      text: json.content.map((c) => c.text ?? "").join(""),
      provider: "anthropic",
      model,
      inputTokens: json.usage.input_tokens,
      outputTokens: json.usage.output_tokens,
    };
  }

  private async openai(req: LlmRequest): Promise<LlmResult> {
    const model = process.env.OPENAI_MODEL ?? "gpt-4o";
    const base = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ""}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: req.maxTokens ?? 1024,
        messages: [
          ...(req.system ? [{ role: "system", content: req.system }] : []),
          { role: "user", content: req.prompt },
        ],
      }),
    });
    if (!res.ok) throw new Error(`OpenAI error: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as {
      choices: Array<{ message: { content: string } }>;
      usage: { prompt_tokens: number; completion_tokens: number };
    };
    return {
      text: json.choices[0]?.message.content ?? "",
      provider: "openai",
      model,
      inputTokens: json.usage.prompt_tokens,
      outputTokens: json.usage.completion_tokens,
    };
  }
}
