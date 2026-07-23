import { FigmaClient, FigmaApiError, parseFigmaUrl } from '../figma/client.js';
import type {
  FigmaComponentSetProperty,
  FigmaComponentSetVariant,
  FigmaGetComponentSetInput,
  FigmaGetComponentSetOutput,
} from '../types.js';

/**
 * Core tool logic: Figma share link (node-id must point directly at a
 * COMPONENT_SET, not one of its individual variants — the nodes API has no
 * way to walk from a child up to its parent) -> its variant property
 * definitions and the concrete variant options available. This is what
 * Phase 2's library mapping needs to know which Figma variant props (e.g.
 * "Style=Primary, Size=Large") correspond to which Angular wrapper inputs.
 */
export async function runFigmaGetComponentSet(
  input: FigmaGetComponentSetInput
): Promise<FigmaGetComponentSetOutput> {
  const client = new FigmaClient({ token: input.figmaToken });
  const { fileKey, nodeId } = parseFigmaUrl(input.figmaLink);
  if (!nodeId) {
    throw new FigmaApiError('figmaLink must include a node-id pointing at a COMPONENT_SET');
  }

  const setNode = await client.getComponentSetNode(fileKey, nodeId);
  if (setNode.type !== 'COMPONENT_SET') {
    throw new FigmaApiError(
      `Node "${nodeId}" is a ${setNode.type}, not a COMPONENT_SET. In Figma, right-click the component ` +
        'set frame itself (not an individual variant) and choose "Copy link to selection".'
    );
  }

  const properties: Record<string, FigmaComponentSetProperty> = {};
  for (const [key, def] of Object.entries(setNode.componentPropertyDefinitions ?? {})) {
    properties[key] = {
      type: def.type,
      defaultValue: def.defaultValue,
      variantOptions: def.variantOptions,
    };
  }

  const variants: FigmaComponentSetVariant[] = (setNode.children ?? [])
    .filter((child) => child.visible !== false)
    .map((child) => ({
      id: child.id,
      name: child.name,
      variantProperties: child.variantProperties ?? {},
    }));

  return {
    fileKey,
    nodeId: setNode.id,
    name: setNode.name,
    properties,
    variants,
  };
}
