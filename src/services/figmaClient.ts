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
    let attempt = 0;
    while (attempt < 3) {
      try {
        const response = await this.client.request<T>({ method, url, params });
        const elapsed = Date.now() - start;
        logger.info('Figma API call', { method, url, elapsed });
        if (method === 'GET') cacheSet(cacheKey, response.data);
        return response.data;
      } catch (err: unknown) {
        const axiosErr = err as { response?: { status: number }; message: string };
        if (axiosErr.response?.status === 429) {
          attempt++;
          const delay = Math.pow(2, attempt) * 1000;
          logger.warn('Rate limited, retrying', { attempt, delay });
          await new Promise(r => setTimeout(r, delay));
        } else {
          throw err;
        }
      }
    }
    throw new Error('Max retries exceeded for Figma API');
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
    const result = await this.request<{ images: Record<string, string> }>(
      'GET', `/images/${fileKey}`, { ids: nodeId, scale, format }
    );
    const url = result.images[nodeId];
    if (!url) throw new Error(`No image URL returned for node ${nodeId}`);

    const imgResponse = await axios.get<Buffer>(url, { responseType: 'arraybuffer' });
    return Buffer.from(imgResponse.data).toString('base64');
  }

  async getStyles(fileKey: string): Promise<{ meta: { styles: Array<{ node_id: string; name: string; style_type: string }> } }> {
    return this.request('GET', `/files/${fileKey}/styles`);
  }

  /** Requires a Figma Enterprise plan; throws on other plans or files with no published variables. */
  async getLocalVariables(fileKey: string): Promise<FigmaVariablesResponse> {
    return this.request('GET', `/files/${fileKey}/variables/local`);
  }
}
