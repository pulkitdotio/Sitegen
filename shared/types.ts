export type PageTag =
  | 'header'
  | 'nav'
  | 'main'
  | 'section'
  | 'article'
  | 'aside'
  | 'footer'
  | 'div'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'h4'
  | 'h5'
  | 'h6'
  | 'p'
  | 'a'
  | 'img'
  | 'button'
  | 'ul'
  | 'ol'
  | 'li'
  | 'span'
  | 'blockquote'
  | 'hr'
  | 'br'
  | 'figure'
  | 'figcaption';

export interface PageNode {
  tag: PageTag;
  text?: string;
  children: PageNode[];
  styles: Record<string, string>;
  href?: string;
  src?: string;
  alt?: string;
  id?: string;
}

export interface PageModel {
  title: string;
  url: string;
  nodes: PageNode[];
  background: string;
  color: string;
  fontFamily: string;
  warnings: string[];
  nodeCount: number;
}

export interface GeneratedFile {
  path: string;
  content: string;
  language: 'typescript' | 'css' | 'json' | 'html' | 'markdown';
}
export interface GeneratedProject {
  id: string;
  title: string;
  sourceUrl: string;
  isDemo: boolean;
  files: GeneratedFile[];
  previewHtml: string;
  screenshot: string | null;
  warnings: string[];
  stats: { nodes: number; components: number; assets: number; durationMs: number };
}
