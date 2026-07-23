import type {
  FigmaFileResponse,
  FigmaImagesResponse,
  FigmaLinkRef,
  FigmaNode,
  FigmaNodesResponse,
  FigmaVariablesResponse,
} from './types.js';

const FIGMA_API_BASE = 'https://api.figma.com/v1';

export class FigmaApiError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = 'FigmaApiError';
  }
}

/**
 * Parses a Figma URL of either form:
 *   https://www.figma.com/file/<fileKey>/<title>?node-id=<nodeId>
 *   https://www.figma.com/design/<fileKey>/<title>?node-id=<nodeId>
 * Figma encodes node-id in the URL with "-" instead of ":" (e.g. 12-34 -> 12:34).
 */
export function parseFigmaUrl(link: string): FigmaLinkRef {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    throw new FigmaApiError(`Not a valid URL: "${link}"`);
  }

  const match = url.pathname.match(/\/(file|design|proto)\/([a-zA-Z0-9]+)/);
  if (!match) {
    throw new FigmaApiError(
      `Could not find a file key in the Figma link. Expected a path like /file/<key>/... or /design/<key>/...`
    );
  }
  const fileKey = match[2];

  const rawNodeId = url.searchParams.get('node-id');
  const nodeId = rawNodeId ? rawNodeId.replace(/-/g, ':') : undefined;

  return { fileKey, nodeId };
}

export interface FigmaClientOptions {
  /** Personal access token. Defaults to process.env.FIGMA_TOKEN. */
  token?: string;
}

export class FigmaClient {
  private readonly token: string | undefined;

  constructor(options: FigmaClientOptions = {}) {
    this.token = options.token ?? process.env.FIGMA_TOKEN;
  }

  private assertToken(): string {
    if (!this.token) {
      throw new FigmaApiError(
        'No Figma token configured. Set FIGMA_TOKEN in your environment (see .env.example).'
      );
    }
    return this.token;
  }

  private async request<T>(path: string): Promise<T> {
    const token = this.assertToken();
    const res = await fetch(`${FIGMA_API_BASE}${path}`, {
      headers: { 'X-Figma-Token': token },
    });
    if (!res.ok) {
      throw new FigmaApiError(`Figma API request failed: ${res.status} ${res.statusText}`, res.status);
    }
    return (await res.json()) as T;
  }

  /** Fetches the full document tree for a file. */
  async getFile(fileKey: string): Promise<FigmaFileResponse> {
    return this.request<FigmaFileResponse>(`/files/${fileKey}`);
  }

  /** Fetches one or more specific nodes (e.g. the single component the link points at). */
  async getNodes(fileKey: string, nodeIds: string[]): Promise<FigmaNodesResponse> {
    const ids = encodeURIComponent(nodeIds.join(','));
    return this.request<FigmaNodesResponse>(`/files/${fileKey}/nodes?ids=${ids}`);
  }

  /**
   * Calls Figma's image render/export API and returns a signed URL per node id.
   * Nodes with no renderable output (or a failed render) simply have a null/missing entry.
   */
  async renderImageUrls(
    fileKey: string,
    nodeIds: string[],
    format: 'svg' | 'png',
    scale = 1
  ): Promise<Record<string, string | null>> {
    if (nodeIds.length === 0) return {};
    const ids = encodeURIComponent(nodeIds.join(','));
    const { images } = await this.request<FigmaImagesResponse>(
      `/images/${fileKey}?ids=${ids}&format=${format}${format === 'png' ? `&scale=${scale}` : ''}`
    );
    return images;
  }

  /**
   * Renders the given nodes to SVG via Figma's image export API and fetches
   * the actual markup for each, keyed by node id. Nodes with no renderable
   * output (or a failed render) are simply omitted from the result.
   */
  async exportSvgs(fileKey: string, nodeIds: string[]): Promise<Record<string, string>> {
    const images = await this.renderImageUrls(fileKey, nodeIds, 'svg');
    const svgByNodeId: Record<string, string> = {};
    await Promise.all(
      Object.entries(images).map(async ([nodeId, url]) => {
        if (!url) return;
        const res = await fetch(url);
        if (res.ok) svgByNodeId[nodeId] = await res.text();
      })
    );
    return svgByNodeId;
  }

  /**
   * Renders the given nodes to PNG and returns a signed, temporary Figma-hosted
   * URL per node id (rather than downloading bytes) — used both for raster
   * image fills and as the pixel-diff reference screenshot.
   */
  async exportPngUrls(fileKey: string, nodeIds: string[], scale = 2): Promise<Record<string, string | null>> {
    return this.renderImageUrls(fileKey, nodeIds, 'png', scale);
  }

  /**
   * Renders the given nodes to PNG at the given scale and downloads the actual
   * bytes (unlike exportPngUrls, which just returns Figma's signed URL) — used
   * as the ground-truth reference image for codegen_diff's pixel comparison.
   */
  async exportPngBytes(fileKey: string, nodeIds: string[], scale = 1): Promise<Record<string, Buffer>> {
    const urls = await this.renderImageUrls(fileKey, nodeIds, 'png', scale);
    const pngByNodeId: Record<string, Buffer> = {};
    await Promise.all(
      Object.entries(urls).map(async ([nodeId, url]) => {
        if (!url) return;
        const res = await fetch(url);
        if (res.ok) pngByNodeId[nodeId] = Buffer.from(await res.arrayBuffer());
      })
    );
    return pngByNodeId;
  }

  /** Fetches the file's design tokens: every variable plus the collections/modes that define them. */
  async getLocalVariables(fileKey: string): Promise<FigmaVariablesResponse> {
    return this.request<FigmaVariablesResponse>(`/files/${fileKey}/variables/local`);
  }

  /**
   * Resolves a component-set link/id down to its FigmaNode (which carries
   * componentPropertyDefinitions) plus each variant child (which carries
   * variantProperties) — walking getNodes' single-node response for the set itself.
   */
  async getComponentSetNode(fileKey: string, nodeId: string): Promise<FigmaNode> {
    const res = await this.getNodes(fileKey, [nodeId]);
    const entry = res.nodes[nodeId];
    if (!entry) {
      throw new FigmaApiError(`Component set node "${nodeId}" not found in file "${fileKey}"`);
    }
    return entry.document;
  }

  /**
   * Resolves a Figma component link down to the single FigmaNode it points to,
   * plus the components map for that subtree (node id -> {key, name,
   * componentSetId}) — needed to resolve an INSTANCE's componentId into the
   * stable component key that lib_map_figma_to_component mappings are keyed by.
   * If the link has no node-id, falls back to the file's root document node.
   */
  async resolveNodeFromLink(link: string) {
    const { fileKey, nodeId } = parseFigmaUrl(link);

    if (nodeId) {
      const res = await this.getNodes(fileKey, [nodeId]);
      const entry = res.nodes[nodeId];
      if (!entry) {
        throw new FigmaApiError(`Node "${nodeId}" not found in file "${fileKey}"`);
      }
      return {
        fileKey,
        nodeId,
        fileName: res.name,
        node: entry.document,
        componentsByNodeId: entry.components ?? {},
      };
    }

    const file = await this.getFile(fileKey);
    return {
      fileKey,
      nodeId: file.document.id,
      fileName: file.name,
      node: file.document,
      componentsByNodeId: file.components ?? {},
    };
  }
}
