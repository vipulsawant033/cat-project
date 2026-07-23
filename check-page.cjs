const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));
  const resp = await page.goto('http://localhost:4300/', { waitUntil: 'networkidle', timeout: 30000 });
  console.log('status:', resp.status());
  await page.waitForTimeout(1500);
  const bodyHTML = await page.evaluate(() => document.querySelector('app-root') ? document.querySelector('app-root').innerHTML.length : -1);
  const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 300));
  console.log('app-root innerHTML length:', bodyHTML);
  console.log('body text sample:', JSON.stringify(bodyText));
  console.log('CONSOLE ERRORS:', JSON.stringify(errors, null, 2));
  await page.screenshot({ path: 'preview-screenshot.png', fullPage: true });
  await browser.close();
})();
