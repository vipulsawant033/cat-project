import { Project, SourceFile, ClassDeclaration } from 'ts-morph';
import { ComponentRecord, InputDef, OutputDef, SlotDef, CSSPropDef } from '../services/componentIndex.js';
import { logger } from '../utils/logger.js';

export class LitParser {
  private project: Project;

  constructor() {
    this.project = new Project({ skipAddingFilesFromTsConfig: true });
  }

  parseFile(filePath: string): ComponentRecord | null {
    try {
      const sourceFile = this.project.addSourceFileAtPath(filePath);
      const result = this.extractLitComponent(sourceFile, filePath);
      this.project.removeSourceFile(sourceFile);
      return result;
    } catch (err) {
      logger.error('Lit parse error', { filePath, error: String(err) });
      return null;
    }
  }

  private extractLitComponent(sourceFile: SourceFile, filePath: string): ComponentRecord | null {
    for (const cls of sourceFile.getClasses()) {
      const tagName = this.detectTagName(cls, sourceFile);
      if (!tagName) continue;

      const className = cls.getName() || 'UnknownElement';
      const properties = this.extractProperties(cls);
      const outputs = this.extractEvents(cls);
      const slots = this.extractSlots(cls);
      const cssCustomProperties = this.extractCSSCustomProps(cls);
      const figmaId = this.extractFigmaAnnotation(cls);
      const exampleUsage = this.buildExampleUsage(tagName, properties, slots);

      const variants = properties
        .filter(p => !p.internal && p.type.includes('|'))
        .map(p => p.name);

      return {
        selector: tagName,
        className,
        componentType: 'lit',
        filePath,
        inputs: properties,
        outputs,
        slots,
        cssCustomProperties,
        variants: variants.length > 0 ? variants : undefined,
        exampleUsage,
        figmaComponentId: figmaId || undefined,
      };
    }
    return null;
  }

