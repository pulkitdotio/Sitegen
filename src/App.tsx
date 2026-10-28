import { useEffect, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  Code2,
  Command,
  ExternalLink,
  FileCode2,
  GitBranch as Github,
  Globe2,
  Info,
  Layers2,
  Link,
  LoaderCircle,
  Monitor,
  Moon,
  PanelLeftClose,
  Play,
  ScanLine,
  ShieldCheck,
  Smartphone,
  Sun,
  X,
} from 'lucide-react';
import { CodeViewer } from './CodeViewer';
import type { GeneratedProject } from '../shared/types';

type View = 'split' | 'preview' | 'code' | 'reference';
const initialTheme = () => {
  try {
    return localStorage.getItem('sitegen-theme') === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
};

function App() {
  const [theme, setTheme] = useState(initialTheme);
  const [url, setUrl] = useState('');
  const [permission, setPermission] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [project, setProject] = useState<GeneratedProject | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [view, setView] = useState<View>('split');
  const [mobile, setMobile] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const help = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('sitegen-theme', theme);
    } catch {
      /* Private browsing can disallow storage. */
    }
  }, [theme]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 4000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, []);

  async function generate(demo = false) {
    if (busyRef.current) return;
    setError('');
    if (!demo) {
      let parsed: URL;
      try {
        parsed = new URL(url.trim());
      } catch {
        setError('Enter a valid URL, including https://.');
        input.current?.focus();
        return;
      }
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        setError('Only HTTP and HTTPS URLs are supported.');
        return;
      }
      if (!permission) {
        setError('Please confirm that you have permission to reproduce this page.');
        return;
      }
    }
    busyRef.current = true;
    setBusy(true);
    controller.current = new AbortController();
    const timer = setTimeout(() => controller.current?.abort(), 32000);
    try {
      const response = await fetch(demo ? '/api/demo' : '/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(demo ? {} : { url: url.trim(), permission }),
        signal: controller.current.signal,
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(
          data.error?.message || 'The page could not be generated. Please try again.',
        );
      setProject(data);
      setView('split');
      setNotice(
        demo
          ? 'Demo generated from the bundled Forma fixture.'
          : 'Your React starting point is ready.',
      );
    } catch (caught) {
      setError(
        caught instanceof Error && caught.name === 'AbortError'
          ? 'The inspection timed out. Try a smaller page.'
          : caught instanceof TypeError
            ? 'Could not connect to the local API. Start both services with npm run dev.'
            : caught instanceof Error
              ? caught.message
              : 'Something went wrong. Try again.',
      );
    } finally {
      clearTimeout(timer);
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function download() {
    if (!project || downloading) return;
    setDownloading(true);
    try {
      const response = await fetch(`/api/projects/${project.id}/download`);
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error?.message || 'Download failed.');
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = 'sitegen-export.zip';
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      setNotice('Project downloaded. Unzip it and run npm install.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Download failed. Try again.');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <>
      <header className="app-header">
        <div className="header-inner">
          <a className="wordmark" href="/" aria-label="Sitegen home">
            <span className="logo">
              <Code2 size={20} strokeWidth={2.2} />
            </span>
            sitegen<span className="wordmark-dot">.</span>
          </a>
          <span className="header-divider" />
          <span className="header-tagline">From a URL to your next build.</span>
          <nav className="header-nav" aria-label="Main navigation">
            <button className="text-button" onClick={() => help.current?.showModal()}>
              How it works <ArrowUpRight size={13} />
            </button>
            <a
              className="github-link"
              href="https://github.com/pulkitdotio/sitegen"
              target="_blank"
              rel="noreferrer"
              aria-label="View Sitegen on GitHub"
            >
              <Github size={17} />
              <span>GitHub</span>
            </a>
            <span className="header-divider" />
            <button
              className="icon-button theme-toggle"
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            >
              {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
            </button>
          </nav>
        </div>
      </header>
      <main className="main-shell">
        <section className="hero" aria-labelledby="hero-heading">
          <div className="version-tag">
            <span className="live-dot" /> A small tool for big starting points <span>v0.1</span>
          </div>
          <h1 id="hero-heading">
            See a website.
            <br />
            Make it <span>your starting point.</span>
          </h1>
          <p className="hero-description">
            Turn a public page into clean, editable React code.
            <br className="desktop-break" /> Bring the structure. Make the rest your own.
          </p>
          <form
            className="url-form"
            onSubmit={(event) => {
              event.preventDefault();
              void generate();
            }}
            noValidate
          >
            <div className={`input-shell ${error ? 'has-error' : ''}`}>
              <Globe2 size={20} className="input-globe" />
              <label className="sr-only" htmlFor="website-url">
                Website URL
              </label>
              <input
                ref={input}
                id="website-url"
                type="url"
                placeholder="https://your-inspiration.com"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                disabled={busy}
                aria-invalid={!!error}
                aria-describedby={error ? 'generation-error' : 'url-hint'}
                autoComplete="url"
              />
              <kbd>
                <Command size={11} /> K
              </kbd>
              <button className="generate-button" type="submit" disabled={busy}>
                {busy ? (
                  <>
                    <LoaderCircle size={16} className="spin" /> Generating
                  </>
                ) : (
                  <>
                    Generate code <ArrowRight size={16} />
                  </>
                )}
              </button>
            </div>
            <div className="form-bottom">
              <label className="permission">
                <input
                  type="checkbox"
                  checked={permission}
                  onChange={(event) => setPermission(event.target.checked)}
                  disabled={busy}
                />
                <span>I own this page or have permission to reproduce it.</span>
              </label>
              <button
                className="demo-link"
                type="button"
                onClick={() => void generate(true)}
                disabled={busy}
              >
                <Play size={12} fill="currentColor" /> Try the demo <ArrowUpRight size={12} />
              </button>
            </div>
          </form>
          <div className="feature-row" id="url-hint">
            <span>
              <FileCode2 size={13} /> React + TypeScript
            </span>
            <i />
            <span>
              <ShieldCheck size={13} /> Local & private
            </span>
            <i />
            <span>
              <Code2 size={13} /> No API key needed
            </span>
          </div>
        </section>

        {error ? (
          <div className="error-banner" role="alert" id="generation-error">
            <Info size={17} />
            <span>{error}</span>
            <button className="icon-button" onClick={() => setError('')} aria-label="Dismiss error">
              <X size={15} />
            </button>
          </div>
        ) : null}

        <section
          className={`workspace ${busy ? 'is-loading' : ''}`}
          aria-label="Generation workspace"
          aria-busy={busy}
        >
          <div className="workspace-toolbar">
            <div className="workspace-title">
              <Layers2 size={16} />
              <span>Your workspace</span>
              <span className="workspace-badge">
                {busy
                  ? 'PROCESSING'
                  : project
                    ? project.isDemo
                      ? 'DEMO PROJECT'
                      : 'GENERATED'
                    : 'READY WHEN YOU ARE'}
              </span>
            </div>
            {project ? (
              <button
                className="download-button"
                onClick={() => void download()}
                disabled={busy || downloading}
              >
                {downloading ? (
                  <LoaderCircle size={14} className="spin" />
                ) : (
                  <ArrowDownToLine size={14} />
                )}
                <span>Download project</span>
                <span className="zip-tag">.zip</span>
              </button>
            ) : (
              <span className="workspace-caption">One page. A new possibility.</span>
            )}
          </div>
          {busy ? (
            <div className="loading-state" role="status">
              <div className="loading-orbit">
                <ScanLine size={27} className="scan-icon" />
              </div>
              <h2>Finding your starting point</h2>
              <p>Rendering, inspecting, and generating your React project.</p>
              <span className="loading-caption">
                <LoaderCircle size={12} className="spin" /> This can take up to 25 seconds
              </span>
            </div>
          ) : project ? (
            <>
              <div className="project-bar">
                <div className="project-source">
                  <span className="success-dot" />
                  <span>{project.title}</span>
                  <small>
                    {project.isDemo
                      ? 'Bundled original fixture'
                      : new URL(project.sourceUrl).hostname}
                  </small>
                </div>
                <div className="project-metadata">
                  <span>{project.stats.components} components</span>
                  <span>{project.files.length} files</span>
                  <span>{(project.stats.durationMs / 1000).toFixed(1)}s</span>
                </div>
              </div>
              <div className="view-toolbar">
                <div className="view-tabs" role="group" aria-label="Workspace view">
                  {(
                    [
                      { key: 'split', label: 'Split view', icon: <PanelLeftClose size={14} /> },
                      { key: 'preview', label: 'Preview', icon: <Monitor size={14} /> },
                      { key: 'code', label: 'Code', icon: <Code2 size={14} /> },
                      { key: 'reference', label: 'Reference', icon: <ScanLine size={14} /> },
                    ] as const
                  ).map((tab) => (
                    <button
                      key={tab.key}
                      className={view === tab.key ? 'active' : ''}
                      aria-pressed={view === tab.key}
                      onClick={() => setView(tab.key)}
                    >
                      {tab.icon}
                      {tab.label}
                    </button>
                  ))}
                </div>
                {view === 'split' || view === 'preview' ? (
                  <div className="device-toggle" role="group" aria-label="Preview size">
                    <button
                      className={!mobile ? 'active' : ''}
                      onClick={() => setMobile(false)}
                      aria-label="Desktop preview"
                      aria-pressed={!mobile}
                    >
                      <Monitor size={15} />
                    </button>
                    <button
                      className={mobile ? 'active' : ''}
                      onClick={() => setMobile(true)}
                      aria-label="Mobile preview"
                      aria-pressed={mobile}
                    >
                      <Smartphone size={15} />
                    </button>
                  </div>
                ) : (
                  <span className="static-label">
                    {view === 'reference' ? 'Original · 1280 × 900' : 'Editable after export'}
                  </span>
                )}
              </div>
              <div className={`workspace-content view-${view}`}>
                {view === 'split' || view === 'preview' ? (
                  <div className="preview-panel">
                    <div className="preview-address">
                      <span className="browser-dots">
                        <i />
                        <i />
                        <i />
                      </span>
                      <span>
                        <ShieldCheck size={11} /> generated-preview.local
                      </span>
                      <span className="preview-live">STATIC</span>
                    </div>
                    <div className={`preview-stage ${mobile ? 'mobile' : ''}`}>
                      <iframe
                        title="Generated page preview"
                        srcDoc={project.previewHtml}
                        sandbox=""
                        referrerPolicy="no-referrer"
                        className="generated-frame"
                      />
                    </div>
                  </div>
                ) : null}
                {view === 'split' || view === 'code' ? (
                  <CodeViewer key={project.id} files={project.files} onNotice={setNotice} />
                ) : null}
                {view === 'reference' ? (
                  <div className="reference-panel">
                    {project.screenshot ? (
                      <img
                        src={project.screenshot}
                        alt={`Original reference screenshot of ${project.title}`}
                      />
                    ) : (
                      <div className="reference-unavailable">
                        <ScanLine size={28} />
                        <p>A reference screenshot was not available for this page.</p>
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
              <div className="project-footer">
                <span>
                  <Check size={12} /> Generated from {project.stats.nodes} visible nodes
                </span>
                <span>Static output · no third-party scripts</span>
              </div>
            </>
          ) : (
            <div className="empty-workspace">
              <div className="empty-flow" aria-hidden="true">
                <span className="flow-icon">
                  <Link size={21} />
                </span>
                <span className="flow-line" />
                <span className="flow-center">
                  <Code2 size={24} />
                </span>
                <span className="flow-line" />
                <span className="flow-icon">
                  <FileCode2 size={21} />
                </span>
              </div>
              <h2>A fresh start, without the blank page.</h2>
              <p>
                Enter a URL above to explore the preview, inspect the code,
                <br className="desktop-break" /> and take an editable project with you.
              </p>
              <button className="empty-demo" onClick={() => void generate(true)}>
                Explore with the Forma demo <ArrowRight size={14} />
              </button>
              <div className="empty-bottom">
                <span>
                  <Monitor size={12} /> Live preview
                </span>
                <span>
                  <Code2 size={12} /> Readable code
                </span>
                <span>
                  <ArrowDownToLine size={12} /> Ready to export
                </span>
              </div>
            </div>
          )}
        </section>

        {project ? (
          <details className="generation-notes">
            <summary>
              <Info size={14} /> Generation notes <span>{project.warnings.length}</span>
              <ChevronRight size={14} />
            </summary>
            <ul>
              {project.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </details>
        ) : null}
        <section className="workflow-strip" aria-label="How Sitegen works">
          <div>
            <span className="step-number">01</span>
            <div>
              <h3>Bring a page</h3>
              <p>A public URL you have permission to use.</p>
            </div>
          </div>
          <ChevronRight className="step-arrow" size={15} />
          <div>
            <span className="step-number">02</span>
            <div>
              <h3>Find its structure</h3>
              <p>Layout, content, and style. Simplified.</p>
            </div>
          </div>
          <ChevronRight className="step-arrow" size={15} />
          <div>
            <span className="step-number">03</span>
            <div>
              <h3>Make it your own</h3>
              <p>Export real React code. Keep building.</p>
            </div>
          </div>
        </section>
        <aside className="limitations">
          <Info size={15} />
          <p>
            <strong>A starting point, by design.</strong> Sitegen creates an approximate static
            reconstruction. Complex interactions, backend features, protected pages, and
            JavaScript-only sites aren’t supported. Some CSS effects and assets may be simplified.
          </p>
          <button
            onClick={() => help.current?.showModal()}
            aria-label="Learn more about Sitegen limitations"
          >
            <ArrowUpRight size={16} />
          </button>
        </aside>
      </main>
      <footer className="app-footer">
        <span className="footer-brand">
          sitegen<span>.</span>
          <span className="footer-slogan">Built to be built on.</span>
        </span>
        <span className="footer-right">
          <span className="tiny-dot" /> Runs on your machine{' '}
          <a
            href="https://github.com/pulkitdotio/sitegen"
            target="_blank"
            rel="noreferrer"
            aria-label="Source code on GitHub"
          >
            <Github size={14} />
            <ExternalLink size={11} />
          </a>
        </span>
      </footer>
      <div className="toast" role="status" aria-live="polite">
        {notice ? (
          <>
            <Check size={15} />
            {notice}
          </>
        ) : null}
      </div>
      <dialog ref={help} className="help-dialog">
        <div className="dialog-heading">
          <span className="logo">
            <Code2 size={20} />
          </span>
          <h2>A page. A starting point.</h2>
          <button
            className="icon-button"
            onClick={() => help.current?.close()}
            aria-label="Close help"
          >
            <X size={18} />
          </button>
        </div>
        <p>
          Sitegen inspects one public page with sandboxed Chromium, extracts visible structure and
          computed styles, and turns them into a static React + TypeScript project.
        </p>
        <ol>
          <li>Enter a full HTTP or HTTPS URL and confirm you have permission.</li>
          <li>
            Compare the generated preview with the reference screenshot and inspect the files.
          </li>
          <li>
            Download the ZIP, unzip it, run <code>npm install</code>, then <code>npm run dev</code>.
          </li>
        </ol>
        <div className="dialog-note">
          <ShieldCheck size={19} />
          <p>
            Designed for local use. Private networks, page scripts, credentials, cookies, and
            authenticated pages are blocked. The bundled Forma demo runs offline through the same
            extraction and generation pipeline.
          </p>
        </div>
        <p className="dialog-limits">
          This is an approximate static reconstruction. Backend features and complex interactions
          cannot transfer. JavaScript-only sites are unsupported. Fonts, images, and CSS effects may
          be simplified. Buttons in the output are visual elements and remain disabled. Export links
          can lead to external websites.
        </p>
        <button className="generate-button dialog-button" onClick={() => help.current?.close()}>
          Got it <ArrowRight size={15} />
        </button>
      </dialog>
    </>
  );
}

export default App;
