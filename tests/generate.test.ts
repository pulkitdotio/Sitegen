import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import ts from 'typescript';
import { generateProject, PREVIEW_CSP, zipProject } from '../server/generate.js';
import { fixture } from './fixture.js';

describe('deterministic project generation', () => {
  it('generates the same readable files from the same model', () => {
    expect(generateProject(fixture)).toEqual(generateProject(fixture));
    expect(
      generateProject(fixture).files.find((file) => file.path === 'src/App.tsx')?.content,
    ).toContain('function MainContent1()');
  });
  it('includes a complete independent Vite/React/TypeScript project', () => {
    const { files } = generateProject(fixture);
    expect(files.map((file) => file.path)).toEqual(
      expect.arrayContaining([
        'package.json',
        'index.html',
        'src/main.tsx',
        'src/App.tsx',
        'src/App.css',
        'src/index.css',
        'tsconfig.json',
        'README.md',
      ]),
    );
    const pkg = JSON.parse(files[0].content);
    expect(pkg.scripts.build).toContain('vite build');
    expect(pkg.dependencies.react).toBeTruthy();
    expect(pkg.license).toBeUndefined();
  });
  it('uses generated output for the preview with no executable scripts or remote images', () => {
    const { previewHtml } = generateProject(fixture);
    expect(previewHtml).toContain('A useful starting point');
    expect(previewHtml).toContain('Content-Security-Policy');
    expect(previewHtml).not.toMatch(/<script|<iframe|onclick=|src="https?:/i);
    expect(PREVIEW_CSP).toContain("script-src 'none'");
    expect(PREVIEW_CSP).toContain("connect-src 'none'");
  });
  it('escapes hostile page text, attributes, titles, and CSS without breaking TSX', () => {
    const model = structuredClone(fixture);
    const attack =
      '</style><script>alert("owned")</script>{`inject`} & <img src=x onerror=alert(1)>';
    model.title = attack;
    model.nodes[0].children[0].text = attack;
    model.nodes[0].styles.color = 'red;}body{background:url(http://127.0.0.1)}';
    model.nodes[0].children[3].href = 'javascript:alert(1)';
    const { files, previewHtml } = generateProject(model);
    const source = files.find((file) => file.path === 'src/App.tsx')!.content;
    const result = ts.transpileModule(source, {
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
      reportDiagnostics: true,
      fileName: 'App.tsx',
    });
    expect(result.diagnostics).toHaveLength(0);
    expect(previewHtml).not.toContain('<script>');
    expect(previewHtml).toContain('&lt;script&gt;');
    expect(source).not.toContain('javascript:');
    expect(files.find((file) => file.path === 'src/App.css')!.content).not.toContain('url(');
  });
  it('embeds safe raster images and replaces remote images with placeholders', () => {
    const model = structuredClone(fixture);
    model.nodes[0].children.push({
      tag: 'img',
      src: 'https://example.com/tracker.svg',
      alt: 'Missing "image"',
      styles: {},
      children: [],
    });
    const { files, previewHtml } = generateProject(model);
    expect(previewHtml).toContain('Image unavailable');
    expect(previewHtml).not.toContain('src="https://');
    expect(files.find((file) => file.path === 'README.md')!.content).toContain(
      'No remote images or fonts',
    );
  });
  it('makes buttons static in both preview and export', () => {
    const output = generateProject(fixture);
    expect(output.previewHtml).toContain('type="button" disabled');
    expect(output.files.find((file) => file.path === 'src/App.tsx')!.content).toContain(
      'type="button" disabled',
    );
  });
  it('preserves safe section identifiers and keeps fragment links in the page', () => {
    const model = structuredClone(fixture);
    model.nodes[0].id = 'content';
    model.nodes[0].children[3].href = '#content';
    const source = generateProject(model).files.find(
      (file) => file.path === 'src/App.tsx',
    )!.content;
    expect(source).toContain('id={"content"}');
    expect(source).toContain('href={"#content"}>');
  });
  it('creates a ZIP containing only generated project files', () => {
    const { files } = generateProject(fixture);
    const archive = unzipSync(zipProject(files));
    expect(Object.keys(archive)).toHaveLength(files.length);
    expect(strFromU8(archive['sitegen-export/src/App.tsx'])).toBe(
      files.find((file) => file.path === 'src/App.tsx')!.content,
    );
    expect(Object.keys(archive).join(' ')).not.toMatch(/cookie|\.env|profile|LICENSE|COPYING/);
  });
});
