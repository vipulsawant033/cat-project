import * as fs from 'fs';
import * as path from 'path';
import { FigmaClient } from '../../services/figmaClient.js';
import { logger } from '../../utils/logger.js';

function sanitizeNodeId(nodeId: string): string {
  return nodeId.replace(/[^a-zA-Z0-9-]/g, '-');
}

/** Fetches a node's exported image and writes it to disk (best-effort), returning its path if successful. */
export async function saveNodeScreenshot(
  client: FigmaClient,
  fileKey: string,
  nodeId: string,
  scale: number,
  format: 'png' | 'svg'
): Promise<{ filePath: string | null; base64: string }> {
  const base64 = await client.exportImage(fileKey, nodeId, scale, format);

  let filePath: string | null = null;
  try {
    const dir = path.resolve(process.env.IMAGE_CACHE_PATH || path.join(__dirname, '..', '..', '..', 'data', 'images'));
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    filePath = path.join(dir, `${sanitizeNodeId(nodeId)}-${scale}x.${format}`);
    fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
  } catch (err) {
    logger.debug('Failed to persist exported image to disk (non-fatal)', { error: String(err) });
    filePath = null;
  }

  return { filePath, base64 };
}

export async function figmaExportNodeImage(args: {
  fileKey: string;
  nodeId: string;
  scale?: number;
  format?: 'png' | 'svg';
  enableBase64Response?: boolean;
}) {
  const client = new FigmaClient();
  const scale = args.scale ?? 2;
  const format = args.format ?? 'png';

  const { filePath, base64 } = await saveNodeScreenshot(client, args.fileKey, args.nodeId, scale, format);

  return {
    nodeId: args.nodeId,
    format,
    scale,
    filePath,
    ...(args.enableBase64Response ? { base64, dataUri: `data:image/${format};base64,${base64}` } : {}),
  };
}
