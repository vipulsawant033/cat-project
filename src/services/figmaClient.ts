import axios, { AxiosInstance } from 'axios';
import { logger } from '../utils/logger.js';
import { cacheGet, cacheSet } from '../utils/cache.js';

export interface FigmaColor {
  r: number; g: number; b: number; a: number;
}

export interface FigmaPaint {
  type: string;
  color?: FigmaColor;
  opacity?: number;
  visible?: boolean;
  gradientStops?: Array<{ color: FigmaColor; position: number }>;
  /** Three normalized (0-1) points: [start, end, widthReference] — defines gradient direction/scale. */
  gradientHandlePositions?: Array<{ x: number; y: number }>;
  imageRef?: string;
}

export interface FigmaTypeStyle {
  fontFamily: string;
  fontPostScriptName?: string;
  fontSize: number;
  fontWeight: number;
  lineHeightPx?: number;
  letterSpacing?: number;
  textAlignHorizontal?: string;
}

export interface FigmaEffect {
  type: string;
  visible: boolean;
  radius?: number;
  color?: FigmaColor;
  offset?: { x: number; y: number };
  spread?: number;
}

export interface FigmaNode {
  id: string;
  name: string;
  type: string;
  visible?: boolean;
  children?: FigmaNode[];
  fills?: FigmaPaint[];
  strokes?: FigmaPaint[];
  strokeWeight?: number;
  strokeAlign?: string;
  effects?: FigmaEffect[];
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number };
  constraints?: { vertical: string; horizontal: string };
  /** Degrees relative to the node's default orientation. Figma's REST API returns this in radians. */
  rotation?: number;
  textAutoResize?: 'NONE' | 'WIDTH_AND_HEIGHT' | 'HEIGHT' | 'TRUNCATE';
  /** 'ABSOLUTE' means this child opts out of its auto-layout parent's flow and free-floats. */
  layoutPositioning?: 'AUTO' | 'ABSOLUTE';
  layoutMode?: 'HORIZONTAL' | 'VERTICAL' | 'NONE';
  primaryAxisAlignItems?: string;
  counterAxisAlignItems?: string;
  itemSpacing?: number;
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  cornerRadius?: number;
  rectangleCornerRadii?: number[];
  characters?: string;
  style?: FigmaTypeStyle;
  componentId?: string;
  componentSetId?: string;
  variantProperties?: Record<string, string>;
  overrides?: Array<{ id: string; overriddenFields: string[] }>;
  clipsContent?: boolean;
  background?: FigmaPaint[];
  opacity?: number;
  blendMode?: string;
  layoutAlign?: string;
  layoutGrow?: number;
  primaryAxisSizingMode?: string;
  counterAxisSizingMode?: string;
  boundVariables?: FigmaBoundVariables;
}

export interface FigmaBoundVariable {
  type: 'VARIABLE_ALIAS';
  id: string;
}

export interface FigmaBoundVariables {
  fills?: FigmaBoundVariable[];
  strokes?: FigmaBoundVariable[];
  itemSpacing?: FigmaBoundVariable;
  paddingLeft?: FigmaBoundVariable;
  paddingRight?: FigmaBoundVariable;
  paddingTop?: FigmaBoundVariable;
  paddingBottom?: FigmaBoundVariable;
  cornerRadius?: FigmaBoundVariable;
}

export type FigmaVariableValue = FigmaColor | number | string | boolean | FigmaBoundVariable;

export interface FigmaVariable {
  id: string;
  name: string;
  resolvedType: 'COLOR' | 'FLOAT' | 'STRING' | 'BOOLEAN';
  variableCollectionId: string;
  valuesByMode: Record<string, FigmaVariableValue>;
}

export interface FigmaVariableCollection {
  id: string;
  name: string;
  defaultModeId: string;
  modes: Array<{ modeId: string; name: string }>;
}

export interface FigmaVariablesResponse {
  meta: {
    variables: Record<string, FigmaVariable>;
    variableCollections: Record<string, FigmaVariableCollection>;
  };
}

export interface FigmaFile {
  name: string;
  lastModified: string;
  version: string;
  document: FigmaNode;
  components: Record<string, { name: string; description: string; componentSetId?: string }>;
  componentSets: Record<string, { name: string; description: string }>;
  styles: Record<string, { name: string; styleType: string; description: string }>;
}

export interface ComponentSet {
  id: string;
  name: string;
  description: string;
  componentPropertyDefinitions?: Record<string, {
    type: string;
    defaultValue: string | boolean;
    variantOptions?: string[];
  }>;
  children?: Array<{ id: string; name: string; variantProperties: Record<string, string> }>;
}

export class FigmaClient {
  private client: AxiosInstance;

  constructor() {
    const token = process.env.FIGMA_PAT;
    if (!token) throw new Error('FIGMA_PAT environment variable is required');

    this.client = axios.create({
      baseURL: 'https://api.figma.com/v1',
      headers: { 'X-FIGMA-TOKEN': token },
      timeout: 30000,
    });
  }

