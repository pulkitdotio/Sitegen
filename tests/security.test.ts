import { describe, expect, it, vi } from 'vitest';
import {
  fetchPublic,
  isPublicAddress,
  LIMITS,
  parsePublicUrl,
  resolvePublic,
} from '../server/security.js';
import type { Budget, Resource, Transport } from '../server/security.js';

const budget = (): Budget => ({ requests: 0, bytes: 0, signal: new AbortController().signal });
const resolver = vi.fn(async () => [{ address: '93.184.215.14', family: 4 }]);
const resource = (url: string, status = 200, location?: string): Resource => ({
  url,
  status,
  location,
  contentType: 'text/html',
  body: Buffer.from('hello'),
});

describe('URL validation', () => {
  it('rejects credential-like query parameters', () => {
    expect(() => parsePublicUrl('https://example.com?access_token=secret')).toThrow(
      'credential-like',
    );
    expect(() => parsePublicUrl('https://example.com?X-Amz-Signature=secret')).toThrow(
      'credential-like',
    );
  });
  it.each([
    'https://example.com/',
    'http://example.com/a?q=b',
    'https://8.8.8.8/',
    'https://[2606:4700:4700::1111]/',
  ])('allows a public URL: %s', (value) =>
    expect(parsePublicUrl(value).protocol).toMatch(/^https?:$/),
  );
  it.each([
    'file:///etc/passwd',
    'ftp://example.com',
    'javascript:alert(1)',
    'data:text/html,test',
    'example.com',
    'https://',
    'https:/example.com',
    'https://user:secret@example.com',
    'http://example.com:8080',
    'http://localhost',
    'http://a.localhost',
    'http://metadata.google.internal',
    'http://foo.local',
    'http://127.0.0.1',
    'http://127.1',
    'http://2130706433',
    'http://0x7f000001',
    'http://169.254.169.254/latest/meta-data/',
    'http://10.0.0.1',
    'http://[::1]',
    'http://[::ffff:127.0.0.1]',
    'https://example.com/with space',
    'https://example.com\\@127.0.0.1',
    undefined,
    42,
  ])('rejects invalid or unsafe URLs: %s', (value) =>
    expect(() => parsePublicUrl(value)).toThrow(),
  );
});

describe('public address classification', () => {
  it.each([
    '0.0.0.0',
    '10.1.2.3',
    '100.64.0.1',
    '127.0.0.2',
    '169.254.1.1',
    '172.16.0.1',
    '192.168.0.1',
    '192.0.0.1',
    '192.0.2.1',
    '198.18.0.1',
    '198.51.100.2',
    '203.0.113.2',
    '224.0.0.1',
    '240.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    '::ffff:8.8.8.8',
    'fc00::1',
    'fe80::1',
    'ff02::1',
    '2001:db8::1',
    '2002:7f00:1::',
    '2001::1',
    'invalid',
  ])('blocks %s', (address) => expect(isPublicAddress(address)).toBe(false));
  it.each(['1.1.1.1', '8.8.8.8', '93.184.215.14', '2606:4700:4700::1111'])(
    'accepts %s',
    (address) => expect(isPublicAddress(address)).toBe(true),
  );
  it('rejects a mixed public/private DNS answer', async () => {
    await expect(
      resolvePublic(new URL('https://example.com'), async () => [
        { address: '1.1.1.1', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ]),
    ).rejects.toMatchObject({ code: 'UNSAFE_URL' });
  });
  it('returns understandable DNS errors', async () => {
    await expect(
      resolvePublic(new URL('https://example.com'), async () => {
        throw new Error('internal DNS details');
      }),
    ).rejects.toMatchObject({ code: 'DNS_FAILED' });
  });
});

describe('redirect and network boundary', () => {
  it('pins the transport to the exact address validated by DNS', async () => {
    const transport = vi.fn<Transport>(async (url) => resource(url.href));
    await fetchPublic('https://example.com', budget(), resolver, transport);
    expect(transport.mock.calls[0][1]).toEqual({ address: '93.184.215.14', family: 4 });
  });
  it('validates every redirect and refuses private destinations before connecting', async () => {
    const transport = vi.fn<Transport>(async (url) =>
      resource(url.href, 302, 'http://169.254.169.254/'),
    );
    await expect(
      fetchPublic('https://example.com', budget(), resolver, transport),
    ).rejects.toMatchObject({ code: 'UNSAFE_URL' });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('rejects a public hostname rebinding to private space on the next hop', async () => {
    const dns = vi
      .fn()
      .mockResolvedValueOnce([{ address: '1.1.1.1', family: 4 }])
      .mockResolvedValueOnce([{ address: '10.0.0.1', family: 4 }]);
    const transport = vi.fn<Transport>(async (url) => resource(url.href, 302, '/next'));
    await expect(
      fetchPublic('https://example.com', budget(), dns, transport),
    ).rejects.toMatchObject({ code: 'UNSAFE_URL' });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('handles relative redirects without forwarding a 3xx response to Chromium', async () => {
    const transport = vi
      .fn<Transport>()
      .mockImplementationOnce(async (url) => resource(url.href, 302, '/about'))
      .mockImplementationOnce(async (url) => resource(url.href));
    const result = await fetchPublic('https://example.com', budget(), resolver, transport);
    expect(result.url).toBe('https://example.com/about');
    expect(result.status).toBe(200);
  });
  it('detects redirect loops', async () => {
    await expect(
      fetchPublic('https://example.com', budget(), resolver, async (url) =>
        resource(url.href, 301, '/'),
      ),
    ).rejects.toMatchObject({ code: 'REDIRECT_LOOP' });
  });
  it('limits redirect depth', async () => {
    let n = 0;
    await expect(
      fetchPublic('https://example.com', budget(), resolver, async (url) =>
        resource(url.href, 302, `/${++n}`),
      ),
    ).rejects.toMatchObject({ code: 'REDIRECT_LIMIT' });
  });
  it('limits network requests', async () => {
    await expect(
      fetchPublic('https://example.com', { ...budget(), requests: LIMITS.maxRequests }, resolver),
    ).rejects.toMatchObject({ code: 'RESOURCE_LIMIT' });
  });
  it('refuses requests after the deadline', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      fetchPublic('https://example.com', { ...budget(), signal: controller.signal }, resolver),
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
  });
});
