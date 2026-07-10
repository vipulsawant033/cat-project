import { FigmaClient, FigmaNode } from '../../services/figmaClient.js';
import { TokenMapper } from '../../services/tokenMapper.js';
import { VariableResolver, formatResolvedVariable, FormattedVariable } from '../../services/variableResolver.js';
import { logger } from '../../utils/logger.js';

function collectBoundVariableIds(node: FigmaNode, ids: Set<string> = new Set()): Set<string> {
  if (node.boundVariables) {
    for (const value of Object.values(node.boundVariables)) {
      if (Array.isArray(value)) {
        for (const ref of value) if (ref?.id) ids.add(ref.id);
      } else if (value?.id) {
        ids.add(value.id);
      }
    }
  }
  for (const child of node.children || []) collectBoundVariableIds(child, ids);
  return ids;
}

export async function figmaGetNodeVariables(args: { fileKey: string; nodeId: string }) {
  const client = new FigmaClient();
  const result = await client.getNode(args.fileKey, args.nodeId);
  const nodeData = result.nodes[args.nodeId];
  if (!nodeData) throw new Error(`Node ${args.nodeId} not found`);

  const boundIds = collectBoundVariableIds(nodeData.document);
  const mapper = new TokenMapper();
  const variables: Record<string, FormattedVariable> = {};

  try {
    const varsResponse = await client.getLocalVariables(args.fileKey);
    const resolver = new VariableResolver(varsResponse, process.env.FIGMA_VARIABLE_MODE);
    for (const id of boundIds) {
      const resolved = resolver.resolve(id);
      if (!resolved) continue;
      variables[resolved.name] = formatResolvedVariable(resolved, (color) => mapper.colorToHex(color));
    }
  } catch (err) {
    logger.debug('Figma variables unavailable for this file (requires Enterprise plan or none defined)', { error: String(err) });
  }

  return { nodeId: args.nodeId, variables };
}
