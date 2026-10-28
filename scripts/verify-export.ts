import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { inspectWebsite } from '../server/inspect.js';
import { generateProject } from '../server/generate.js';

const root = resolve('.verification/export');
// Only touch this owned, ignored test directory.
assert.equal(relative(resolve('.verification'), root), 'export');
await rm(root, { recursive: true, force: true });
const { model } = await inspectWebsite('', true);
const { files } = generateProject(model);
for (const file of files) {
  const path = resolve(root, file.path);
  assert(!relative(root, path).startsWith('..'));
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, file.content, 'utf8');
}
const npmCli = resolve('node_modules/npm/bin/npm-cli.js');
// npm_execpath is provided by npm run; invoke its JS entry without a shell.
const cli = process.env.npm_execpath || npmCli;
for (const args of [
  ['install', '--no-audit', '--no-fund'],
  ['run', 'build'],
]) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, stdio: 'inherit' });
  assert.equal(result.status, 0, `Export ${args.join(' ')} failed`);
}
console.log(
  'Verified: an independent project generated from the rendered Forma fixture installs and builds.',
);
