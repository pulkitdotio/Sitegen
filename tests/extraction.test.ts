import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium } from 'playwright';
import type { Browser } from 'playwright';
import { extractPage } from '../server/extract.js';
import { inspectWebsite } from '../server/inspect.js';

describe('rendered fixture extraction', () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch({ chromiumSandbox: true });
  });
  afterAll(async () => {
    await browser?.close();
  });
  it('extracts visible content, safe links, images and computed styles', async () => {
    const page = await browser.newPage({ javaScriptEnabled: false });
    await page.route(/.*/, (route) => route.abort());
    await page.setContent(
      '<title>Local fixture</title><main style="color:rgb(20, 30, 40)"><h1>Hello &amp; welcome</h1><p>Useful content</p><p hidden>Hidden</p><a href="javascript:alert(1)">Unsafe link</a><img src="https://example.com/a.png" alt="Test image"><button onclick="alert(1)">Static action</button><script>alert(1)</script></main>',
    );
    const model = await extractPage(page, 'https://example.com');
    const serialized = JSON.stringify(model);
    expect(model.title).toBe('Local fixture');
    expect(model.nodes[0].tag).toBe('main');
    expect(model.nodes[0].styles.color).toBe('rgb(20, 30, 40)');
    expect(serialized).toContain('Hello & welcome');
    expect(serialized).not.toContain('Hidden');
    expect(serialized).not.toContain('javascript:');
    expect(serialized).not.toContain('onclick');
    expect(serialized).not.toContain('alert');
    await page.close();
  });
  it('caps depth, node count, and content on large or unusual HTML', async () => {
    const page = await browser.newPage({ javaScriptEnabled: false });
    await page.setContent(`<main><h1>A large page</h1>${'<p>content</p>'.repeat(1000)}</main>`);
    const model = await extractPage(page, 'https://example.com');
    expect(model.nodeCount).toBeLessThanOrEqual(350);
    expect(model.warnings.join(' ')).toContain('limits');
    await page.close();
  });
  it('fails clearly for empty or unsupported pages', async () => {
    const page = await browser.newPage();
    await page.setContent('<main></main>');
    await expect(extractPage(page, 'https://example.com')).rejects.toMatchObject({
      code: 'EMPTY_PAGE',
    });
    await page.close();
  });
  it('preserves inline whitespace and standalone body text', async () => {
    const page = await browser.newPage();
    await page.setContent('Standalone body text<p>Hello <em>world</em>!</p>');
    const model = await extractPage(page, 'https://example.com');
    expect(model.nodes[0].children[0].text).toBe('Standalone body text');
    expect(model.nodes[1].children[0].text).toBe('Hello ');
    expect(model.nodes[1].children[1].tag).toBe('span');
    await page.close();
  });
  it('renders the offline demo through the real extraction pipeline with a screenshot', async () => {
    const { model, screenshot } = await inspectWebsite('', true);
    expect(model.title).toBe('Forma — Space for good work');
    expect(model.nodeCount).toBeGreaterThan(30);
    expect(JSON.stringify(model.nodes)).toContain('Good work starts');
    expect(screenshot).toMatch(/^data:image\/png;base64,/);
  });
  it('blocks an unsafe URL before attempting a browser launch', async () => {
    await expect(inspectWebsite('http://127.0.0.1')).rejects.toMatchObject({ code: 'UNSAFE_URL' });
  });
});
