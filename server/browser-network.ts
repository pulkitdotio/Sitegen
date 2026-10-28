import { createServer } from 'node:http';
import type { Socket } from 'node:net';
import { AppError } from './errors.js';

// A second boundary for speculative/preconnect traffic and anything missed by
// interception. No DNS lookup or upstream connection ever happens here.
export async function createDenyProxy() {
  let blocked = 0;
  const sockets = new Set<Socket>();
  const server = createServer((_req, res) => {
    blocked++;
    res.writeHead(403, { Connection: 'close', 'Content-Type': 'text/plain' });
    res.end('Direct browser network access is blocked by Sitegen.');
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('error', () => undefined);
    socket.on('close', () => sockets.delete(socket));
  });
  for (const event of ['connect', 'upgrade'] as const) {
    server.on(event, (_req, socket) => {
      blocked++;
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    });
  }
  server.headersTimeout = 3000;
  server.requestTimeout = 3000;
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
  } catch {
    throw new AppError(
      'ISOLATION_UNAVAILABLE',
      'The browser network guard could not start. Inspection was stopped safely.',
      503,
    );
  }
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new AppError('ISOLATION_UNAVAILABLE', 'The browser network guard is unavailable.', 503);
  return {
    url: `http://127.0.0.1:${address.port}`,
    get blockedRequests() {
      return blocked;
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
