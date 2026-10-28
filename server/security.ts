import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';
import { AppError } from './errors.js';

export const LIMITS = Object.freeze({
  totalMs: 25000,
  requestMs: 6000,
  maxRequests: 70,
  maxRedirects: 5,
  resourceBytes: 2 * 1024 * 1024,
  totalBytes: 12 * 1024 * 1024,
  maxNodes: 350,
  maxDepth: 12,
  maxScan: 6000,
  maxText: 50000,
});

export function parsePublicUrl(value: unknown): URL {
  if (
    typeof value !== 'string' ||
    value.length > 2048 ||
    Array.from(value).some(
      (char) => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127 || char === '\\',
    )
  ) {
    throw new AppError('INVALID_URL', 'Enter a complete HTTP or HTTPS URL without spaces.');
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AppError('INVALID_URL', 'Enter a valid URL, including https://.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || !/^https?:\/\//i.test(value)) {
    throw new AppError('INVALID_URL', 'Only HTTP and HTTPS pages are supported.');
  }
  if (url.username || url.password)
    throw new AppError('UNSAFE_URL', 'URLs containing credentials are not supported.');
  if (
    Array.from(url.searchParams.keys()).some((key) =>
      /^(access_token|token|auth|authorization|api_?key|password|secret|session_?id|jwt|signature|x-amz-(credential|signature)|x-goog-(credential|signature))$/i.test(
        key,
      ),
    )
  ) {
    throw new AppError(
      'UNSAFE_URL',
      'URLs containing credential-like query parameters are not supported.',
    );
  }
  if (url.port && !['80', '443'].includes(url.port))
    throw new AppError('UNSAFE_URL', 'Only standard web ports 80 and 443 are supported.');
  const host = url.hostname
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase();
  if (
    !host ||
    /(^|\.)(localhost|local|internal|home|lan|test|invalid|onion)$/.test(host) ||
    (!host.includes('.') && !isIP(host))
  ) {
    throw new AppError('UNSAFE_URL', 'Local and non-public network addresses are blocked.');
  }
  if (isIP(host) && !isPublicAddress(host))
    throw new AppError('UNSAFE_URL', 'Only public internet addresses are allowed.');
  url.hash = '';
  return url;
}

export function isPublicAddress(address: string): boolean {
  try {
    const parsed = ipaddr.parse(address);
    if (parsed.range() !== 'unicast') return false;
    if (parsed.kind() === 'ipv4') {
      const excluded = [
        '192.0.0.0/24',
        '192.0.2.0/24',
        '198.51.100.0/24',
        '203.0.113.0/24',
        '198.18.0.0/15',
        '192.88.99.0/24',
      ];
      return !excluded.some((cidr) => parsed.match(ipaddr.parseCIDR(cidr)));
    }
    return (
      parsed.match(ipaddr.parseCIDR('2000::/3')) &&
      !parsed.match(ipaddr.parseCIDR('2001::/23')) &&
      !parsed.match(ipaddr.parseCIDR('2002::/16'))
    );
  } catch {
    return false;
  }
}

export type Resolver = (hostname: string) => Promise<{ address: string; family: number }[]>;
const systemResolve: Resolver = (hostname) => lookup(hostname, { all: true, verbatim: true });

export async function resolvePublic(url: URL, resolver: Resolver = systemResolve) {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const records = isIP(host)
      ? [{ address: host, family: isIP(host) }]
      : await Promise.race([
          resolver(host),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () =>
                reject(
                  new AppError('DNS_FAILED', 'The website address could not be resolved in time.'),
                ),
              3000,
            );
          }),
        ]);
    if (!records.length || records.some((record) => !isPublicAddress(record.address))) {
      throw new AppError(
        'UNSAFE_URL',
        'The website resolves to a non-public address and has been blocked.',
      );
    }
    return records[0];
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      'DNS_FAILED',
      'The website address could not be resolved. Check the URL and try again.',
    );
  } finally {
    clearTimeout(timer);
  }
}

