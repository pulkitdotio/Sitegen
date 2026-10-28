import { createServer } from 'node:http';
import type { RequestListener } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { LIMITS, pinnedRequest } from '../server/security.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanups.splice(0)) await close();
});

// Intentional loopback harness for the low-level transport only. Public URL
// validation is tested separately and never permits this destination in the API.
async function fixtureServer(handler: RequestListener) {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture address');
  return new URL(`http://example.com:${address.port}/`);
}

describe('bounded HTTP transport', () => {
  it('sends no credentials and discards source cookies', async () => {
    const url = await fixtureServer((req, res) => {
      expect(req.headers.cookie).toBeUndefined();
      expect(req.headers.authorization).toBeUndefined();
      expect(req.headers.host).toContain('example.com');
      res.setHeader('Set-Cookie', 'private=source-cookie');
      res.end('Public content');
    });
    const result = await pinnedRequest(
      url,
      { address: '127.0.0.1', family: 4 },
      { requests: 0, bytes: 0, signal: AbortSignal.timeout(3000) },
    );
    expect(result.body.toString()).toBe('Public content');
    expect(JSON.stringify(result)).not.toContain('source-cookie');
  });

  it('stops an oversized resource', async () => {
    const url = await fixtureServer((_req, res) => res.end(Buffer.alloc(LIMITS.resourceBytes + 1)));
    await expect(
      pinnedRequest(
        url,
        { address: '127.0.0.1', family: 4 },
        { requests: 0, bytes: 0, signal: AbortSignal.timeout(3000) },
      ),
    ).rejects.toMatchObject({ code: 'RESOURCE_LIMIT' });
  });

  it('enforces the aggregate response budget', async () => {
    const url = await fixtureServer((_req, res) => res.end('Too much content'));
    await expect(
      pinnedRequest(
        url,
        { address: '127.0.0.1', family: 4 },
        { requests: 0, bytes: LIMITS.totalBytes - 1, signal: AbortSignal.timeout(3000) },
      ),
    ).rejects.toMatchObject({ code: 'RESOURCE_LIMIT' });
  });

  it('fails safely if a server insists on compressed content', async () => {
    const url = await fixtureServer((_req, res) => {
      res.setHeader('Content-Encoding', 'gzip');
      res.end('not decoded');
    });
    await expect(
      pinnedRequest(
        url,
        { address: '127.0.0.1', family: 4 },
        { requests: 0, bytes: 0, signal: AbortSignal.timeout(3000) },
      ),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_ENCODING' });
  });
});
