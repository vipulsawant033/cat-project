import { FigmaClient } from '../../services/figmaClient.js';

export async function figmaExportNodeImage(args: {
  fileKey: string;
  nodeId: string;
  scale?: number;
  format?: 'png' | 'svg';
}) {
  const client = new FigmaClient();
  const scale = args.scale ?? 2;
  const format = args.format ?? 'png';
  const base64 = await client.exportImage(args.fileKey, args.nodeId, scale, format);
  return { nodeId: args.nodeId, format, scale, base64, dataUri: `data:image/${format};base64,${base64}` };
}
