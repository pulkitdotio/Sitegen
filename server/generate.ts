import { strToU8, zipSync } from 'fflate';
import type { GeneratedFile, PageModel, PageNode } from '../shared/types.js';

export const PREVIEW_CSP =
  "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  );
const literal = (value: string) =>
  JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
const safeScalar = (value: string) =>
  value.length < 240 && !/[{};<>\\@]/.test(value) && !/url\s*\(|expression|var\s*\(/i.test(value);
const safeImage = (value?: string) =>
  !!value &&
  /^data:image\/(png|jpeg|webp|gif);base64,[a-zA-Z0-9+/=]+$/.test(value) &&
  value.length < 360000;
const safeHref = (value?: string) => {
  if (!value) return undefined;
  if (value.startsWith('#')) return value;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
};
const tags = new Set([
  'header',
  'nav',
  'main',
  'section',
  'article',
  'aside',
  'footer',
  'div',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'a',
  'img',
  'button',
  'ul',
  'ol',
  'li',
  'span',
  'blockquote',
  'hr',
  'br',
  'figure',
  'figcaption',
]);

export function generateProject(model: PageModel): {
  files: GeneratedFile[];
  previewHtml: string;
  components: number;
  assets: number;
} {
  let index = 0;
  let assetCount = 0;
  const rules: string[] = [];
  const render = (node: PageNode, level: number): { jsx: string; html: string } => {
    const tag = tags.has(node.tag) ? node.tag : 'div';
    const className = `sg-${++index}`;
    const declarations = Object.entries(node.styles)
      .filter(([key, value]) => /^[a-z-]+$/.test(key) && safeScalar(value))
      .map(([key, value]) => `  ${key}: ${value};`);
    if (declarations.length) rules.push(`.${className} {\n${declarations.join('\n')}\n}`);
    const pad = '  '.repeat(level);
    let jsxAttrs = ` className="${className}"`;
    let htmlAttrs = ` class="${className}"`;
    if (node.id && /^[a-zA-Z][\w-]{0,79}$/.test(node.id)) {
      jsxAttrs += ` id={${literal(node.id)}}`;
      htmlAttrs += ` id="${escapeHtml(node.id)}"`;
    }
    if (tag === 'button') {
      jsxAttrs += ' type="button" disabled title="Static visual element"';
      htmlAttrs += ' type="button" disabled title="Static visual element"';
    }
    if (tag === 'a') {
      const href = safeHref(node.href);
      if (href)
        jsxAttrs += ` href={${literal(href)}}${href.startsWith('#') ? '' : ' target="_blank" rel="noopener noreferrer"'}`;
      // Preview links are inert; the export retains safe public links.
      htmlAttrs += ' title="Links are inactive in the preview"';
    }
    if (tag === 'img') {
      if (safeImage(node.src)) {
        assetCount++;
        return {
          jsx: `${pad}<img${jsxAttrs} src={${literal(node.src!)}} alt={${literal(node.alt || '')}} loading="lazy" />`,
          html: `<img${htmlAttrs} src="${escapeHtml(node.src!)}" alt="${escapeHtml(node.alt || '')}" loading="lazy">`,
        };
      }
      return {
        jsx: `${pad}<div${jsxAttrs} role="img" aria-label={${literal(node.alt || 'Image unavailable')}}><span>Image unavailable</span></div>`,
        html: `<div${htmlAttrs} role="img" aria-label="${escapeHtml(node.alt || 'Image unavailable')}"><span>Image unavailable</span></div>`,
      };
    }
    if (['br', 'hr'].includes(tag))
      return { jsx: `${pad}<${tag}${jsxAttrs} />`, html: `<${tag}${htmlAttrs}>` };
    const children = node.children.map((child) => render(child, level + 1));
    const ownText = node.text ? `{${literal(node.text)}}` : '';
    const htmlText = node.text ? escapeHtml(node.text) : '';
    return {
      jsx: children.length
        ? `${pad}<${tag}${jsxAttrs}>${ownText}\n${children.map((child) => child.jsx).join('\n')}\n${pad}</${tag}>`
        : `${pad}<${tag}${jsxAttrs}>${ownText}</${tag}>`,
      html: `<${tag}${htmlAttrs}>${htmlText}${children.map((child) => child.html).join('')}</${tag}>`,
    };
  };
  // Top-level regions become named, independently editable components.
  const regions = model.nodes.map((node, i) => ({
    name: `${({ header: 'PageHeader', nav: 'Navigation', main: 'MainContent', footer: 'PageFooter', section: 'Section' } as Record<string, string>)[node.tag] || 'PageRegion'}${i + 1}`,
    ...render(node, 2),
  }));
  const app = `import './App.css';\n\n// Static reconstruction by Sitegen. Edit these regions to make it your own.\n${regions.map((region) => `function ${region.name}() {\n  return (\n${region.jsx}\n  );\n}`).join('\n\n')}\n\nexport default function App() {\n  return (\n    <div className="sitegen-page">\n${regions.map((region) => `      <${region.name} />`).join('\n')}\n    </div>\n  );\n}\n`;
  const bodyColor = safeScalar(model.color) ? model.color : '#252525';
  const background =
    safeScalar(model.background) && model.background !== 'rgba(0, 0, 0, 0)'
      ? model.background
      : '#ffffff';
  const fontFamily = safeScalar(model.fontFamily) ? model.fontFamily : 'Arial, sans-serif';
  const baseCss = `* { box-sizing: border-box; }\nbody { margin: 0; background: ${background}; color: ${bodyColor}; font-family: ${fontFamily}; }\n.sitegen-page { overflow-wrap: anywhere; overflow-x: clip; min-height: 100vh; }\nimg { max-width: 100%; height: auto; }\nbutton:disabled { opacity: 1; cursor: default; }\n[role="img"] { min-height: 100px; background: #e8e8e8; color: #666; display: grid; place-items: center; }\n`;
  const appCss = `${rules.join('\n\n')}\n\n/* Responsive approximations; adjust for your content. */\n@media (max-width: 640px) {\n  .sitegen-page [class^="sg-"] { max-width: 100%; }\n  .sitegen-page section, .sitegen-page header, .sitegen-page footer { padding-left: 20px; padding-right: 20px; }\n  .sitegen-page h1 { font-size: clamp(32px, 9vw, 48px); line-height: 1.1; letter-spacing: -1px; }\n  .sitegen-page h2 { max-width: 100%; }\n  ${rules
    .filter((rule) => rule.includes('display: grid') || rule.includes('display: flex'))
    .map(
      (rule) =>
        `${rule.split(' {')[0]} { flex-wrap: wrap; grid-template-columns: 1fr; gap: 16px; }`,
    )
    .join('\n  ')}\n}\n`;
  const title = escapeHtml(model.title);
  const files: GeneratedFile[] = [
    {
      path: 'package.json',
      language: 'json',
      content:
        JSON.stringify(
          {
            name: 'sitegen-export',
            version: '0.1.0',
            private: true,
            type: 'module',
            scripts: { dev: 'vite', build: 'tsc --noEmit && vite build', preview: 'vite preview' },
            dependencies: { react: '^19.3.1', 'react-dom': '^19.3.1' },
            devDependencies: {
              vite: '^8.3.5',
              typescript: '^6.0.2',
              '@types/react': '^19.2.0',
              '@types/react-dom': '^19.2.0',
            },
            engines: { node: '>=22.12.0' },
          },
          null,
          2,
        ) + '\n',
    },
    {
      path: 'index.html',
      language: 'html',
      content: `<!doctype html>\n<html lang="en">\n<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${title}</title><meta name="referrer" content="no-referrer"></head>\n<body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body>\n</html>\n`,
    },
    {
      path: 'src/main.tsx',
      language: 'typescript',
      content: `import { StrictMode } from 'react';\nimport { createRoot } from 'react-dom/client';\nimport App from './App';\nimport './index.css';\n\ncreateRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);\n`,
    },
    { path: 'src/App.tsx', language: 'typescript', content: app },
    { path: 'src/App.css', language: 'css', content: appCss },
    { path: 'src/index.css', language: 'css', content: baseCss },
    {
      path: 'tsconfig.json',
      language: 'json',
      content:
        JSON.stringify(
          {
            compilerOptions: {
              target: 'ES2022',
              lib: ['ES2022', 'DOM', 'DOM.Iterable'],
              module: 'ESNext',
              moduleResolution: 'Bundler',
              jsx: 'react-jsx',
              strict: true,
              noEmit: true,
              skipLibCheck: true,
              types: ['vite/client'],
            },
            include: ['src'],
          },
          null,
          2,
        ) + '\n',
    },
    { path: '.gitignore', language: 'markdown', content: 'node_modules/\ndist/\n.env\n.env.*\n' },
    {
      path: 'README.md',
      language: 'markdown',
      content: `# ${model.title.replace(/[\r\n]/g, ' ')}\n\nStatic React reconstruction created with Sitegen.\n\n## Run locally\n\nRequires Node.js 22.12+ and npm.\n\n\`\`\`sh\nnpm install\nnpm run dev\n\`\`\`\n\nRun \`npm run build\` for a production build.\n\n## Editing\n\nEdit the region components in \`src/App.tsx\` and their numbered CSS rules in \`src/App.css\`. Shared resets live in \`src/index.css\`.\n\n## Source and limitations\n\nSource URL (untrusted page metadata): ${JSON.stringify(model.url)}\n\nUse this output only where you have permission to reproduce the source. This is an approximate starting point, not a complete reproduction. Scripts, backend functionality, forms, tracking, and authentication were not copied. Buttons are intentionally disabled. Safe links remain external links; review them before use. Font names may refer to fonts not installed on your system; browser fallbacks apply. Small raster images are embedded; missing, oversized, SVG, and unsupported images use placeholders. No remote images or fonts are loaded by this project. CSS effects, responsive behavior, and layouts may be approximated.\n\n${model.warnings.map((warning) => `- ${warning.replace(/[\r\n]/g, ' ')}`).join('\n')}\n`,
    },
  ];
  const previewHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${escapeHtml(PREVIEW_CSP)}"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${baseCss}\n${appCss}</style></head><body><div class="sitegen-page">${regions.map((region) => region.html).join('\n')}</div></body></html>`;
  return { files, previewHtml, components: regions.length, assets: assetCount };
}

export function zipProject(files: GeneratedFile[]): Uint8Array {
  return zipSync(
    Object.fromEntries(files.map((file) => [`sitegen-export/${file.path}`, strToU8(file.content)])),
    { level: 6 },
  );
}
