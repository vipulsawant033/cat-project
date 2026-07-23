import { FigmaClient, parseFigmaUrl } from '../figma/client.js';
import { figmaColorToCss } from '../figma/parser.js';
import { toCssVariableName } from '../figma/tokens.js';
import type { FigmaColor, FigmaVariable, FigmaVariableCollection } from '../figma/types.js';
import type { ExtractedToken, FigmaExtractTokensInput, FigmaExtractTokensOutput } from '../types.js';

function isFigmaColor(value: unknown): value is FigmaColor {
  return (
    typeof value === 'object' &&
    value !== null &&
    'r' in value &&
    'g' in value &&
    'b' in value &&
    'a' in value
  );
}

function resolveValue(variable: FigmaVariable, modeId: string): string {
  const raw = variable.valuesByMode[modeId];
  if (raw === undefined) return '';
  if (variable.resolvedType === 'COLOR' && isFigmaColor(raw)) return figmaColorToCss(raw);
  return String(raw);
}

/**
 * Core tool logic: Figma file link -> normalized design tokens (one entry per
 * variable, with a suggested CSS custom-property name and its resolved value
 * per mode). This is what lets codegen emit `var(--token)` instead of raw hex/px.
 */
export async function runFigmaExtractTokens(input: FigmaExtractTokensInput): Promise<FigmaExtractTokensOutput> {
  const client = new FigmaClient({ token: input.figmaToken });
  const { fileKey } = parseFigmaUrl(input.figmaLink);
  const { meta } = await client.getLocalVariables(fileKey);

  const collectionsById: Record<string, FigmaVariableCollection> = meta.variableCollections;

  const tokens: ExtractedToken[] = Object.values(meta.variables).map((variable) => {
    const collection = collectionsById[variable.variableCollectionId];
    const valuesByMode: Record<string, string> = {};
    if (collection) {
      for (const [modeId, modeName] of Object.entries(collection.modes)) {
        valuesByMode[modeName] = resolveValue(variable, modeId);
      }
    }
    return {
      variableId: variable.id,
      name: variable.name,
      cssVariableName: toCssVariableName(variable.name),
      type: variable.resolvedType,
      collection: collection?.name ?? variable.variableCollectionId,
      valuesByMode,
    };
  });

  return { fileKey, tokens };
}
