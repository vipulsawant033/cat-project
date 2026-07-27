/**
 * Adapters for the OFFICIAL Figma Dev Mode MCP outputs. MCP servers can't call
 * each other — the host agent calls the Dev Mode MCP, then passes its results to
 * these ingest adapters (Model A: host-orchestrated combining).
 *
 * The Dev Mode MCP does NOT expose a raw node tree, so geometry/layout still
 * comes from REST (normalizeRest). What the Dev Mode MCP gives us cleanly, and
 * what we layer on top of the REST-derived IR, is:
 *   - get_variable_defs   -> design tokens (works on ANY plan; no Enterprise REST)
 *   - get_code_connect_map -> deterministic node -> real code component mappings
 *   - get_image            -> ground-truth raster for codegen_validate
 */

/** get_variable_defs is returned as { "Collection/Name": value } or an array of {name,value}. */
export type VariableDefs = Record<string, string | number> | Array<{ name: string; value: string | number }>;

/** Normalize either shape into the {name,value} map tokensToCss expects. */
export function variableDefsToTokenInput(
  defs: VariableDefs
): Record<string, { name: string; value: string }> {
  const out: Record<string, { name: string; value: string }> = {};
  if (Array.isArray(defs)) {
    for (const d of defs) out[d.name] = { name: d.name, value: String(d.value) };
  } else {
    for (const [name, value] of Object.entries(defs)) out[name] = { name, value: String(value) };
  }
  return out;
}

/**
 * get_code_connect_map is roughly { "<nodeId>": { codeConnectName?, codeConnectSrc?, component? } }.
 * We accept a loose shape and produce nodeId -> { target, props } so lib_search_component
 * can resolve reuse deterministically (confidence 1.0, no model call).
 */
export type CodeConnectMap = Record<
  string,
  { codeConnectName?: string; component?: string; codeConnectSrc?: string; props?: Record<string, string> }
>;

export function parseCodeConnectMap(
  map: CodeConnectMap
): Record<string, { target: string; props?: Record<string, string> }> {
  const out: Record<string, { target: string; props?: Record<string, string> }> = {};
  for (const [nodeId, entry] of Object.entries(map)) {
    const name = entry.component ?? entry.codeConnectName;
    if (!name) continue;
    // "Button" -> "app-button"; already-kebab selectors pass through.
    const target = name.startsWith("app-")
      ? name
      : "app-" +
        name
          .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
          .replace(/\s+/g, "-")
          .toLowerCase();
    out[nodeId] = { target, props: entry.props };
  }
  return out;
}

/** Decode a data URL or bare base64 string into a PNG buffer for validation. */
export function imageBase64ToBuffer(b64: string): Buffer {
  const comma = b64.indexOf(",");
  const raw = b64.startsWith("data:") && comma >= 0 ? b64.slice(comma + 1) : b64;
  return Buffer.from(raw, "base64");
}
