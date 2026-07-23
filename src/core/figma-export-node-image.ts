import { FigmaClient, FigmaApiError, parseFigmaUrl } from '../figma/client.js';
import type { FigmaExportNodeImageInput, FigmaExportNodeImageOutput } from '../types.js';

/**
 * Core tool logic: Figma share link -> exported PNG, either as Figma's signed
 * URL (cheap, expires) or fetched/inlined as base64 (usable directly as the
 * pixel-diff reference image in Phase 5, no follow-up fetch required).
 */
export async function runFigmaExportNodeImage(
  input: FigmaExportNodeImageInput
): Promise<FigmaExportNodeImageOutput> {
  const client = new FigmaClient({ token: input.figmaToken });
  const { fileKey, nodeId } = parseFigmaUrl(input.figmaLink);
  if (!nodeId) {
    throw new FigmaApiError('figmaLink must include a node-id query param pointing at the node to export');
  }

  const urls = await client.exportPngUrls(fileKey, [nodeId], input.scale);
  const url = urls[nodeId];
  if (!url) {
    throw new FigmaApiError(`Figma returned no exportable image for node "${nodeId}"`);
  }

  if (input.format === 'url') {
    return { fileKey, nodeId, format: 'url', url };
  }

  const res = await fetch(url);
  if (!res.ok) {
    throw new FigmaApiError(`Failed to download exported image: ${res.status} ${res.statusText}`, res.status);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  return { fileKey, nodeId, format: 'base64', base64: buffer.toString('base64') };
}
