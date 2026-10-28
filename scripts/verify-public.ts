import assert from 'node:assert/strict';
import { fetchPublic } from '../server/security.js';
import { inspectWebsite } from '../server/inspect.js';
import { generateProject } from '../server/generate.js';

const resource = await fetchPublic('https://example.com', {
  requests: 0,
  bytes: 0,
  signal: AbortSignal.timeout(10000),
});
assert.equal(resource.status, 200);
const { model, screenshot } = await inspectWebsite('https://example.com');
const output = generateProject(model);
assert(model.nodeCount > 0);
assert(screenshot);
assert(output.previewHtml.includes('documentation'));
console.log(
  `Verified public HTTPS inspection: ${model.title}, ${model.nodeCount} nodes, ${output.files.length} generated files, reference screenshot captured.`,
);
