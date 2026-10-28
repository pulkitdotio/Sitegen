import express from 'express';
import type { RequestHandler } from 'express';
import { randomUUID } from 'node:crypto';
import { AppError, publicError } from './errors.js';
import { inspectWebsite } from './inspect.js';
import { generateProject, zipProject } from './generate.js';
import type { GeneratedProject } from '../shared/types.js';

export function createApp(inspect = inspectWebsite) {
  const app = express();
  app.disable('x-powered-by');
  const allowedHost = /^(127\.0\.0\.1|localhost)(:\d{1,5})?$/;
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!allowedHost.test(req.headers.host || '')) {
      res
        .status(403)
        .json({ error: { code: 'HOST_BLOCKED', message: 'The API only accepts loopback hosts.' } });
      return;
    }
    const origin = req.headers.origin;
    if (origin) {
      try {
        const source = new URL(origin);
        if (
          source.protocol !== 'http:' ||
          !allowedHost.test(source.host) ||
          ![req.headers.host, '127.0.0.1:5173', 'localhost:5173'].includes(source.host)
        )
          throw new Error();
      } catch {
        res.status(403).json({
          error: { code: 'ORIGIN_BLOCKED', message: 'Cross-site API requests are not allowed.' },
        });
        return;
      }
    }
    if (req.headers['sec-fetch-site'] === 'cross-site') {
      res.status(403).json({
        error: { code: 'ORIGIN_BLOCKED', message: 'Cross-site API requests are not allowed.' },
      });
      return;
    }
    next();
  });
  app.use(express.json({ limit: '4kb', strict: true }));
  let running = false;
  const projects = new Map<string, { project: GeneratedProject; expires: number }>();
  const prune = () => {
    for (const [id, entry] of projects) if (entry.expires < Date.now()) projects.delete(id);
  };
  app.get('/api/health', (_req, res) => res.json({ status: 'ok', mode: 'local-only' }));
  const generate: RequestHandler = async (req, res, next) => {
    if (running) {
      next(new AppError('BUSY', 'Another inspection is running. Try again when it finishes.', 429));
      return;
    }
    const demo = req.path === '/api/demo';
    if (!req.is('application/json')) {
      next(new AppError('INVALID_REQUEST', 'Send a JSON request.', 415));
      return;
    }
    if (!demo && req.body?.permission !== true) {
      next(
        new AppError(
          'PERMISSION_REQUIRED',
          'Confirm that you own this page or have permission to reproduce it.',
        ),
      );
      return;
    }
    if (!demo && typeof req.body?.url !== 'string') {
      next(new AppError('INVALID_URL', 'Enter a complete HTTP or HTTPS URL.'));
      return;
    }
    running = true;
    const started = Date.now();
    try {
      const { model, screenshot } = await inspect(demo ? '' : req.body.url, demo);
      const output = generateProject(model);
      const project: GeneratedProject = {
        id: randomUUID(),
        title: model.title,
        sourceUrl: model.url,
        isDemo: demo,
        files: output.files,
        previewHtml: output.previewHtml,
        screenshot,
        warnings: model.warnings,
        stats: {
          nodes: model.nodeCount,
          components: output.components,
          assets: output.assets,
          durationMs: Date.now() - started,
        },
      };
      prune();
      if (projects.size >= 3) projects.delete(projects.keys().next().value!);
      projects.set(project.id, { project, expires: Date.now() + 10 * 60 * 1000 });
      res.json(project);
    } catch (error) {
      next(error);
    } finally {
      running = false;
    }
  };
  app.post('/api/generate', generate);
  app.post('/api/demo', generate);
  app.get('/api/projects/:id/download', (req, res, next) => {
    prune();
    const entry = projects.get(req.params.id);
    if (!entry) {
      next(
        new AppError(
          'PROJECT_EXPIRED',
          'This export has expired. Generate the page again to download it.',
          404,
        ),
      );
      return;
    }
    res.setHeader('Content-Disposition', 'attachment; filename="sitegen-export.zip"');
    res.type('application/zip').send(Buffer.from(zipProject(entry.project.files)));
  });
  app.use('/api', (_req, res) =>
    res
      .status(404)
      .json({ error: { code: 'NOT_FOUND', message: 'This API endpoint does not exist.' } }),
  );
  app.use(
    (error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      const malformed =
        error instanceof SyntaxError ||
        (typeof error === 'object' &&
          error !== null &&
          'type' in error &&
          error.type === 'entity.too.large');
      const safe = malformed
        ? new AppError('INVALID_REQUEST', 'The request body is invalid or too large.', 400)
        : publicError(error);
      res.status(safe.status).json({ error: { code: safe.code, message: safe.message } });
    },
  );
  return app;
}
