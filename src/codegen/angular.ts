/**
 * IR -> Angular standalone component (ts / html / scss). Deterministic and
 * one-shot: same IR always yields the same files, so output is stable/diffable.
 *
 * Produces REAL components, not static markup:
 *  - responsive sizing from Figma FILL/HUG/FIXED (flex/auto/px), not fixed px
 *  - text bound to class fields via {{ }} (data-driven, editable state)
 *  - *ngFor over a typed data array for runs of repeated reused components
 *  - reused library components with [variant]/[state] bindings (Figma variants)
 */

import type { Axis, IRDocument, IRNode, Style } from "../ir/schema.js";
import { flexLayoutToCss } from "../layout/mapper.js";

export interface AngularComponent {
  className: string;
  selector: string;
  files: { ts: string; html: string; scss: string };
  styleBytes: number;
  fonts: string[];
  styleBudgetNote?: string;
}

interface ParentCtx {
  isFlex: boolean;
  direction: Axis;
}

const KEBAB = (s: string) =>
  s
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-zA-Z0-9-]/g, "")
    .replace(/-+/g, "-")
    .toLowerCase()
    .replace(/^-|-$/g, "") || "node";

const PASCAL = (s: string) =>
  KEBAB(s)
    .split("-")
    .filter(Boolean)
    .map((p) => p[0].toUpperCase() + p.slice(1))
    .join("") || "Node";

const CAMEL = (kebab: string) => kebab.replace(/-([a-zA-Z0-9])/g, (_, c: string) => c.toUpperCase());

/** Valid CSS ident — never starts with a digit (e.g. layer "300px" -> "n300px"). */
function toCssIdent(kebab: string): string {
  return /^[a-zA-Z_]/.test(kebab) ? kebab : `n${kebab}`;
}

function classFor(node: IRNode, seen: Map<string, number>): string {
  const base = toCssIdent(KEBAB(node.name));
  const n = (seen.get(base) ?? 0) + 1;
  seen.set(base, n);
  return n === 1 ? base : `${base}-${n}`;
}

/** A single-quoted Angular/TS string literal, safely escaped. */
function quote(s: string): string {
  return `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\r?\n/g, " ")}'`;
}

function objLiteral(obj: Record<string, string>): string {
  return `{ ${Object.entries(obj).map(([k, v]) => `${k}: ${quote(v)}`).join(", ")} }`;
}

function cornerRadiusCss(r: Style["cornerRadius"]): string | null {
  if (Array.isArray(r)) {
    if (r.every((x) => x === 0)) return null;
    return r.map((x) => `${x}px`).join(" ");
  }
  return r ? `${r}px` : null;
}

/**
 * Responsive sizing from the IR box (which carries Figma FILL/HUG/FIXED):
 *  - FILL  -> flex:1 on the main axis, align-self:stretch on the cross axis
 *  - HUG   -> leave unset (content-sized)
 *  - FIXED -> px (main-axis fixed items get flex:0 0 auto so they aren't squished)
 * The root becomes responsive: width:100% capped by the design width, height floored
 * at the design height (min-height, not height) so content can still grow past it but
 * children with align-self:stretch (sidebars, viewport-filling shells) get the full
 * intended size instead of collapsing to whatever the content happens to need.
 */
function applySizing(css: Record<string, string>, node: IRNode, parent: ParentCtx | null, isRoot: boolean): void {
  if (isRoot) {
    const w = node.box.width;
    if (typeof w === "number") {
      css["width"] = "100%";
      css["max-width"] = `${Math.round(w)}px`;
    } else if (w === "fill") {
      css["width"] = "100%";
    }
    const h = node.box.height;
    if (typeof h === "number") {
      css["min-height"] = `${Math.round(h)}px`;
    } else if (h === "fill") {
      css["min-height"] = "100%";
    }
    return;
  }
  const axis = (a: "h" | "v") => {
    const val = a === "h" ? node.box.width : node.box.height;
    const prop = a === "h" ? "width" : "height";
    const isMain = !!parent?.isFlex && ((parent.direction === "row") === (a === "h"));
    const isCross = !!parent?.isFlex && !isMain;
    if (val === "fill") {
      if (isMain) css["flex"] = "1 1 0";
      else if (isCross) css["align-self"] = "stretch";
      else css[prop] = "100%";
    } else if (typeof val === "number") {
      css[prop] = `${Math.round(val)}px`;
      if (isMain) css["flex"] = "0 0 auto";
    }
    // "auto" (HUG): leave unset -> content-sized
  };
  axis("h");
  axis("v");
}

