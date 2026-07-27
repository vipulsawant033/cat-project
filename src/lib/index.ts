/**
 * Component-library indexing + reuse matching. A Figma node that corresponds to
 * an existing Angular/Lit atom (e.g. a Button) should render as that component,
 * not fresh markup. The deterministic layer narrows candidates by name/shape;
 * the LLM layer (via LlmProvider) makes the final semantic call + prop mapping.
 */

import type { IRNode } from "../ir/schema.js";
import type { LlmProvider } from "../llm/provider.js";

export interface LibComponent {
  /** Angular selector, e.g. "app-button" */
  selector: string;
  /** display name, e.g. "Button" */
  name: string;
  /** input names the component accepts, e.g. ["variant", "label", "disabled"] */
  inputs: string[];
  /** keywords for cheap pre-filtering */
  keywords: string[];
}

export class ComponentIndex {
  private components: LibComponent[] = [];
  /** nodeId -> component, seeded from the official Dev Mode MCP get_code_connect_map. */
  private nodeMappings: Record<string, { target: string; props?: Record<string, string> }> = {};

  /** Register indexed components (from lib_index_components tool). */
  set(components: LibComponent[]): void {
    this.components = components;
  }

  /** Seed authoritative node->component mappings from get_code_connect_map. */
  setNodeMappings(map: Record<string, { target: string; props?: Record<string, string> }>): void {
    this.nodeMappings = { ...this.nodeMappings, ...map };
  }

  list(): LibComponent[] {
    return this.components;
  }

  /** Cheap deterministic pre-filter: name/keyword overlap. */
  private candidates(node: IRNode): LibComponent[] {
    const hay = `${node.name}`.toLowerCase();
    return this.components
      .map((c) => {
        const score =
          (hay.includes(c.name.toLowerCase()) ? 2 : 0) +
          c.keywords.reduce((s, k) => s + (hay.includes(k.toLowerCase()) ? 1 : 0), 0);
        return { c, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((x) => x.c);
  }

  /**
   * Match a node to an existing component. Returns a componentMatch or null.
   * Deterministic when there is exactly one obvious candidate; otherwise asks
   * the host model (via sampling) to disambiguate and infer props.
   */
  async match(
    node: IRNode,
    llm: LlmProvider | null,
    ctx: { screen: string }
  ): Promise<IRNode["componentMatch"] | null> {
    const raw = await this.matchInner(node, llm, ctx);
    if (!raw) return null;
    // Figma variant/component properties are authoritative — overlay them on top
    // of inferred/heuristic props so reused components get real [variant]/[state].
    return { ...raw, props: { ...(raw.props ?? {}), ...(node.figmaProps ?? {}) } };
  }

  private async matchInner(
    node: IRNode,
    llm: LlmProvider | null,
    ctx: { screen: string }
  ): Promise<IRNode["componentMatch"] | null> {
    // Authoritative: the official Code Connect map ties this exact node to a real
    // component. Deterministic, confidence 1.0, no model call.
    const mapped = this.nodeMappings[node.id];
    if (mapped) {
      return { target: mapped.target, confidence: 1, props: mapped.props ?? {} };
    }

    const cands = this.candidates(node);
    if (cands.length === 0) return null;

    // High-confidence deterministic shortcut: single exact-name candidate.
    if (cands.length === 1 && node.name.toLowerCase().includes(cands[0].name.toLowerCase())) {
      return {
        target: cands[0].selector,
        confidence: 0.9,
        props: inferPropsDeterministic(node, cands[0]),
      };
    }

    if (!llm) {
      // No model available — take the top candidate at reduced confidence.
      return { target: cands[0].selector, confidence: 0.5, props: inferPropsDeterministic(node, cands[0]) };
    }

    const system =
      "You map a UI node to the best-fitting existing component. Reply with strict JSON: " +
      `{"selector": string|null, "confidence": number, "props": object}. ` +
      "selector must be one of the candidates or null if none fit.";
    const prompt = JSON.stringify({
      node: { name: node.name, kind: node.kind, text: node.text ?? null },
      candidates: cands.map((c) => ({ selector: c.selector, name: c.name, inputs: c.inputs })),
    });
    const res = await llm.complete({
      system,
      prompt,
      maxTokens: 300,
      screen: ctx.screen,
      stage: "reuse-match",
      tool: "lib_search_component",
    });
    try {
      const parsed = JSON.parse(extractJson(res.text)) as {
        selector: string | null;
        confidence: number;
        props?: Record<string, string>;
      };
      if (!parsed.selector) return null;
      return { target: parsed.selector, confidence: parsed.confidence ?? 0.6, props: parsed.props ?? {} };
    } catch {
      return { target: cands[0].selector, confidence: 0.4, props: inferPropsDeterministic(node, cands[0]) };
    }
  }
}

/** Best-effort prop inference without a model (label from text, etc.). */
function inferPropsDeterministic(node: IRNode, comp: LibComponent): Record<string, string> {
  const props: Record<string, string> = {};
  if (comp.inputs.includes("label") && node.text) props.label = node.text;
  const nameLower = node.name.toLowerCase();
  if (comp.inputs.includes("variant")) {
    if (nameLower.includes("primary")) props.variant = "primary";
    else if (nameLower.includes("secondary")) props.variant = "secondary";
  }
  return props;
}

function extractJson(s: string): string {
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  return start >= 0 && end > start ? s.slice(start, end + 1) : s;
}
