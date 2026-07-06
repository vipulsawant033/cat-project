import * as fs from 'fs';
import * as path from 'path';
import { FigmaClient, FigmaPaint, FigmaTypeStyle, FigmaEffect, FigmaColor } from './figmaClient.js';
import { VariableResolver } from './variableResolver.js';
import { logger } from '../utils/logger.js';

export interface TokenMap {
  colors: Record<string, string>;
  typography: Record<string, Partial<FigmaTypeStyle>>;
  spacing: number[];
  shadows: string[];
  radii: number[];
}

export interface MappedToken {
  figmaValue: string;
  scssVariable?: string;
  litCSSProp?: string;
  rawValue: string;
  unmapped: boolean;
  source?: 'figma-variable' | 'scss';
}

export class TokenMapper {
  private scssVars: Map<string, string> = new Map();
  private tokenMap: TokenMap = { colors: {}, typography: {}, spacing: [], shadows: [], radii: [] };
  private variableResolver?: VariableResolver;

  constructor() {
    this.loadScssVars();
  }

  setVariableResolver(resolver: VariableResolver): void {
    this.variableResolver = resolver;
  }

  /** Fetches the file's Figma Variables so mapColor can prefer them over hex-matched SCSS. Non-fatal if unavailable (e.g. non-Enterprise plan, or no variables defined). */
  async loadFigmaVariables(client: FigmaClient, fileKey: string): Promise<boolean> {
    try {
      const data = await client.getLocalVariables(fileKey);
      this.variableResolver = new VariableResolver(data, process.env.FIGMA_VARIABLE_MODE);
      logger.debug('Loaded Figma variables', { count: Object.keys(data.meta.variables).length });
      return true;
    } catch (err) {
      logger.debug('Figma variables unavailable, falling back to SCSS hex matching', { error: String(err) });
      return false;
    }
  }

  private loadScssVars(): void {
    const scssPath = process.env.SCSS_TOKENS_PATH;
    if (!scssPath || !fs.existsSync(scssPath)) return;

    const content = fs.readFileSync(scssPath, 'utf-8');
    const varRegex = /\$([a-zA-Z0-9_-]+)\s*:\s*([^;]+);/g;
    let match;
    while ((match = varRegex.exec(content)) !== null) {
      const [, name, value] = match;
      this.scssVars.set(value.trim().toLowerCase(), `$${name}`);
    }
    logger.debug('Loaded SCSS vars', { count: this.scssVars.size });
  }

  colorToHex(color: FigmaColor): string {
    const r = Math.round(color.r * 255);
    const g = Math.round(color.g * 255);
    const b = Math.round(color.b * 255);
    const a = color.a !== undefined ? color.a : 1;
    if (a < 1) {
      return `rgba(${r}, ${g}, ${b}, ${a.toFixed(2)})`;
    }
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }

  mapColor(color: FigmaColor, boundVariableId?: string): MappedToken {
    const hex = this.colorToHex(color);

    if (boundVariableId && this.variableResolver) {
      const resolved = this.variableResolver.resolve(boundVariableId);
      if (resolved && resolved.resolvedType === 'COLOR') {
        return {
          figmaValue: hex,
          rawValue: `var(--${resolved.cssName})`,
          unmapped: false,
          source: 'figma-variable',
        };
      }
    }

    const scssVar = this.scssVars.get(hex.toLowerCase());
    return {
      figmaValue: hex,
      scssVariable: scssVar,
      rawValue: scssVar ? `var(--${scssVar.replace('$', '').replace(/_/g, '-')})` : hex,
      unmapped: !scssVar,
      source: scssVar ? 'scss' : undefined,
    };
  }

  mapPaint(paint: FigmaPaint, boundVariableId?: string): MappedToken {
    if (paint.type === 'SOLID' && paint.color) {
      return this.mapColor(paint.color, boundVariableId);
    }
    if (paint.gradientStops?.length) {
      const stops = this.formatGradientStops(paint.gradientStops);
      switch (paint.type) {
        case 'GRADIENT_LINEAR': {
          const angle = this.computeGradientAngle(paint.gradientHandlePositions);
          return { figmaValue: `gradient(${stops})`, rawValue: `linear-gradient(${angle}deg, ${stops})`, unmapped: true };
        }
        case 'GRADIENT_RADIAL':
          return { figmaValue: `gradient(${stops})`, rawValue: `radial-gradient(circle, ${stops})`, unmapped: true };
        case 'GRADIENT_ANGULAR':
          return { figmaValue: `gradient(${stops})`, rawValue: `conic-gradient(${stops})`, unmapped: true };
        case 'GRADIENT_DIAMOND':
          // CSS has no diamond-gradient primitive; an elliptical radial gradient is the closest visual approximation.
          return { figmaValue: `gradient(${stops})`, rawValue: `radial-gradient(ellipse, ${stops})`, unmapped: true };
      }
    }
    return { figmaValue: paint.type, rawValue: 'transparent', unmapped: true };
  }

  private formatGradientStops(stops: Array<{ color: FigmaColor; position: number }>): string {
    return stops.map(s => `${this.colorToHex(s.color)} ${Math.round(s.position * 100)}%`).join(', ');
  }

  /** Derives a CSS gradient angle (0deg = up, clockwise) from Figma's normalized start/end handle positions. */
  private computeGradientAngle(handles?: Array<{ x: number; y: number }>): number {
    if (!handles || handles.length < 2) return 180; // Figma's default gradient direction: top to bottom.
    const [start, end] = handles;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const angleFromTop = (Math.atan2(dx, -dy) * 180) / Math.PI;
    return Math.round(((angleFromTop % 360) + 360) % 360);
  }

  mapTypography(style: FigmaTypeStyle): Record<string, string> {
    return {
      'font-family': `'${style.fontFamily}'`,
      'font-size': `${style.fontSize}px`,
      'font-weight': `${style.fontWeight}`,
      ...(style.lineHeightPx ? { 'line-height': `${style.lineHeightPx}px` } : {}),
      ...(style.letterSpacing ? { 'letter-spacing': `${style.letterSpacing}px` } : {}),
      ...(style.textAlignHorizontal ? { 'text-align': style.textAlignHorizontal.toLowerCase() } : {}),
    };
  }

  mapEffect(effect: FigmaEffect): string {
    if (effect.type === 'DROP_SHADOW' && effect.color && effect.offset) {
      const color = this.colorToHex(effect.color);
      return `${effect.offset.x}px ${effect.offset.y}px ${effect.radius || 0}px ${effect.spread || 0}px ${color}`;
    }
    if (effect.type === 'INNER_SHADOW' && effect.color && effect.offset) {
      const color = this.colorToHex(effect.color);
      return `inset ${effect.offset.x}px ${effect.offset.y}px ${effect.radius || 0}px ${color}`;
    }
    return '';
  }

  extractTokensFromFile(figmaFile: { styles: Record<string, { name: string; styleType: string }> }): TokenMap {
    const tokenMap: TokenMap = { colors: {}, typography: {}, spacing: [], shadows: [], radii: [] };
    for (const [id, style] of Object.entries(figmaFile.styles)) {
      if (style.styleType === 'FILL') {
        tokenMap.colors[style.name] = id;
      } else if (style.styleType === 'TEXT') {
        tokenMap.typography[style.name] = {};
      }
    }
    this.tokenMap = tokenMap;
    return tokenMap;
  }

  getTokenMap(): TokenMap {
    return this.tokenMap;
  }
}