function styleToCss(node: IRNode, parent: ParentCtx | null, isRoot = false, ambientColor?: string): Record<string, string> {
  const css: Record<string, string> = { ...flexLayoutToCss(node.layout) };
  const s = node.style;
  const isText = node.kind === "text";

  if (isText) {
    // labels/breadcrumbs: size to content, stay on one line (avoid fallback-font wrap).
    css["white-space"] = "nowrap";
    // Honor FILL (grow) so a title stretches and pushes trailing items — but never
    // pin a fixed width (that's what caused the wrapping bug).
    if (node.box.width === "fill") {
      if (parent?.isFlex && parent.direction === "row") css["flex"] = "1 1 0";
      else if (parent?.isFlex) css["align-self"] = "stretch";
      else css["width"] = "100%";
    }
  } else {
    applySizing(css, node, parent, isRoot);
  }
  if (node.box.alignSelf === "stretch" && !css["align-self"]) css["align-self"] = "stretch";

  if (isRoot) {
    css["position"] = "relative";
    css["left"] = "0";
    css["top"] = "0";
  } else if (!parent?.isFlex && (node.box.x || node.box.y)) {
    css["position"] = "absolute";
    css["left"] = `${Math.round(node.box.x)}px`;
    css["top"] = `${Math.round(node.box.y)}px`;
  }

  // Suppress fill-as-background on exported vectors (the SVG carries its own color).
  const bg = s.fills.find((f) => f.type === "solid" || f.type === "linear-gradient");
  if (bg && !isText && !node.asset) css["background"] = bg.color;

  // A themed (currentColor) icon needs `color` on its own wrapper to render at all —
  // otherwise it inherits the browser default (often black) and vanishes against a
  // dark background. Prefer the icon's own resolved fill (captured before it became
  // an asset); fall back to the same color already applied to a sibling text node in
  // this row, since icon + label are almost always meant to match.
  if (node.asset?.svg) {
    const iconColor = bg?.color ?? ambientColor;
    if (iconColor) css["color"] = iconColor;
  }

  if (s.strokes[0]) {
    const st = s.strokes[0];
    const prop = st.side && st.side !== "all" ? `border-${st.side}` : "border";
    css[prop] = `${st.width}px solid ${st.color}`;
  }
  const radius = cornerRadiusCss(s.cornerRadius);
  if (radius) css["border-radius"] = radius;
  if (s.effects.length) {
    css["box-shadow"] = s.effects
      .map((e) => `${e.type === "inner-shadow" ? "inset " : ""}${e.x}px ${e.y}px ${e.blur}px ${e.spread}px ${e.color}`)
      .join(", ");
  }
  if (s.opacity < 1) css["opacity"] = String(s.opacity);

  if (s.typography) {
    const t = s.typography;
    css["font-family"] = `'${t.fontFamily}', sans-serif`;
    css["font-size"] = `${t.fontSize}px`;
    css["font-weight"] = String(t.fontWeight);
    css["line-height"] = t.lineHeight === "normal" ? "normal" : `${t.lineHeight}px`;
    if (t.letterSpacing) css["letter-spacing"] = `${t.letterSpacing}px`;
    if (t.textAlign !== "left") css["text-align"] = t.textAlign;
    css["color"] = t.color;
  }
  return css;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function tagFor(node: IRNode): string {
  if (node.kind === "text") return "span";
  if (node.kind === "image") return "img";
  return "div";
}

interface EmitCtx {
  seen: Map<string, number>;
  rules: Map<string, Record<string, string>>;
  fields: Array<{ name: string; literal: string }>;
  fieldSeen: Set<string>;
}

function uniqueField(base: string, ctx: EmitCtx): string {
  let name = base || "field";
  if (!/^[a-zA-Z_$]/.test(name)) name = `_${name}`;
  let out = name;
  let i = 2;
  while (ctx.fieldSeen.has(out)) out = `${name}${i++}`;
  ctx.fieldSeen.add(out);
  return out;
}

function bindingsFor(props: Record<string, string> | undefined, valueExpr: (k: string) => string): string {
  return Object.keys(props ?? {})
    .map((k) => `[${k}]="${valueExpr(k)}"`)
    .join(" ");
}

function emitNode(node: IRNode, ctx: EmitCtx, depth: number, parent: ParentCtx | null, ambientColor?: string): string {
  const pad = "  ".repeat(depth + 2);

  // 1. Reuse: matched to a library component (Figma variants -> [input] bindings).
  if (node.componentMatch) {
    const { target, props } = node.componentMatch;
    const attrs = bindingsFor(props, (k) => quote(props![k]));
    return `${pad}<${target}${attrs ? " " + attrs : ""}></${target}>`;
  }

  const cls = classFor(node, ctx.seen);
  ctx.rules.set(cls, styleToCss(node, parent, false, ambientColor));

  // 2. Exported asset: inline SVG / reference image (replaces the empty box).
  if (node.asset?.svg) {
    return `${pad}<span class="${cls}" aria-label="${escapeHtml(node.name)}">${node.asset.svg}</span>`;
  }
  if (node.asset?.url || node.kind === "image") {
    const src = node.asset?.url ?? `assets/${cls}.png`;
    return `${pad}<img class="${cls}" src="${src}" alt="${escapeHtml(node.name)}" />`;
  }

  // 3. Text -> bind to a class field (data-driven, not hardcoded markup).
  if (node.kind === "text") {
    const field = uniqueField(CAMEL(cls), ctx);
    ctx.fields.push({ name: field, literal: quote(node.text ?? "") });
    return `${pad}<span class="${cls}">{{ ${field} }}</span>`;
  }

  // 4. Container.
  const tag = tagFor(node);
  if (node.children.length === 0) return `${pad}<${tag} class="${cls}"></${tag}>`;
  const selfCtx: ParentCtx = { isFlex: node.layout.mode === "flex", direction: node.layout.direction };
  const inner = emitChildren(node.children, ctx, depth + 1, selfCtx);
  return `${pad}<${tag} class="${cls}">\n${inner}\n${pad}</${tag}>`;
}

/** Emit children, collapsing runs of repeated reused components into a single *ngFor. */
function emitChildren(children: IRNode[], ctx: EmitCtx, depth: number, parent: ParentCtx | null): string {
  // A themed icon among these siblings should match whatever color the sibling text
  // in this same row resolves to (nav/tab items: icon + label, meant to match).
  const ambientColor = children.map((c) => c.style.typography?.color).find((c): c is string => !!c);
  const out: string[] = [];
  let i = 0;
  while (i < children.length) {
    const node = children[i];
    const target = node.componentMatch?.target;
    if (target) {
      let j = i + 1;
      while (j < children.length && children[j].componentMatch?.target === target) j++;
      if (j - i >= 2) {
        out.push(emitComponentLoop(children.slice(i, j), ctx, depth));
        i = j;
        continue;
      }
    }
    out.push(emitNode(node, ctx, depth, parent, ambientColor));
    i++;
  }
  return out.join("\n");
}

/** A run of repeated reused components -> `<x *ngFor="let item of data" [k]="item.k">` + a data array. */
function emitComponentLoop(run: IRNode[], ctx: EmitCtx, depth: number): string {
  const pad = "  ".repeat(depth + 2);
  const target = run[0].componentMatch!.target;
  const keys = new Set<string>();
  run.forEach((n) => Object.keys(n.componentMatch!.props ?? {}).forEach((k) => keys.add(k)));
  const items = run.map((n) => {
    const obj: Record<string, string> = {};
    for (const k of keys) obj[k] = n.componentMatch!.props?.[k] ?? "";
    return obj;
  });
  const base = CAMEL(target.replace(/^app-/, "")) + "s";
  const field = uniqueField(base, ctx);
  ctx.fields.push({ name: field, literal: `[${items.map(objLiteral).join(", ")}]` });
  const bindings = bindingsFor(run[0].componentMatch!.props, (k) => `item.${k}`);
  return `${pad}<${target} *ngFor="let item of ${field}"${bindings ? " " + bindings : ""}></${target}>`;
}

function rulesToScss(rules: Map<string, Record<string, string>>): string {
  const blocks: string[] = [];
  for (const [cls, css] of rules) {
    const decls = Object.entries(css).map(([k, v]) => `  ${k}: ${v};`).join("\n");
    blocks.push(`.${cls} {\n${decls}\n}`);
  }
  return blocks.join("\n\n") + "\n";
}

function collectImports(node: IRNode, out: Set<string>): void {
  if (node.componentMatch) out.add(node.componentMatch.target);
  node.children.forEach((c) => collectImports(c, out));
}

function collectFonts(node: IRNode, out: Set<string>): void {
  const fam = node.style.typography?.fontFamily;
  if (fam) out.add(fam);
  node.children.forEach((c) => collectFonts(c, out));
}

export function generateAngular(doc: IRDocument): AngularComponent {
  const className = PASCAL(doc.screen);
  const selector = `app-${KEBAB(doc.screen)}`;
  const ctx: EmitCtx = { seen: new Map(), rules: new Map(), fields: [], fieldSeen: new Set() };

  let html: string;
  if (doc.root.componentMatch) {
    html = emitNode(doc.root, ctx, -2, null).trimStart() + "\n";
  } else {
    const rootCls = classFor(doc.root, ctx.seen);
    ctx.rules.set(rootCls, styleToCss(doc.root, null, true));
    const rootCtx: ParentCtx = { isFlex: doc.root.layout.mode === "flex", direction: doc.root.layout.direction };
    const childrenHtml = emitChildren(doc.root.children, ctx, 0, rootCtx);
    html = `<div class="${rootCls}">\n${childrenHtml}\n</div>\n`;
  }

  // Local (reused) component imports — convention: ./x/x.component
  const reused = [...new Set<string>((() => {
    const s = new Set<string>();
    collectImports(doc.root, s);
    return s;
  })())].sort();
  const localImportStatements = reused
    .map((sel) => {
      const base = sel.replace(/^app-/, "");
      return `import { ${PASCAL(base)}Component } from './${base}/${base}.component';`;
    })
    .join("\n");
  const reusedClasses = reused.map((sel) => PASCAL(sel.replace(/^app-/, "")) + "Component");

  const importLines = localImportStatements;
  const importsArray = ["CommonModule", ...reusedClasses].join(", ");
  const classBody = ctx.fields.length
    ? "\n" + ctx.fields.map((f) => `  ${f.name} = ${f.literal};`).join("\n") + "\n"
    : "";

  const ts = `import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';${importLines ? "\n" + importLines : ""}

@Component({
  selector: '${selector}',
  standalone: true,
  imports: [${importsArray}],
  templateUrl: './${KEBAB(doc.screen)}.component.html',
  styleUrls: ['./${KEBAB(doc.screen)}.component.scss'],
})
export class ${className}Component {${classBody}}
`;

  const scss = rulesToScss(ctx.rules);
  const styleBytes = Buffer.byteLength(scss, "utf8");
  const fontSet = new Set<string>();
  collectFonts(doc.root, fontSet);
  const fonts = [...fontSet].sort();

  const ANGULAR_STYLE_BUDGET = 4096;
  const styleBudgetNote =
    styleBytes > ANGULAR_STYLE_BUDGET
      ? `Generated SCSS is ${(styleBytes / 1024).toFixed(1)} KB, over Angular's default 4 KB anyComponentStyle budget. Raise it in angular.json (budgets: anyComponentStyle) or split the styles.`
      : undefined;

  return { className, selector, files: { ts, html, scss }, styleBytes, fonts, styleBudgetNote };
}
