import * as fs from 'fs';
import * as path from 'path';
import { FigmaPaint, FigmaTypeStyle, FigmaEffect, FigmaColor } from './figmaClient.js';
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
}

export class TokenMapper {
  private scssVars: Map<string, string> = new Map();
  private tokenMap: TokenMap = { colors: {}, typography: {}, spacing: [], shadows: [], radii: [] };

  constructor() {
    this.loadScssVars();
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

  mapColor(color: FigmaColor): MappedToken {
    const hex = this.colorToHex(color);
    const scssVar = this.scssVars.get(hex.toLowerCase());
    return {
      figmaValue: hex,
      scssVariable: scssVar,
      rawValue: scssVar ? `var(--${scssVar.replace('$', '').replace(/_/g, '-')})` : hex,
      unmapped: !scssVar,
    };
  }

  mapPaint(paint: FigmaPaint): MappedToken {
    if (paint.type === 'SOLID' && paint.color) {
      return this.mapColor(paint.color);
    }
    if (paint.type === 'GRADIENT_LINEAR' && paint.gradientStops) {
      const stops = paint.gradientStops.map(s => this.colorToHex(s.color)).join(', ');
      return { figmaValue: `gradient(${stops})`, rawValue: `linear-gradient(${stops})`, unmapped: true };
    }
    return { figmaValue: paint.type, rawValue: 'transparent', unmapped: true };
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
