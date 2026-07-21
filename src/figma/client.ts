import type { FigmaFileResponse, FigmaLinkRef, FigmaNodesResponse } from './types.js';

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
   * Renders the given nodes to SVG via Figma's image export API and fetches
   * the actual markup for each, keyed by node id. Nodes with no renderable
   * output (or a failed render) are simply omitted from the result.
   */
  async exportSvgs(fileKey: string, nodeIds: string[]): Promise<Record<string, string>> {
    if (nodeIds.length === 0) return {};

    const ids = encodeURIComponent(nodeIds.join(','));
    const { images } = await this.request<{ images: Record<string, string | null> }>(
      `/images/${fileKey}?ids=${ids}&format=svg`
    );

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
   * Resolves a Figma component link down to the single FigmaNode it points to.
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
      return { fileKey, nodeId, fileName: res.name, node: entry.document };
    }

    const file = await this.getFile(fileKey);
    return { fileKey, nodeId: file.document.id, fileName: file.name, node: file.document };
  }
}
