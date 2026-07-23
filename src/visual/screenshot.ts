import { chromium, type Browser } from 'playwright';

/**
 * Lazily-launched, process-lifetime-shared headless Chromium instance — mirrors
 * preview/manager.ts's approach to `ng serve`: launch once, reuse across calls,
 * close explicitly on process shutdown (see shutdownBrowser).
 */
let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium.launch({ headless: true }).catch((err: unknown) => {
      browserPromise = null;
      throw new Error(
        `Failed to launch headless Chromium: ${err instanceof Error ? err.message : String(err)}. ` +
          'Run "npx playwright install chromium" once, then try again.'
      );
    });
  }
  return browserPromise;
}

/** Extra viewport headroom beyond the target element's own size, so content sitting flush against the viewport edge never triggers a scrollbar that would eat into the element's own rendered width/height. */
const VIEWPORT_PADDING = 100;

/**
 * Screenshots one element (by CSS selector) on a page. Uses deviceScaleFactor 1
 * so the captured pixels match a scale=1 Figma PNG export 1:1 — mismatched
 * scale factors would make every pixel comparison meaningless. The viewport is
 * intentionally larger than the requested size (see VIEWPORT_PADDING) and
 * scrolling is disabled — an element screenshot captures only the element's
 * own box regardless of surrounding viewport space, so this is free margin,
 * not a source of error.
 */
export async function captureElementScreenshot(
  url: string,
  selector: string,
  viewportWidth: number,
  viewportHeight: number
): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage({
    viewport: {
      width: Math.max(Math.round(viewportWidth), 1) + VIEWPORT_PADDING,
      height: Math.max(Math.round(viewportHeight), 1) + VIEWPORT_PADDING,
    },
    deviceScaleFactor: 1,
  });
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 30_000 });
    await page.addStyleTag({ content: 'html, body { margin: 0; overflow: hidden; }' });
    const locator = page.locator(selector).first();
    await locator.waitFor({ state: 'visible', timeout: 15_000 });

    // ng serve's live-reload can still be mid-rebuild the instant we navigate — if so, the
    // element renders unstyled (uncapped width) until the reload actually lands. Rather than
    // guess a single fixed delay, measure the rendered box and reload+retry if it's clearly
    // not width-constrained yet, instead of screenshotting a known-stale render.
    const widthTolerance = Math.max(viewportWidth * 0.15, 20);
    const attempts = 6;
    for (let attempt = 0; attempt < attempts; attempt++) {
      await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
      await page.waitForTimeout(attempt === 0 ? 800 : 2_000);
      const box = await locator.boundingBox();
      if (box && box.width <= viewportWidth + widthTolerance) break;
      if (attempt < attempts - 1) await page.reload({ waitUntil: 'load', timeout: 30_000 });
    }

    return await locator.screenshot({ type: 'png' });
  } finally {
    await page.close();
  }
}

/** Closes the shared browser, if one was launched. Call on process shutdown alongside shutdownPreview. */
export async function shutdownBrowser(): Promise<void> {
  if (!browserPromise) return;
  const browser = await browserPromise.catch(() => null);
  await browser?.close();
  browserPromise = null;
}
