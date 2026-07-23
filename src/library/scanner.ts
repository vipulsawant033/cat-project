import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

export interface AngularComponentMember {
  name: string;
  type: string;
}

export interface AngularComponentInfo {
  selector: string;
  className: string;
  /** Absolute path to the .ts file the component was found in. */
  filePath: string;
  inputs: AngularComponentMember[];
  outputs: AngularComponentMember[];
  /** The "name" field of the nearest ancestor package.json, if any — used as the codegen import specifier. */
  packageName?: string;
}

const IGNORED_DIR_NAMES = new Set(['node_modules', 'dist', 'out-tsc', '.git', '.angular']);

/** Walks up from `startDir` looking for the nearest package.json and returns its "name" field, if any. */
function findNearestPackageName(startDir: string): string | undefined {
  let dir = startDir;
  for (let i = 0; i < 20; i++) {
    const packageJsonPath = path.join(dir, 'package.json');
    try {
      const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      if (typeof pkg.name === 'string') return pkg.name;
    } catch {
      // no package.json here, or it has no usable "name" — keep walking up
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

function walkTsFiles(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (IGNORED_DIR_NAMES.has(entry)) continue;
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walkTsFiles(full, out);
    } else if (entry.endsWith('.component.ts') && !entry.endsWith('.spec.ts')) {
      out.push(full);
    }
  }
  return out;
}

function getDecoratorName(decorator: ts.Decorator): string | undefined {
  const expr = decorator.expression;
  if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression)) return expr.expression.text;
  if (ts.isIdentifier(expr)) return expr.text;
  return undefined;
}

function getComponentSelector(decorator: ts.Decorator): string | undefined {
  const expr = decorator.expression;
  if (!ts.isCallExpression(expr)) return undefined;
  const arg = expr.arguments[0];
  if (!arg || !ts.isObjectLiteralExpression(arg)) return undefined;
  for (const prop of arg.properties) {
    if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && prop.name.text === 'selector') {
      if (ts.isStringLiteralLike(prop.initializer)) return prop.initializer.text;
    }
  }
  return undefined;
}

function memberTypeText(member: ts.PropertyDeclaration): string {
  return member.type ? member.type.getText() : 'unknown';
}

/**
 * Parses one .component.ts file via the TypeScript compiler API in syntax-only
 * mode (no Program/type-checker needed — we only read decorator calls and
 * member declarations as source text) and returns its public API.
 *
 * Covers classic decorator-based `@Input()`/`@Output()` members. Does not yet
 * cover Angular's newer signal-based `input()`/`output()` functions — a known
 * gap to close if the target library has migrated to them.
 */
function scanComponentFile(filePath: string): AngularComponentInfo | undefined {
  const sourceText = readFileSync(filePath, 'utf-8');
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true);

  let result: AngularComponentInfo | undefined;

  ts.forEachChild(sourceFile, (node) => {
    if (result || !ts.isClassDeclaration(node) || !node.name) return;

    const classDecorators = ts.getDecorators?.(node) ?? [];
    const componentDecorator = classDecorators.find((d) => getDecoratorName(d) === 'Component');
    if (!componentDecorator) return;

    const selector = getComponentSelector(componentDecorator);
    if (!selector) return;

    const inputs: AngularComponentMember[] = [];
    const outputs: AngularComponentMember[] = [];

    for (const member of node.members) {
      if (!ts.isPropertyDeclaration(member) || !member.name || !ts.isIdentifier(member.name)) continue;
      const memberDecorators = ts.getDecorators?.(member) ?? [];
      const isInput = memberDecorators.some((d) => getDecoratorName(d) === 'Input');
      const isOutput = memberDecorators.some((d) => getDecoratorName(d) === 'Output');
      if (isInput) inputs.push({ name: member.name.text, type: memberTypeText(member) });
      if (isOutput) outputs.push({ name: member.name.text, type: memberTypeText(member) });
    }

    result = { selector, className: node.name.text, filePath, inputs, outputs };
  });

  return result;
}

/** Recursively scans an Angular workspace/library directory for every component's public API. */
export function scanAngularLibrary(dir: string): AngularComponentInfo[] {
  const files = walkTsFiles(path.resolve(dir));
  const components: AngularComponentInfo[] = [];
  for (const file of files) {
    const info = scanComponentFile(file);
    if (info) components.push({ ...info, packageName: findNearestPackageName(path.dirname(file)) });
  }
  return components;
}
