import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { unzipSync } from 'fflate';
import { createApp } from '../server/app.js';
import { AppError } from '../server/errors.js';
import { fixture } from './fixture.js';

describe('local API', () => {
  it('enforces host and origin restrictions', async () => {
    const app = createApp();
    expect((await request(app).get('/api/health').set('Host', 'evil.example')).status).toBe(403);
    expect(
      (await request(app).get('/api/health').set('Origin', 'https://evil.example')).status,
    ).toBe(403);
    expect((await request(app).get('/api/health').set('Sec-Fetch-Site', 'cross-site')).status).toBe(
      403,
    );
    expect(
      (await request(app).get('/api/health').set('Origin', 'http://127.0.0.1:5173')).status,
    ).toBe(200);
  });
  it('requires reproduction permission', async () => {
    const inspect = vi.fn();
    const response = await request(createApp(inspect))
      .post('/api/generate')
      .send({ url: 'https://example.com' });
    expect(response.status).toBe(422);
    expect(inspect).not.toHaveBeenCalled();
  });
  it('returns safe errors without stack traces and releases its concurrency slot', async () => {
    const inspect = vi
      .fn()
      .mockRejectedValueOnce(new Error('secret stack'))
      .mockResolvedValueOnce({ model: fixture, screenshot: null });
    const app = createApp(inspect);
    const failed = await request(app).post('/api/demo').send({});
    expect(failed.status).toBe(502);
    expect(JSON.stringify(failed.body)).not.toContain('secret');
    expect((await request(app).post('/api/demo').send({})).status).toBe(200);
  });
  it('preserves useful known errors', async () => {
    const app = createApp(async () => {
      throw new AppError('BROWSER_UNAVAILABLE', 'Sandboxed browser unavailable.', 503);
    });
    const response = await request(app).post('/api/demo').send({});
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('BROWSER_UNAVAILABLE');
  });
  it('rejects invalid JSON, oversized JSON, unsupported content types, and absent URLs', async () => {
    const app = createApp();
    expect(
      (await request(app).post('/api/demo').set('Content-Type', 'application/json').send('{'))
        .status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .post('/api/demo')
          .send({ long: 'x'.repeat(5000) })
      ).status,
    ).toBe(400);
    expect((await request(app).post('/api/demo').type('form').send('demo=true')).status).toBe(415);
    expect(
      (await request(app).post('/api/generate').send({ permission: true })).body.error.code,
    ).toBe('INVALID_URL');
  });
  it('generates actual files and exports a downloadable ZIP', async () => {
    const inspect = vi.fn(async () => ({ model: fixture, screenshot: null }));
    const app = createApp(inspect);
    const result = await request(app)
      .post('/api/generate')
      .send({ url: 'https://example.com', permission: true });
    expect(result.status).toBe(200);
    expect(result.body.files).toHaveLength(9);
    expect(result.body.isDemo).toBe(false);
    expect(inspect).toHaveBeenCalledWith('https://example.com', false);
    const download = await request(app)
      .get(`/api/projects/${result.body.id}/download`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });
    expect(download.status).toBe(200);
    expect(Object.keys(unzipSync(download.body))).toContain('sitegen-export/src/App.tsx');
    expect((await request(app).get('/api/projects/missing/download')).status).toBe(404);
  });
  it('permits only one concurrent inspection', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const app = createApp(async () => {
      entered();
      await pending;
      return { model: fixture, screenshot: null };
    });
    const first = request(app)
      .post('/api/demo')
      .send({})
      .then((result) => result);
    await started;
    expect((await request(app).post('/api/demo').send({})).status).toBe(429);
    release();
    expect((await first).status).toBe(200);
  });
});