  private detectTagName(cls: ClassDeclaration, sourceFile: SourceFile): string | null {
    // @customElement('tag-name') decorator
    const customElementDecorator = cls.getDecorator('customElement');
    if (customElementDecorator) {
      const args = customElementDecorator.getArguments();
      if (args.length) {
        return args[0].getText().replace(/['"]/g, '');
      }
    }

    // customElements.define('tag-name', ClassName)
    const fileText = sourceFile.getFullText();
    const defineMatch = /customElements\.define\s*\(\s*['"]([^'"]+)['"]\s*,\s*([A-Za-z]+)/.exec(fileText);
    if (defineMatch && cls.getName() === defineMatch[2]) {
      return defineMatch[1];
    }

    // extends LitElement — derive name from class name as fallback
    const baseClass = cls.getBaseClass();
    if (baseClass && (baseClass.getName() === 'LitElement' || cls.getExtends()?.getText().includes('LitElement'))) {
      const name = cls.getName();
      if (name) return this.camelToKebab(name);
    }

    return null;
  }

  private extractProperties(cls: ClassDeclaration): InputDef[] {
    const props: InputDef[] = [];

    for (const prop of cls.getProperties()) {
      const propertyDec = prop.getDecorator('property');
      const stateDec = prop.getDecorator('state');

      if (!propertyDec && !stateDec) continue;

      const isInternal = !!stateDec;
      const typeText = prop.getType().getText();
      const jsdoc = prop.getJsDocs().map(d => d.getDescription()).join(' ').trim();

      let attrName: string | undefined;
      if (propertyDec) {
        const argText = propertyDec.getArguments()[0]?.getText() || '';
        const attrMatch = /attribute\s*:\s*['"]([^'"]+)['"]/.exec(argText);
        const reflectMatch = /reflect\s*:\s*(true|false)/.exec(argText);
        attrName = attrMatch ? attrMatch[1] : this.camelToKebab(prop.getName());
        const reflect = reflectMatch ? reflectMatch[1] === 'true' : false;

        props.push({
          name: prop.getName(),
          type: typeText,
          description: jsdoc || undefined,
          defaultValue: prop.getInitializer()?.getText(),
          internal: isInternal,
        });

        if (!reflect) {
          // Mark as property-only (not attribute)
          props[props.length - 1].description =
            (props[props.length - 1].description ? props[props.length - 1].description + ' ' : '') +
            `[attribute: ${attrName}]`;
        }
      } else {
        props.push({
          name: prop.getName(),
          type: typeText,
          description: jsdoc || undefined,
          defaultValue: prop.getInitializer()?.getText(),
          internal: true,
        });
      }
    }

    return props;
  }

  private extractEvents(cls: ClassDeclaration): OutputDef[] {
    const events: OutputDef[] = [];
    const fullText = cls.getFullText();

    // JSDoc @fires tags
    for (const jsdoc of cls.getJsDocs()) {
      const tags = jsdoc.getTags();
      for (const tag of tags) {
        if (tag.getTagName() === 'fires') {
          const comment = tag.getText();
          const eventMatch = /\{([^}]+)\}\s+(\S+)\s*-?\s*(.*)/.exec(comment) ||
                            /(\S+)\s*-?\s*(.*)/.exec(comment);
          if (eventMatch) {
            events.push({
              name: eventMatch[2] || eventMatch[1],
              eventType: eventMatch[1],
              description: eventMatch[3] || eventMatch[2] || undefined,
            });
          }
        }
      }
    }

    // detect this.dispatchEvent(new CustomEvent('event-name', ...))
    const dispatchRegex = /this\.dispatchEvent\(\s*new\s+CustomEvent\s*\(\s*['"]([^'"]+)['"]/g;
    let match;
    while ((match = dispatchRegex.exec(fullText)) !== null) {
      const eventName = match[1];
      if (!events.find(e => e.name === eventName)) {
        events.push({ name: eventName, eventType: 'CustomEvent' });
      }
    }

    return events;
  }

  private extractSlots(cls: ClassDeclaration): SlotDef[] {
    const slots: SlotDef[] = [];
    const fullText = cls.getFullText();

    // Find <slot name="..."> and <slot> in template literals
    const namedSlotRegex = /<slot\s+name=["']([^'"]+)["']/g;
    const defaultSlotRegex = /<slot(?![^>]*name=)[^>]*>/g;

    let slotMatch: RegExpExecArray | null;
    while ((slotMatch = namedSlotRegex.exec(fullText)) !== null) {
      if (!slots.find(s => s.name === slotMatch![1])) {
        slots.push({ name: slotMatch[1] });
      }
    }

    if (defaultSlotRegex.test(fullText)) {
      slots.unshift({ name: null, description: 'Default slot' });
    }

    return slots;
  }

  private extractCSSCustomProps(cls: ClassDeclaration): CSSPropDef[] {
    const props: CSSPropDef[] = [];
    const fullText = cls.getFullText();

    // var(--property-name) usages
    const varUsageRegex = /var\(\s*(--[\w-]+)/g;
    let match;
    const found = new Set<string>();
    while ((match = varUsageRegex.exec(fullText)) !== null) {
      found.add(match[1]);
    }

    // :host { --property-name: defaultValue } declarations
    const hostPropRegex = /--[\w-]+\s*:\s*([^;}\n]+)/g;
    const defaults = new Map<string, string>();
    let hostMatch: RegExpExecArray | null;
    while ((hostMatch = hostPropRegex.exec(fullText)) !== null) {
      const propName = (/--([\w-]+)\s*:/.exec(hostMatch[0]) || [])[0]?.replace(/\s*:.*/, '') || '';
      if (propName) defaults.set(propName, hostMatch[1].trim());
    }

    for (const prop of found) {
      props.push({
        name: prop,
        defaultValue: defaults.get(prop),
      });
    }

    return props;
  }

  private extractFigmaAnnotation(cls: ClassDeclaration): string | null {
    for (const jsdoc of cls.getJsDocs()) {
      const text = jsdoc.getFullText();
      const match = /@figma-component\s+([^\s\n*]+)/.exec(text);
      if (match) return match[1];
    }
    return null;
  }

  private buildExampleUsage(tagName: string, props: InputDef[], slots: SlotDef[]): string {
    const publicProps = props.filter(p => !p.internal).slice(0, 3);
    const attrs = publicProps.map(p => `.${p.name}="${p.defaultValue || 'value'}"`).join('\n  ');
    const defaultSlot = slots.find(s => s.name === null);
    const namedSlots = slots.filter(s => s.name !== null).slice(0, 2)
      .map(s => `  <span slot="${s.name}">...</span>`).join('\n');
    const inner = [
      namedSlots,
      defaultSlot ? '  Default content' : '',
    ].filter(Boolean).join('\n');

    return `<${tagName}\n  ${attrs}>\n${inner}\n</${tagName}>`;
  }

  private camelToKebab(str: string): string {
    return str.replace(/([A-Z])/g, c => `-${c.toLowerCase()}`).replace(/^-/, '');
  }
}
