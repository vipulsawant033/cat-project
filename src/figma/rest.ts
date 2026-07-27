/**
 * Thin Figma REST client. Read-only paths used by the F->A direction:
 *   - GET /v1/files/:key/nodes?ids=  -> raw node subtree (geometry + layout + style)
 *   - GET /v1/images/:key?ids=       -> rendered PNG url (ground truth for codegen_validate)
 *   - GET /v1/files/:key/variables/local -> Figma Variables (Enterprise)
 *
 * Node creation is NOT possible via REST — the A->F write path goes through the
 * Figma plugin bridge instead (see src/bridge).
 */

const FIGMA_API = "https://api.figma.com";

export interface FigmaRestOptions {
  /** personal access token or OAuth token; defaults to env FIGMA_TOKEN */
  token?: string;
}

function authHeaders(opts: FigmaRestOptions): Record<string, string> {
  const token = opts.token ?? process.env.FIGMA_TOKEN;
  if (!token) {
    throw new Error(
      "Figma token required. Set env FIGMA_TOKEN or pass { token }. " +
        "Alternatively use the Figma Dev Mode MCP input path (no token needed)."
    );
  }
  return { "X-Figma-Token": token };
}

/** Raw Figma node — only the fields the normalizer reads. */
export interface FigmaNode {
  id: string;
  name: string;
  type: string; // FRAME, TEXT, RECTANGLE, INSTANCE, VECTOR, GROUP, ...
  visible?: boolean;
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number };
  // auto-layout
  layoutMode?: "NONE" | "HORIZONTAL" | "VERTICAL";
  itemSpacing?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  primaryAxisAlignItems?: "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN";
  counterAxisAlignItems?: "MIN" | "CENTER" | "MAX";
  layoutWrap?: "NO_WRAP" | "WRAP";
  layoutGrow?: number;
  layoutAlign?: "INHERIT" | "STRETCH";
  primaryAxisSizingMode?: "FIXED" | "AUTO";
  counterAxisSizingMode?: "FIXED" | "AUTO";
  // modern per-node sizing (authoritative when present)
  layoutSizingHorizontal?: "FIXED" | "HUG" | "FILL";
  layoutSizingVertical?: "FIXED" | "HUG" | "FILL";
  // component instance variant/props (Figma variants + component properties)
  componentProperties?: Record<string, { type: string; value: string | boolean }>;
  // style
  fills?: FigmaPaint[];
  strokes?: FigmaPaint[];
  strokeWeight?: number;
  /** per-edge stroke weights (Figma "independent stroke weight" mode); overrides strokeWeight when present */
  individualStrokeWeights?: { top: number; right: number; bottom: number; left: number };
  effects?: FigmaEffect[];
  cornerRadius?: number;
  rectangleCornerRadii?: [number, number, number, number];
  opacity?: number;
  // text
  characters?: string;
  style?: FigmaTypeStyle;
  // variable bindings: property -> variableId
  boundVariables?: Record<string, { id: string } | { id: string }[]>;
  children?: FigmaNode[];
}

export interface FigmaPaint {
  type: string; // SOLID, GRADIENT_LINEAR, ...
  visible?: boolean;
  opacity?: number;
  color?: { r: number; g: number; b: number; a?: number };
}

export interface FigmaEffect {
  type: string; // DROP_SHADOW, INNER_SHADOW, ...
  visible?: boolean;
  radius?: number;
  spread?: number;
  offset?: { x: number; y: number };
  color?: { r: number; g: number; b: number; a?: number };
}

export interface FigmaTypeStyle {
  fontFamily?: string;
  fontWeight?: number;
  fontSize?: number;
  lineHeightPx?: number;
  letterSpacing?: number;
  textAlignHorizontal?: "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";
}

/** Fetch a node subtree. Returns the first requested node. */
export async function getNode(
  fileKey: string,
  nodeId: string,
  opts: FigmaRestOptions = {}
): Promise<FigmaNode> {
  const url = `${FIGMA_API}/v1/files/${encodeURIComponent(fileKey)}/nodes?ids=${encodeURIComponent(nodeId)}`;
  const res = await fetch(url, { headers: authHeaders(opts) });
  if (!res.ok) throw new Error(`Figma nodes fetch failed: ${res.status} ${res.statusText}`);
  const json = (await res.json()) as { nodes: Record<string, { document: FigmaNode }> };
  const entry = json.nodes[nodeId] ?? Object.values(json.nodes)[0];
  if (!entry?.document) throw new Error(`Node ${nodeId} not found in file ${fileKey}`);
  return entry.document;
}

