import { afterEach, describe, expect, it, vi } from 'vitest';
import { chromium } from 'playwright';
import { createDenyProxy } from '../server/browser-network.js';
import * as security from '../server/security.js';
import { inspectWebsite } from '../server/inspect.js';

afterEach(() => vi.restoreAllMocks());

describe('browser network isolation', () => {
  it('validates and blocks a private subresource from a public document', async () => {
    const realFetch = security.fetchPublic;
    const html =
      '<!doctype html><title>Public fixture</title><link rel="stylesheet" href="http://169.254.169.254/private.css"><main><h1>A public page</h1><p>Visible content.</p></main>';
    const spy = vi.spyOn(security, 'fetchPublic').mockImplementation(async (value, budget) => {
      if (value === 'https://example.com/')
        return { url: value, status: 200, contentType: 'text/html', body: Buffer.from(html) };
      return realFetch(value, budget);
    });
    await expect(inspectWebsite('https://example.com/')).rejects.toMatchObject({
      code: 'UNSAFE_URL',
    });
    expect(spy).toHaveBeenCalledWith('http://169.254.169.254/private.css', expect.anything());
  });
  it('does not request source scripts or frames', async () => {
    const html =
      '<!doctype html><title>Safe fixture</title><main><h1>A public page</h1><p>Visible content.</p></main><script src="https://scripts.example.org/track.js"></script><iframe src="http://127.0.0.1/"></iframe>';
    const spy = vi.spyOn(security, 'fetchPublic').mockResolvedValue({
      url: 'https://example.com/',
      status: 200,
      contentType: 'text/html',
      body: Buffer.from(html),
    });
    const { model } = await inspectWebsite('https://example.com/');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(model)).not.toContain('track.js');
  });
  it('denies direct browser connections even to implicitly bypassed loopback addresses', async () => {
    const guard = await createDenyProxy();
    const browser = await chromium.launch({
      chromiumSandbox: true,
      proxy: { server: guard.url, bypass: '<-loopback>' },
    });
    try {
      const page = await browser.newPage({ javaScriptEnabled: false });
      const response = await page.goto('http://127.0.0.1:12345/');
      expect(response?.status()).toBe(403);
      expect(guard.blockedRequests).toBeGreaterThan(0);
      await expect(page.goto('https://example.com', { timeout: 3000 })).rejects.toThrow();
    } finally {
      await browser.close();
      await guard.close();
    }
  });
  it('rejects a visible authentication form without generating output', async () => {
    vi.spyOn(security, 'fetchPublic').mockResolvedValue({
      url: 'https://example.com/',
      status: 200,
      contentType: 'text/html',
      body: Buffer.from('<title>Account</title><h1>Members area</h1><input type="password">'),
    });
    await expect(inspectWebsite('https://example.com/')).rejects.toMatchObject({
      code: 'PAGE_BLOCKED',
    });
  });
});
