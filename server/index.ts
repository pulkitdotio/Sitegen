import express from 'express';
import { resolve } from 'node:path';
import { createApp } from './app.js';

const app = createApp();
if (process.env.NODE_ENV === 'production' || process.argv[1]?.includes('dist')) {
  const client = resolve('dist/client');
  app.use(express.static(client, { dotfiles: 'deny' }));
  app.get('/', (_req, res) => res.sendFile(resolve(client, 'index.html')));
}
const port = Number(process.env.PORT || 3001);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('PORT must be an integer between 1024 and 65535.');
const server = app.listen(port, '127.0.0.1', () =>
  console.log(`Sitegen API · http://127.0.0.1:${port} · local use only`),
);
server.requestTimeout = 30000;
server.headersTimeout = 10000;
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    server.close();
  });