/** Get a rendered PNG url for a node — the ground-truth raster for codegen_validate. */
export async function getImageUrl(
  fileKey: string,
  nodeId: string,
  scale = 2,
  opts: FigmaRestOptions = {}
): Promise<string> {
  const url = `${FIGMA_API}/v1/images/${encodeURIComponent(fileKey)}?ids=${encodeURIComponent(
    nodeId
  )}&scale=${scale}&format=png`;
  const res = await fetch(url, { headers: authHeaders(opts) });
  if (!res.ok) throw new Error(`Figma image fetch failed: ${res.status} ${res.statusText}`);
  const json = (await res.json()) as { images: Record<string, string>; err?: string };
  if (json.err) throw new Error(`Figma image error: ${json.err}`);
  const image = json.images[nodeId] ?? Object.values(json.images)[0];
  if (!image) throw new Error(`No image rendered for node ${nodeId}`);
  return image;
}

/**
 * Batch-render nodes to image URLs. `format: "svg"` is what fixes vector/icon/logo
 * nodes — Figma returns crisp vector SVG for them. Available on any plan with a
 * token (unlike the Enterprise-only Variables endpoint).
 */
export async function getImageUrls(
  fileKey: string,
  nodeIds: string[],
  format: "svg" | "png" = "svg",
  scale = 2,
  opts: FigmaRestOptions = {}
): Promise<Record<string, string>> {
  if (nodeIds.length === 0) return {};
  const ids = nodeIds.map(encodeURIComponent).join(",");
  const scaleParam = format === "png" ? `&scale=${scale}` : "";
  const url = `${FIGMA_API}/v1/images/${encodeURIComponent(fileKey)}?ids=${ids}&format=${format}${scaleParam}`;
  const res = await fetch(url, { headers: authHeaders(opts) });
  if (!res.ok) throw new Error(`Figma image export failed: ${res.status} ${res.statusText}`);
  const json = (await res.json()) as { images: Record<string, string | null>; err?: string };
  if (json.err) throw new Error(`Figma image export error: ${json.err}`);
  const out: Record<string, string> = {};
  for (const [id, u] of Object.entries(json.images)) if (u) out[id] = u;
  return out;
}

/** Fetch the raw text of an exported SVG (Figma returns a signed URL, not inline). */
export async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Asset fetch failed: ${res.status}`);
  return res.text();
}

/** Local Variables (Enterprise). Returns id -> resolved value map (simplified). */
export async function getLocalVariables(
  fileKey: string,
  opts: FigmaRestOptions = {}
): Promise<Record<string, { name: string; value: string }>> {
  const url = `${FIGMA_API}/v1/files/${encodeURIComponent(fileKey)}/variables/local`;
  const res = await fetch(url, { headers: authHeaders(opts) });
  if (!res.ok) throw new Error(`Figma variables fetch failed: ${res.status} ${res.statusText}`);
  const json = (await res.json()) as {
    meta?: { variables?: Record<string, { name: string; resolvedType: string; valuesByMode: Record<string, unknown> }> };
  };
  const out: Record<string, { name: string; value: string }> = {};
  const vars = json.meta?.variables ?? {};
  for (const [id, v] of Object.entries(vars)) {
    const firstMode = Object.values(v.valuesByMode)[0];
    out[id] = { name: v.name, value: stringifyVariableValue(firstMode) };
  }
  return out;
}

function stringifyVariableValue(v: unknown): string {
  if (v && typeof v === "object" && "r" in (v as Record<string, unknown>)) {
    const c = v as { r: number; g: number; b: number; a?: number };
    return rgbaToCss(c.r, c.g, c.b, c.a ?? 1);
  }
  return String(v);
}

export function rgbaToCss(r: number, g: number, b: number, a = 1): string {
  const to255 = (n: number) => Math.round(n * 255);
  if (a >= 1) {
    const hex = (n: number) => to255(n).toString(16).padStart(2, "0");
    return `#${hex(r)}${hex(g)}${hex(b)}`;
  }
  return `rgba(${to255(r)}, ${to255(g)}, ${to255(b)}, ${Number(a.toFixed(3))})`;
}
