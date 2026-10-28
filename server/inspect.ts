import { chromium } from 'playwright';
import type { Browser } from 'playwright';
import { DEMO_HTML, DEMO_URL } from './demo.js';
import { extractPage } from './extract.js';
import { AppError } from './errors.js';
import { createDenyProxy } from './browser-network.js';
import { fetchPublic, LIMITS, parsePublicUrl } from './security.js';
import type { Budget, Resource } from './security.js';
import type { PageModel, PageNode } from '../shared/types.js';

const DOCUMENT_CSP =
  "default-src 'none'; script-src 'none'; style-src 'unsafe-inline' http: https:; img-src http: https: data:; font-src http: https:; frame-src 'none'; object-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'";
export interface Inspection {
  model: PageModel;
  screenshot: string | null;
}

export async function inspectWebsite(input: string, demo = false): Promise<Inspection> {
  if (!demo) parsePublicUrl(input);
  const controller = new AbortController();
  const budget: Budget = { requests: 0, bytes: 0, signal: controller.signal };
  let browser: Browser | undefined;
  let networkGuard: Awaited<ReturnType<typeof createDenyProxy>> | undefined;
  let expired = false;
  const timer = setTimeout(() => {
    expired = true;
    controller.abort();
    void browser?.close().catch(() => undefined);
  }, LIMITS.totalMs);
  const assets = new Map<string, string>();
  let blockedResources = 0;
  let fatalError: AppError | undefined;
  try {
    const document: Resource = demo
      ? {
          url: DEMO_URL,
          status: 200,
          contentType: 'text/html; charset=utf-8',
          body: Buffer.from(DEMO_HTML),
        }
      : await fetchPublic(input, budget);
    if ([401, 403, 407, 429].includes(document.status))
      throw new AppError(
        'PAGE_BLOCKED',
        'This website blocks automated access or requires authentication. Protected pages are unsupported.',
      );
    if (document.status >= 400)
      throw new AppError(
        'PAGE_UNAVAILABLE',
        `The website returned HTTP ${document.status}. Try another publicly accessible page.`,
      );
    if (!/^text\/html\b|^application\/xhtml\+xml\b/i.test(document.contentType))
      throw new AppError(
        'UNSUPPORTED_PAGE',
        'This URL does not return an HTML page. PDFs, downloads, and media URLs are unsupported.',
      );
    try {
      networkGuard = await createDenyProxy();
      browser = await chromium.launch({
        headless: true,
        chromiumSandbox: true,
        timeout: 8000,
        proxy: { server: networkGuard.url, bypass: '<-loopback>' },
        args: [
          '--disable-background-networking',
          '--disable-component-update',
          '--disable-sync',
          '--no-first-run',
          '--dns-prefetch-disable',
          '--disable-quic',
          '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
        ],
      });
    } catch {
      throw new AppError(
        'BROWSER_UNAVAILABLE',
        'Sandboxed Chromium could not start. Run npx playwright install chromium and check OS sandbox support. Sitegen will not disable the sandbox.',
        503,
      );
    }
    if (expired) throw new AppError('TIMEOUT', 'Inspection reached its time limit.');
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      deviceScaleFactor: 1,
      javaScriptEnabled: false,
      serviceWorkers: 'block',
      acceptDownloads: false,
      permissions: [],
      ignoreHTTPSErrors: false,
    });
    await context.routeWebSocket(/.*/, (route) => route.close());
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    let servedDocument = false;
    await context.route(/.*/, async (route) => {
      try {
        const request = route.request();
        const isMain = request.isNavigationRequest() && request.frame() === page.mainFrame();
        if (isMain && !servedDocument && request.url() === document.url) {
          servedDocument = true;
          await route.fulfill({
            status: 200,
            headers: {
              'content-type': 'text/html; charset=utf-8',
              'content-security-policy': DOCUMENT_CSP,
              'x-content-type-options': 'nosniff',
            },
            body: document.body,
          });
          return;
        }
        // Never pass traffic to Chromium's network stack. No route.continue(),
        // route.fetch(), browser-followed redirects, frames, scripts or cookies.
        if (
          demo ||
          request.method() !== 'GET' ||
          !['stylesheet', 'image', 'font'].includes(request.resourceType()) ||
          request.isNavigationRequest()
        ) {
          blockedResources++;
          await route.abort('blockedbyclient');
          return;
        }
        const resource = await fetchPublic(request.url(), budget);
        if (resource.status >= 300)
          throw new AppError('ASSET_FAILED', 'An external asset could not be loaded.');
        const mime = resource.contentType.split(';')[0].toLowerCase();
        const type = request.resourceType();
        if (
          (type === 'stylesheet' && mime !== 'text/css') ||
          (type === 'image' && !/^image\/(png|jpeg|webp|gif|avif|svg\+xml)$/.test(mime)) ||
          (type === 'font' && !/^(font\/|application\/(font|x-font|vnd.ms-fontobject))/.test(mime))
        ) {
          throw new AppError('ASSET_FAILED', 'An unsupported resource was omitted.');
        }
        if (/^image\/(png|jpeg|webp|gif)$/.test(mime) && resource.body.length < 256 * 1024)
          assets.set(request.url(), `data:${mime};base64,${resource.body.toString('base64')}`);
        await route.fulfill({
          status: 200,
          headers: {
            'content-type': resource.contentType,
            'x-content-type-options': 'nosniff',
            'content-security-policy': DOCUMENT_CSP,
          },
          body: resource.body,
        });
      } catch (error) {
        blockedResources++;
        if (
          error instanceof AppError &&
          ['RESOURCE_LIMIT', 'TIMEOUT', 'UNSAFE_URL'].includes(error.code)
        )
          fatalError = error;
        await route.abort('blockedbyclient').catch(() => undefined);
      }
    });
    await page.goto(document.url, { waitUntil: 'load', timeout: 15000 });
    if (fatalError) throw fatalError;
    const protectedPage = await page.evaluate(() => {
      const password = Array.from(
        globalThis.document.querySelectorAll('input[type="password"]'),
      ).some((input) => input.getBoundingClientRect().height > 0);
      const title = globalThis.document.title.toLowerCase();
      return (
        password ||
        /^(sign in|log in|login|just a moment|access denied|verify you are human|checking your browser)\b/.test(
          title,
        )
      );
    });
    if (protectedPage)
      throw new AppError(
        'PAGE_BLOCKED',
        'This page appears to require authentication or a browser challenge. Protected pages are unsupported.',
      );
    const model = await extractPage(page, document.url);
    const embedImages = (nodes: PageNode[]) =>
      nodes.forEach((node) => {
        if (node.tag === 'img') {
          const embedded = node.src && assets.get(node.src);
          node.src = embedded || undefined;
          if (!embedded)
            model.warnings.push(
              'An image was unavailable, unsupported, or over 256 KB and was replaced with a placeholder.',
            );
        }
        embedImages(node.children);
      });
    embedImages(model.nodes);
    model.warnings.push(
      'Approximate static reconstruction. Page scripts, backend behavior, and complex interactions are not transferred.',
    );
    if (blockedResources)
      model.warnings.push(
        `${blockedResources} resource(s) or navigation(s) were blocked or unavailable.`,
      );
    model.warnings = [...new Set(model.warnings)];
    let screenshot: string | null = null;
    try {
      screenshot = `data:image/png;base64,${(await page.screenshot({ type: 'png', fullPage: false, timeout: 3000, animations: 'disabled' })).toString('base64')}`;
    } catch {
      model.warnings.push('A reference screenshot could not be captured.');
    }
    if (fatalError) throw fatalError;
    if (expired) throw new AppError('TIMEOUT', 'Inspection reached its time limit.');
    return { model, screenshot };
  } catch (error) {
    if (expired)
      throw new AppError(
        'TIMEOUT',
        'Inspection reached its 25-second time limit. Try a smaller page.',
      );
    if (error instanceof AppError) throw error;
    throw new AppError(
      'NAVIGATION_FAILED',
      'The page could not be rendered within the inspection limits. Try a simpler public page.',
      422,
      { cause: error },
    );
  } finally {
    clearTimeout(timer);
    controller.abort();
    await browser?.close().catch(() => undefined);
    await networkGuard?.close();
  }
}
