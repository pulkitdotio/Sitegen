import { useMemo, useState } from 'react';
import {
  Check,
  ChevronDown,
  Copy,
  FileCode2,
  FileJson,
  FileText,
  Folder,
  FolderOpen,
} from 'lucide-react';
import hljs from 'highlight.js/lib/core';
import typescript from 'highlight.js/lib/languages/typescript';
import css from 'highlight.js/lib/languages/css';
import json from 'highlight.js/lib/languages/json';
import xml from 'highlight.js/lib/languages/xml';
import markdown from 'highlight.js/lib/languages/markdown';
import type { GeneratedFile } from '../shared/types';

hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('css', css);
hljs.registerLanguage('json', json);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('markdown', markdown);

export function CodeViewer({
  files,
  onNotice,
}: {
  files: GeneratedFile[];
  onNotice: (value: string) => void;
}) {
  const [selected, setSelected] = useState('src/App.tsx');
  const [copied, setCopied] = useState(false);
  const file = files.find((item) => item.path === selected) || files[0];
  const lines = useMemo(
    () => hljs.highlight(file.content, { language: file.language }).value.trimEnd().split('\n'),
    [file],
  );
  async function copy() {
    try {
      await navigator.clipboard.writeText(file.content);
      setCopied(true);
      onNotice(`Copied ${file.path}`);
    } catch {
      onNotice('Copy failed. Select the code and copy it manually.');
    }
  }
  const choose = (path: string) => {
    setSelected(path);
    setCopied(false);
  };
  const icon = (path: string) =>
    path.endsWith('.json') ? (
      <FileJson size={13} />
    ) : path.endsWith('.md') ? (
      <FileText size={13} />
    ) : (
      <FileCode2 size={13} />
    );
  return (
    <div className="code-viewer">
      <aside className="file-explorer" aria-label="Generated files">
        <div className="explorer-label">
          EXPLORER <span>{files.length}</span>
        </div>
        <div className="folder-label">
          <ChevronDown size={12} />
          <FolderOpen size={14} /> sitegen-export
        </div>
        {files
          .filter((item) => !item.path.startsWith('src/'))
          .map((item) => (
            <button
              key={item.path}
              className={`file ${file.path === item.path ? 'selected' : ''}`}
              onClick={() => choose(item.path)}
              aria-pressed={file.path === item.path}
            >
              {icon(item.path)}
              {item.path}
            </button>
          ))}
        <div className="folder-label src-folder">
          <ChevronDown size={12} />
          <Folder size={14} /> src
        </div>
        {files
          .filter((item) => item.path.startsWith('src/'))
          .map((item) => (
            <button
              key={item.path}
              className={`file nested ${file.path === item.path ? 'selected' : ''}`}
              onClick={() => choose(item.path)}
              aria-pressed={file.path === item.path}
            >
              {icon(item.path)}
              {item.path.replace('src/', '')}
            </button>
          ))}
      </aside>
      <div className="editor">
        <div className="editor-toolbar">
          <span>
            <FileCode2 size={14} />
            {file.path}
          </span>
          <button
            className="icon-button"
            onClick={copy}
            aria-label={`Copy ${file.path}`}
            title="Copy file"
          >
            {copied ? <Check size={15} /> : <Copy size={15} />}
          </button>
        </div>
        <div className="mobile-file-select">
          <label htmlFor="file-select">File</label>
          <select
            id="file-select"
            value={file.path}
            onChange={(event) => choose(event.target.value)}
          >
            {files.map((item) => (
              <option key={item.path}>{item.path}</option>
            ))}
          </select>
        </div>
        <pre className="code-content" tabIndex={0} aria-label={`Code for ${file.path}`}>
          <code>
            {lines.map((line, i) => (
              <span className="code-line" key={i}>
                <span className="line-number" aria-hidden="true">
                  {i + 1}
                </span>
                <span dangerouslySetInnerHTML={{ __html: line || ' ' }} />
              </span>
            ))}
          </code>
        </pre>
        <div className="editor-status">
          <span>
            <span className="tiny-dot" />{' '}
            {file.language === 'typescript' ? 'TypeScript JSX' : file.language.toUpperCase()}
          </span>
          <span>UTF-8 · {lines.length} lines</span>
        </div>
      </div>
    </div>
  );
}
