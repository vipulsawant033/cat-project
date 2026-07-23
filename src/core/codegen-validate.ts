import { FigmaClient } from '../figma/client.js';
import { getMapping } from '../library/mapping-store.js';
import type { FigmaNode } from '../figma/types.js';
import type { CodegenValidateInput, CodegenValidateOutput, UnmappedInstance } from '../types.js';

/** Recursively collects every visible INSTANCE node in the subtree. */
function collectInstances(node: FigmaNode, out: FigmaNode[] = []): FigmaNode[] {
  if (node.visible === false) return out;
  if (node.type === 'INSTANCE') out.push(node);
  for (const child of node.children ?? []) collectInstances(child, out);
  return out;
}

/**
 * Core tool logic: structural completeness check, independent of pixel
 * fidelity. Walks the raw Figma tree (not the generated IR, which can't
 * distinguish "was an unmapped instance" from "was always a plain frame")
 * and reports which component instances have no lib_map_figma_to_component
 * mapping — those render as generic divs today instead of real components.
 */
export async function runCodegenValidate(input: CodegenValidateInput): Promise<CodegenValidateOutput> {
  const client = new FigmaClient({ token: input.figmaToken });
  const { fileKey, nodeId, node, componentsByNodeId } = await client.resolveNodeFromLink(input.figmaLink);

  const instances = collectInstances(node);
  const unmappedInstances: UnmappedInstance[] = [];
  let mappedInstances = 0;

  for (const instance of instances) {
    const meta = instance.componentId ? componentsByNodeId[instance.componentId] : undefined;
    const mapping = meta ? getMapping(meta.key) : undefined;

    if (mapping) {
      mappedInstances++;
    } else {
      unmappedInstances.push({
        nodeId: instance.id,
        name: instance.name,
        componentKey: meta?.key ?? '(unknown — componentId not found in this subtree\'s components map)',
        componentName: meta?.name ?? instance.name,
      });
    }
  }

  return {
    source: { fileKey, nodeId, nodeName: node.name },
    totalInstances: instances.length,
    mappedInstances,
    unmappedInstances,
  };
}
