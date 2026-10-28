import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const server = spawn(process.execPath, ['dist/server/server/index.js'], {
  env: { ...process.env, PORT: '3002', NODE_ENV: 'production' },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});
try {
  await Promise.race([
    once(server.stdout!, 'data'),
    once(server, 'exit').then(() => {
      throw new Error('Production server exited before readiness');
    }),
    new Promise<never>((_resolve, reject) =>
      setTimeout(() => reject(new Error('Production startup timed out')), 5000).unref(),
    ),
  ]);
  const base = 'http://127.0.0.1:3002';
  const page = await fetch(base);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<div id="root">/);
  const demo = await fetch(`${base}/api/demo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(demo.status, 200);
  const project = await demo.json();
  assert.equal(project.title, 'Forma — Space for good work');
  assert(project.previewHtml.includes('Good work starts'));
  const download = await fetch(`${base}/api/projects/${project.id}/download`);
  assert.equal(download.status, 200);
  assert.equal(download.headers.get('content-type'), 'application/zip');
  console.log(
    'Verified production build: static interface → API → offline browser extraction → generated project → ZIP.',
  );
} finally {
  if (server.exitCode === null && server.signalCode === null) {
    const exited = once(server, 'exit');
    server.kill();
    await exited;
  }
}
