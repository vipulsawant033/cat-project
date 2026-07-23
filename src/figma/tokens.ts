import type { FigmaClient } from './client.js';
import type { TokenRef } from './parser.js';
import type { FigmaVariable } from './types.js';

/** Shared by figma_extract_tokens (name -> CSS var name) and generate-angular-component's token-binding lookup (variable id -> CSS var name) — keeping this in one place means both always agree on the same name. */
export function toCssVariableName(figmaVariableName: string): string {
  return '--' + figmaVariableName.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
}

/** Builds the variable-id -> TokenRef lookup the parser needs to emit var(--token, literal) styling. */
export function buildTokensByVariableId(variables: Record<string, FigmaVariable>): Record<string, TokenRef> {
  const tokensByVariableId: Record<string, TokenRef> = {};
  for (const variable of Object.values(variables)) {
    tokensByVariableId[variable.id] = { cssVariableName: toCssVariableName(variable.name) };
  }
  return tokensByVariableId;
}

/**
 * Fetches the file's design tokens and indexes them by variable id, ready for
 * figmaNodeToIr's tokensByVariableId option. Not every file has variables
 * configured — and the Variables API is Enterprise-plan-only on Figma's side
 * — so a failure here just means no token substitution for this generation,
 * not a fatal error for the whole request.
 */
export async function loadTokensByVariableId(client: FigmaClient, fileKey: string): Promise<Record<string, TokenRef>> {
  try {
    const { meta } = await client.getLocalVariables(fileKey);
    return buildTokensByVariableId(meta.variables);
  } catch {
    return {};
  }
}