  private async request<T>(method: string, url: string, params?: Record<string, unknown>): Promise<T> {
    const cacheKey = `${method}:${url}:${JSON.stringify(params || {})}`;
    if (method === 'GET') {
      const cached = cacheGet<T>(cacheKey);
      if (cached) {
        logger.debug('Cache hit', { url });
        return cached;
      }
    }

    const start = Date.now();
    const maxAttempts = 3;
    let attempt = 0;
    while (attempt < maxAttempts) {
      try {
        const response = await this.client.request<T>({ method, url, params });
        const elapsed = Date.now() - start;
        logger.info('Figma API call', { method, url, elapsed });
        if (method === 'GET') cacheSet(cacheKey, response.data);
        return response.data;
      } catch (err: unknown) {
        const axiosErr = err as { response?: { status: number; data?: unknown }; message: string };
        const status = axiosErr.response?.status;
        // 429 (rate limited) and 5xx (transient upstream failure — Figma's render/API service
        // occasionally blips on its own, independent of anything about this request) are both
        // worth a retry with backoff. Anything else (4xx client errors: bad node id, bad token,
        // etc.) is not going to succeed on retry, so fail fast.
        const retryable = status === 429 || (status !== undefined && status >= 500);
        attempt++;
        if (retryable && attempt < maxAttempts) {
          const delay = Math.pow(2, attempt) * 1000;
          logger.warn('Figma API call failed, retrying', { method, url, status, attempt, delay });
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        // Surface Figma's actual response body (it usually includes a human-readable `err`
        // message) instead of axios's generic "Request failed with status code NNN" — that
        // generic message gives no way to tell a bad request apart from, say, a node too
        // large/complex for Figma's render service to rasterize.
        const detail = axiosErr.response?.data ? ` — ${JSON.stringify(axiosErr.response.data)}` : '';
        throw new Error(
          `Figma API request failed: ${method} ${url} (status ${status ?? 'unknown'})${detail}`
        );
      }
    }
    throw new Error(`Figma API request failed after ${maxAttempts} attempts: ${method} ${url}`);
  }

  async getFile(fileKey: string, opts?: { depth?: number }): Promise<FigmaFile> {
    const params: Record<string, unknown> = {};
    if (opts?.depth !== undefined) params.depth = opts.depth;
    return this.request<FigmaFile>('GET', `/files/${fileKey}`, params);
  }

  async getNode(fileKey: string, nodeId: string, opts?: { depth?: number }): Promise<{ nodes: Record<string, { document: FigmaNode }> }> {
    const params: Record<string, unknown> = { ids: nodeId };
    if (opts?.depth !== undefined) params.depth = opts.depth;
    return this.request('GET', `/files/${fileKey}/nodes`, params);
  }

  async getComponentSets(fileKey: string): Promise<{ meta: { component_sets: ComponentSet[] } }> {
    return this.request('GET', `/files/${fileKey}/component_sets`);
  }

  async exportImage(fileKey: string, nodeId: string, scale: number, format: 'png' | 'svg'): Promise<string> {
    // Figma's /images endpoint returns HTTP 200 with `images[nodeId]: null` (rather than an
    // HTTP error) when it can't rasterize a node — most commonly because the node/subtree is
    // too large or complex for its render service. request() already retries real 5xx errors;
    // this null-url case needs its own message since there's no failed HTTP status to report.
    const result = await this.request<{ images: Record<string, string | null>; err?: string }>(
      'GET', `/images/${fileKey}`, { ids: nodeId, scale, format }
    );
    if (result.err) {
      throw new Error(`Figma image export failed for node ${nodeId}: ${result.err}`);
    }
    const url = result.images[nodeId];
    if (!url) {
      throw new Error(
        `Figma could not render an image for node ${nodeId} — it returned no error, just no ` +
        `image. This usually means the node/subtree is too large or complex to rasterize in one ` +
        `export. Try exporting a smaller child node instead, or lowering scale.`
      );
    }

    try {
      const imgResponse = await axios.get<Buffer>(url, { responseType: 'arraybuffer', timeout: 60000 });
      return Buffer.from(imgResponse.data).toString('base64');
    } catch (err: unknown) {
      const axiosErr = err as { message: string };
      throw new Error(`Failed to download exported image for node ${nodeId} from Figma's CDN: ${axiosErr.message}`);
    }
  }

  async getStyles(fileKey: string): Promise<{ meta: { styles: Array<{ node_id: string; name: string; style_type: string }> } }> {
    return this.request('GET', `/files/${fileKey}/styles`);
  }

  /** Requires a Figma Enterprise plan; throws on other plans or files with no published variables. */
  async getLocalVariables(fileKey: string): Promise<FigmaVariablesResponse> {
    return this.request('GET', `/files/${fileKey}/variables/local`);
  }
}
