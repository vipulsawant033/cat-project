/**
 * Naming convention used for all generated output: kebab-case files with an
 * "app-" selector prefix, matching the Angular style guide
 * (https://angular.dev/style-guide). Change the PREFIX constant to adopt a
 * different convention project-wide.
 */
const PREFIX = 'app';

export function toKebabCase(input: string): string {
  return input
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-zA-Z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

export function toPascalCase(input: string): string {
  return toKebabCase(input)
    .split('-')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}

export interface ComponentNames {
  /** e.g. "primary-button" */
  fileBase: string;
  /** e.g. "app-primary-button" */
  selector: string;
  /** e.g. "PrimaryButton" */
  baseClassName: string;
  /** e.g. "PrimaryButtonComponent" */
  className: string;
}

export function buildComponentNames(figmaNodeName: string): ComponentNames {
  const fileBase = toKebabCase(figmaNodeName) || 'generated-component';
  const baseClassName = toPascalCase(figmaNodeName) || 'GeneratedComponent';
  return {
    fileBase,
    selector: `${PREFIX}-${fileBase}`,
    baseClassName,
    className: `${baseClassName}Component`,
  };
}
