import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { unzipSync, strFromU8 } from 'fflate';

// Run npm run dev in another terminal first. This checks the complete local flow.
await mkdir('.verification/screenshots', { recursive: true });
const browser = await chromium.launch({ chromiumSandbox: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('http://127.0.0.1:5173');
  await page.getByRole('heading', { name: /See a website/ }).waitFor();
  console.log(
    'UI ready:',
    await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
    })),
  );
  await page.screenshot({
    path: '.verification/screenshots/empty-desktop.png',
    fullPage: true,
    animations: 'disabled',
    timeout: 10000,
  });
  console.log('Captured empty workspace.');
  await page.getByRole('button', { name: 'Generate code' }).click();
  await page.getByRole('alert').waitFor();
  assert.match(await page.getByRole('alert').innerText(), /valid URL/);
  await page.getByRole('button', { name: 'Dismiss error' }).click();
  await page.getByRole('button', { name: 'Try the demo' }).click();
  await page.getByTitle('Generated page preview').waitFor({ timeout: 30000 });
  const preview = page.frameLocator('iframe');
  await preview.getByRole('heading', { name: 'Good work starts with a little space.' }).waitFor();
  assert.equal(await page.getByTitle('Generated page preview').getAttribute('sandbox'), '');
  await page
    .getByText('Demo generated from the bundled Forma fixture.', { exact: true })
    .waitFor({ state: 'hidden' });
  await page.screenshot({
    path: '.verification/screenshots/generated-desktop.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Code', exact: true }).click();
  await page.getByRole('button', { name: 'package.json', exact: true }).click();
  assert.match(await page.getByLabel('Code for package.json').innerText(), /sitegen-export/);
  await page.getByRole('button', { name: 'Copy package.json' }).click();
  await page.getByText('Copied package.json', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Reference', exact: true }).click();
  await page.getByAltText('Original reference screenshot of Forma — Space for good work').waitFor();
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await page.getByRole('button', { name: 'Mobile preview' }).click();
  assert.equal(
    await page
      .getByTitle('Generated page preview')
      .evaluate((element) => Math.round(element.getBoundingClientRect().width)),
    375,
  );
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: /Download project/ }).click();
  const download = await downloadEvent;
  assert.equal(download.suggestedFilename(), 'sitegen-export.zip');
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const files = unzipSync(Buffer.concat(chunks));
  assert.match(strFromU8(files['sitegen-export/src/App.tsx']), /Good work starts/);
  await page.getByRole('button', { name: 'How it works' }).click();
  await page.getByRole('dialog').waitFor();
  await page.getByRole('button', { name: 'Got it' }).click();
  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
  await page.screenshot({ path: '.verification/screenshots/generated-light.png', fullPage: true });
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Split view' }).click();
  await page.screenshot({ path: '.verification/screenshots/generated-mobile.png', fullPage: true });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
    false,
    'App must not overflow horizontally',
  );
  await page.getByLabel('Website URL').fill('http://127.0.0.1');
  await page.getByLabel('I own this page or have permission to reproduce it.').check();
  await page.getByRole('button', { name: 'Generate code' }).click();
  await page.getByRole('alert').waitFor();
  assert.match(await page.getByRole('alert').innerText(), /public internet|non-public|blocked/i);
  assert.deepEqual(errors, []);
  console.log(
    'Verified: demo → extraction → files → sandboxed preview → copy → ZIP; reference, device sizes, theme, help, validation, SSRF rejection, mobile layout; no browser errors.',
  );
} finally {
  await browser.close();
}
