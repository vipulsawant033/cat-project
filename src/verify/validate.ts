/**
 * One-shot pixel-diff validation. Render the generated component headless,
 * screenshot it, and diff against the Figma ground-truth PNG (Dev Mode get_image
 * or REST /images). REPORT ONLY — no automatic re-emit. Ship score + diff mask
 * so fidelity is visible and auditable. (The closed refinement loop is a
 * deliberate future upgrade, not built here.)
 */

import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface ValidateInput {
  /** self-contained HTML to render (component markup + inlined scss + fonts). */
  html: string;
  /** exact frame width in CSS px; height auto unless provided. */
  width: number;
  height?: number;
  /** ground-truth Figma PNG (url or data) */
  figmaImage: { url?: string; buffer?: Buffer };
  /** where to write the diff mask png (optional) */
  diffOut?: string;
  /** device scale factor to match the exported Figma scale (default 2). */
  scale?: number;
  /** pixelmatch per-pixel threshold 0..1 (default 0.1). */
  threshold?: number;
}

export interface ValidateResult {
  /** 1 - mismatchedPixels/totalPixels */
  score: number;
  mismatchedPixels: number;
  totalPixels: number;
  width: number;
  height: number;
  diffPath?: string;
  /** convenience pass/fail against a caller bar */
  pass?: boolean;
}

async function loadPng(input: { url?: string; buffer?: Buffer }): Promise<PNG> {
  let buf: Buffer;
  if (input.buffer) buf = input.buffer;
  else if (input.url) {
    const res = await fetch(input.url);
    if (!res.ok) throw new Error(`Failed to fetch Figma image: ${res.status}`);
    buf = Buffer.from(await res.arrayBuffer());
  } else throw new Error("figmaImage requires url or buffer");
  return PNG.sync.read(buf);
}

/** Nearest-neighbour resize so the two rasters share dimensions before diffing. */
function resizeTo(src: PNG, w: number, h: number): PNG {
  if (src.width === w && src.height === h) return src;
  const dst = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    const sy = Math.min(src.height - 1, Math.floor((y / h) * src.height));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(src.width - 1, Math.floor((x / w) * src.width));
      const di = (y * w + x) * 4;
      const si = (sy * src.width + sx) * 4;
      dst.data[di] = src.data[si];
      dst.data[di + 1] = src.data[si + 1];
      dst.data[di + 2] = src.data[si + 2];
      dst.data[di + 3] = src.data[si + 3];
    }
  }
  return dst;
}

export async function codegenValidate(input: ValidateInput): Promise<ValidateResult> {
  const scale = input.scale ?? 2;
  const threshold = input.threshold ?? 0.1;

  // Lazy import so the MCP server can start without Playwright installed until
  // validation is actually requested.
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  let renderedBuf: Buffer;
  try {
    const page = await browser.newPage({
      viewport: { width: input.width, height: input.height ?? 800 },
      deviceScaleFactor: scale,
    });
    await page.setContent(input.html, { waitUntil: "networkidle" });
    // clip to content if height not fixed
    renderedBuf = await page.screenshot({ fullPage: input.height == null });
  } finally {
    await browser.close();
  }

  const rendered = PNG.sync.read(renderedBuf);
  const figma = await loadPng(input.figmaImage);

  const w = Math.min(rendered.width, figma.width);
  const h = Math.min(rendered.height, figma.height);
  const a = resizeTo(rendered, w, h);
  const b = resizeTo(figma, w, h);

  const diff = new PNG({ width: w, height: h });
  const mismatched = pixelmatch(a.data, b.data, diff.data, w, h, { threshold });
  const totalPixels = w * h;
  const score = Number((1 - mismatched / totalPixels).toFixed(4));

  let diffPath: string | undefined;
  if (input.diffOut) {
    mkdirSync(dirname(input.diffOut), { recursive: true });
    writeFileSync(input.diffOut, PNG.sync.write(diff));
    diffPath = input.diffOut;
  }

  return { score, mismatchedPixels: mismatched, totalPixels, width: w, height: h, diffPath };
}
