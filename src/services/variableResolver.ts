import { FigmaColor, FigmaVariable, FigmaVariableCollection, FigmaVariablesResponse, FigmaVariableValue } from './figmaClient.js';
import { logger } from '../utils/logger.js';

export interface ResolvedVariable {
  id: string;
  name: string;
  cssName: string;
  collectionName: string;
  resolvedType: 'COLOR' | 'FLOAT' | 'STRING' | 'BOOLEAN';
  value: FigmaColor | number | string | boolean;
}

function isAlias(value: FigmaVariableValue): value is { type: 'VARIABLE_ALIAS'; id: string } {
  return typeof value === 'object' && value !== null && (value as { type?: string }).type === 'VARIABLE_ALIAS';
}

/** Resolves Figma Variable bindings to concrete values, following alias chains and honoring mode selection. */
export class VariableResolver {
  private variables: Record<string, FigmaVariable>;
  private collections: Record<string, FigmaVariableCollection>;

  constructor(data: FigmaVariablesResponse, private modeOverrideName?: string) {
    this.variables = data.meta.variables;
    this.collections = data.meta.variableCollections;
  }

  resolve(variableId: string, depth = 0): ResolvedVariable | null {
    if (depth > 5) {
      logger.warn('Variable alias chain too deep, aborting', { variableId });
      return null;
    }

    const variable = this.variables[variableId];
    if (!variable) return null;

    const modeId = this.activeModeId(variable.variableCollectionId);
    const rawValue = variable.valuesByMode[modeId] ?? Object.values(variable.valuesByMode)[0];
    if (rawValue === undefined) return null;

    if (isAlias(rawValue)) {
      const aliased = this.resolve(rawValue.id, depth + 1);
      if (!aliased) return null;
      // Keep this variable's own name (semantic layer) but the aliased leaf's concrete value.
      return { ...aliased, id: variable.id, name: variable.name, cssName: this.toCssName(variable.name) };
    }

    const collection = this.collections[variable.variableCollectionId];
    return {
      id: variable.id,
      name: variable.name,
      cssName: this.toCssName(variable.name),
      collectionName: collection?.name || '',
      resolvedType: variable.resolvedType,
      value: rawValue,
    };
  }

  private activeModeId(collectionId: string): string {
    const collection = this.collections[collectionId];
    if (!collection) return '';
    if (this.modeOverrideName) {
      const match = collection.modes.find(m => m.name.toLowerCase() === this.modeOverrideName!.toLowerCase());
      if (match) return match.modeId;
    }
    return collection.defaultModeId;
  }

  private toCssName(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }
}

export interface FormattedVariable {
  cssName: string;
  type: string;
  value: unknown;
  collection: string;
}

/** Shapes a resolved variable into the response format shared by figma_extract_tokens and figma_get_node_variables. */
export function formatResolvedVariable(resolved: ResolvedVariable, colorToHex: (color: FigmaColor) => string): FormattedVariable {
  return {
    cssName: `--${resolved.cssName}`,
    type: resolved.resolvedType,
    value: resolved.resolvedType === 'COLOR' ? colorToHex(resolved.value as FigmaColor) : resolved.value,
    collection: resolved.collectionName,
  };
}
