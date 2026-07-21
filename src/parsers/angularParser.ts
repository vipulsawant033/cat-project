import { Project, SourceFile, ClassDeclaration, Decorator, PropertyDeclaration } from 'ts-morph';
import * as fs from 'fs';
import * as path from 'path';
import { ComponentRecord, InputDef, OutputDef } from '../services/componentIndex.js';
import { logger } from '../utils/logger.js';

export class AngularParser {
  private project: Project;

  constructor() {
    this.project = new Project({ skipAddingFilesFromTsConfig: true });
  }

  parseFile(filePath: string): ComponentRecord | null {
    try {
      const sourceFile = this.project.addSourceFileAtPath(filePath);
      const result = this.extractComponent(sourceFile, filePath);
      this.project.removeSourceFile(sourceFile);
      return result;
    } catch (err) {
      logger.error('Angular parse error', { filePath, error: String(err) });
      return null;
    }
  }

  private extractComponent(sourceFile: SourceFile, filePath: string): ComponentRecord | null {
    for (const cls of sourceFile.getClasses()) {
      const componentDecorator = cls.getDecorator('Component');
      if (!componentDecorator) continue;

      const selector = this.getDecoratorProperty(componentDecorator, 'selector');
      if (!selector) continue;

      const className = cls.getName() || 'UnknownComponent';
      const inputs = this.extractInputs(cls);
      const outputs = this.extractOutputs(cls);
      const variants = inputs
        .filter(i => i.type.includes('|'))
        .map(i => i.name);

      const template = this.getTemplate(componentDecorator, filePath);
      const scssClasses = this.extractScssClasses(componentDecorator, filePath);
      const figmaId = this.extractFigmaAnnotation(cls);
      const exampleUsage = this.buildExampleUsage(selector, inputs);

      return {
        selector,
        className,
        componentType: 'angular',
        filePath,
        inputs,
        outputs,
        variants: variants.length > 0 ? variants : undefined,
        scssClasses: scssClasses.length > 0 ? scssClasses : undefined,
        exampleUsage,
        figmaComponentId: figmaId || undefined,
      };
    }
    return null;
  }

  private getDecoratorProperty(decorator: Decorator, prop: string): string | null {
    try {
      const args = decorator.getArguments();
      if (!args.length) return null;
      const obj = args[0];
      const text = obj.getText();
      const match = new RegExp(`${prop}\\s*:\\s*['"\`]([^'"\`]+)['"\`]`).exec(text);
      return match ? match[1] : null;
    } catch {
      return null;
    }
  }

  private extractInputs(cls: ClassDeclaration): InputDef[] {
    const inputs: InputDef[] = [];
    for (const prop of cls.getProperties()) {
      if (!prop.getDecorator('Input')) continue;
      inputs.push({
        name: prop.getName(),
        type: prop.getType().getText(),
        description: prop.getJsDocs().map(d => d.getDescription()).join(' ').trim() || undefined,
        defaultValue: prop.getInitializer()?.getText(),
      });
    }
    return inputs;
  }

  private extractOutputs(cls: ClassDeclaration): OutputDef[] {
    const outputs: OutputDef[] = [];
    for (const prop of cls.getProperties()) {
      if (!prop.getDecorator('Output')) continue;
      const typeText = prop.getType().getText();
      const eventTypeMatch = /EventEmitter<([^>]+)>/.exec(typeText);
      outputs.push({
        name: prop.getName(),
        eventType: eventTypeMatch ? eventTypeMatch[1] : 'any',
        description: prop.getJsDocs().map(d => d.getDescription()).join(' ').trim() || undefined,
      });
    }
    return outputs;
  }

  private getTemplate(decorator: Decorator, filePath: string): string {
    try {
      const args = decorator.getArguments();
      if (!args.length) return '';
      const text = args[0].getText();
      const inlineMatch = /template\s*:\s*[`'"]([^`'"]*)[`'"]/s.exec(text);
      if (inlineMatch) return inlineMatch[1];
      const urlMatch = /templateUrl\s*:\s*['"]([^'"]+)['"]/.exec(text);
      if (urlMatch) {
        const templatePath = path.resolve(path.dirname(filePath), urlMatch[1]);
        if (fs.existsSync(templatePath)) return fs.readFileSync(templatePath, 'utf-8');
      }
    } catch {/* ignore */}
    return '';
  }

  private extractScssClasses(decorator: Decorator, filePath: string): string[] {
    const classes: string[] = [];
    try {
      const args = decorator.getArguments();
      if (!args.length) return classes;
      const text = args[0].getText();
      const urlMatch = /styleUrls?\s*:\s*\[['"]([^'"]+)['"]\]/.exec(text);
      if (urlMatch) {
        const scssPath = path.resolve(path.dirname(filePath), urlMatch[1]);
        if (fs.existsSync(scssPath)) {
          const content = fs.readFileSync(scssPath, 'utf-8');
          const classRegex = /\.([\w-]+)\s*[{,]/g;
          let match;
          while ((match = classRegex.exec(content)) !== null) {
            classes.push(match[1]);
          }
        }
      }
    } catch {/* ignore */}
    return classes;
  }

  private extractFigmaAnnotation(cls: ClassDeclaration): string | null {
    const leadingText = cls.getLeadingCommentRanges().map(r => r.getText()).join('\n');
    const match = /@figma-component[:\s]+([^\s\n*]+)/.exec(leadingText);
    return match ? match[1] : null;
  }

  private buildExampleUsage(selector: string, inputs: InputDef[]): string {
    const attrs = inputs.slice(0, 3).map(i => `[${i.name}]="${i.defaultValue || "'value'"}"`).join('\n  ');
    return `<${selector}\n  ${attrs}>\n</${selector}>`;
  }
}