export interface Budget {
  requests: number;
  bytes: number;
  signal: AbortSignal;
}
export interface Resource {
  url: string;
  status: number;
  contentType: string;
  body: Buffer;
  location?: string;
}
export type Transport = (
  url: URL,
  address: { address: string; family: number },
  budget: Budget,
) => Promise<Resource>;

// The connection uses the validated IP, never a second DNS lookup. Host and TLS
// servername still use the original hostname, so normal certificate checks apply.
export const pinnedRequest: Transport = (url, address, budget) =>
  new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    const request = client.request(
      {
        protocol: url.protocol,
        hostname: address.address,
        family: address.family,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        servername: isIP(url.hostname.replace(/^\[|\]$/g, '')) ? undefined : url.hostname,
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        agent: false,
        signal: budget.signal,
        maxHeaderSize: 16384,
        headers: {
          Host: url.host,
          'User-Agent': 'Sitegen/0.1 (local static page inspector)',
          Accept: '*/*',
          'Accept-Encoding': 'identity',
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        const encoding = response.headers['content-encoding'];
        if (encoding && encoding !== 'identity') {
          response.destroy();
          reject(
            new AppError(
              'UNSUPPORTED_ENCODING',
              'The server requires an unsupported compressed response.',
            ),
          );
          return;
        }
        response.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          budget.bytes += chunk.length;
          if (bytes > LIMITS.resourceBytes || budget.bytes > LIMITS.totalBytes) {
            const error = new AppError(
              'RESOURCE_LIMIT',
              'This page exceeds the inspection size limit. Try a smaller page.',
            );
            // A short response can emit end before socket destruction emits
            // an error. Reject now so an exceeded budget never looks successful.
            reject(error);
            request.destroy(error);
          } else chunks.push(chunk);
        });
        response.on('end', () =>
          resolve({
            url: url.href,
            status: response.statusCode ?? 502,
            contentType: response.headers['content-type'] ?? 'application/octet-stream',
            body: Buffer.concat(chunks),
            location: response.headers.location,
          }),
        );
        response.on('error', reject);
      },
    );
    const timer = setTimeout(
      () => request.destroy(new AppError('TIMEOUT', 'The website took too long to respond.')),
      LIMITS.requestMs,
    );
    request.on('close', () => clearTimeout(timer));
    request.on('error', (error) =>
      reject(
        error instanceof AppError
          ? error
          : new AppError(
              'NETWORK_FAILED',
              'The website could not be reached securely. Check its availability and try again.',
            ),
      ),
    );
    request.end();
  });

export async function fetchPublic(
  value: string,
  budget: Budget,
  resolver?: Resolver,
  transport: Transport = pinnedRequest,
): Promise<Resource> {
  let current = value;
  const seen = new Set<string>();
  for (let hop = 0; hop <= LIMITS.maxRedirects; hop++) {
    if (budget.signal.aborted)
      throw new AppError('TIMEOUT', 'Inspection reached its time limit. Try a simpler page.');
    const url = parsePublicUrl(current);
    if (seen.has(url.href)) throw new AppError('REDIRECT_LOOP', 'The page has a redirect loop.');
    seen.add(url.href);
    if (++budget.requests > LIMITS.maxRequests)
      throw new AppError('RESOURCE_LIMIT', 'The page requires too many network requests.');
    const address = await resolvePublic(url, resolver);
    const result = await transport(url, address, budget);
    if ([301, 302, 303, 307, 308].includes(result.status)) {
      if (!result.location)
        throw new AppError('BAD_REDIRECT', 'The website returned an invalid redirect.');
      try {
        current = new URL(result.location, url).href;
      } catch {
        throw new AppError('BAD_REDIRECT', 'The website returned an invalid redirect.');
      }
      continue;
    }
    return result;
  }
  throw new AppError('REDIRECT_LIMIT', 'The page redirects too many times.');
}
