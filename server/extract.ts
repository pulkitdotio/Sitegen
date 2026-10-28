import type { Page } from 'playwright';
import type { PageModel } from '../shared/types.js';
import { LIMITS } from './security.js';
import { AppError } from './errors.js';

export async function extractPage(page: Page, sourceUrl: string): Promise<PageModel> {
  const model = await page.evaluate(
    ({ limits, sourceUrl }) => {
      const allowed = new Set([
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
      const skip = new Set([
        'script',
        'style',
        'noscript',
        'iframe',
        'object',
        'embed',
        'svg',
        'canvas',
        'video',
        'audio',
        'input',
        'select',
        'textarea',
        'template',
        'link',
        'meta',
      ]);
      const properties = [
        'display',
        'flex-direction',
        'flex-wrap',
        'justify-content',
        'align-items',
        'gap',
        'grid-template-columns',
        'padding-top',
        'padding-right',
        'padding-bottom',
        'padding-left',
        'margin-top',
        'margin-right',
        'margin-bottom',
        'margin-left',
        'max-width',
        'width',
        'min-height',
        'color',
        'background-color',
        'font-family',
        'font-size',
        'font-weight',
        'font-style',
        'line-height',
        'letter-spacing',
        'text-align',
        'text-transform',
        'text-decoration-line',
        'border-top-width',
        'border-right-width',
        'border-bottom-width',
        'border-left-width',
        'border-style',
        'border-color',
        'border-radius',
        'box-shadow',
        'opacity',
        'object-fit',
      ];
      type Node = {
        tag: string;
        text?: string;
        children: Node[];
        styles: Record<string, string>;
        href?: string;
        src?: string;
        alt?: string;
        id?: string;
      };
      let count = 0;
      let scanned = 0;
      let textSize = 0;
      let truncated = false;
      let omittedForms = false;
      // Object methods survive tsx's function-name transform without requiring
      // runtime helpers inside the browser's separate JavaScript environment.
      const helpers = {
        clean(value: string) {
          return value.replace(/\s+/g, ' ').trim();
        },
        safeLink(value: string | null) {
          if (!value) return undefined;
          if (value.startsWith('#')) return value.slice(0, 200);
          try {
            const u = new URL(value, sourceUrl);
            return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password
              ? u.href
              : undefined;
          } catch {
            return undefined;
          }
        },
        walk(element: Element, depth: number): Node[] {
          if (
            ++scanned > limits.maxScan ||
            count >= limits.maxNodes ||
            depth > limits.maxDepth ||
            textSize >= limits.maxText
          ) {
            truncated = true;
            return [];
          }
          const originalTag = element.tagName.toLowerCase();
          if (['form', 'input', 'select', 'textarea'].includes(originalTag)) omittedForms = true;
          if (skip.has(originalTag)) return [];
          const computed = getComputedStyle(element);
          if (
            computed.display === 'none' ||
            computed.visibility === 'hidden' ||
            computed.opacity === '0' ||
            element.hasAttribute('hidden') ||
            element.getAttribute('aria-hidden') === 'true'
          )
            return [];
          const box = element.getBoundingClientRect();
          if (
            !box.width &&
            !box.height &&
            computed.display !== 'contents' &&
            !['br', 'span'].includes(originalTag)
          )
            return [];
          const tag = allowed.has(originalTag)
            ? originalTag
            : computed.display === 'inline'
              ? 'span'
              : 'div';
          const styles: Record<string, string> = {};
          for (const property of properties) {
            const value = computed.getPropertyValue(property);
            // Only scalar computed values. Never copy CSS URLs, variables, escapes,
            // declarations, selectors, or source CSS into the output.
            if (
              value &&
              value.length < 240 &&
              !/[{};<>\\@]/.test(value) &&
              !/url\s*\(|expression|var\s*\(/i.test(value)
            )
              styles[property] = value;
          }
          if (['fixed', 'absolute', 'sticky'].includes(computed.position)) {
            styles['margin-top'] = '0px';
            styles['margin-left'] = '0px';
          }
          if (tag === 'div' || tag === 'section' || tag === 'main' || tag === 'article') {
            // Desktop pixel widths become a maximum; mobile can shrink naturally.
            if (box.width > 100) {
              styles['max-width'] = `${Math.round(box.width)}px`;
              styles.width = '100%';
            }
          }
          if (['flex', 'grid'].includes(computed.display)) {
            if (computed.display === 'grid') {
              const columns = computed.gridTemplateColumns.split(' ').length;
              styles['grid-template-columns'] = `repeat(${Math.min(columns, 4)}, minmax(0, 1fr))`;
            }
          }
          if (
            element.parentElement &&
            ['flex', 'grid'].includes(getComputedStyle(element.parentElement).display)
          )
            delete styles.width;
          if (
            element.parentElement &&
            box.width < element.parentElement.getBoundingClientRect().width - 20 &&
            computed.marginLeft === computed.marginRight &&
            Number.parseFloat(computed.marginLeft) > 0
          ) {
            styles['margin-left'] = 'auto';
            styles['margin-right'] = 'auto';
          }
          const result: Node = { tag, children: [], styles };
          if (/^[a-zA-Z][\w-]{0,79}$/.test(element.id)) result.id = element.id;
          count++;
          if (tag === 'img') {
            const image = element as HTMLImageElement;
            result.src = helpers.safeLink(image.currentSrc || image.src);
            result.alt = helpers.clean(image.alt).slice(0, 300);
            styles['max-width'] = '100%';
            styles.height = 'auto';
          }
          if (tag === 'a') result.href = helpers.safeLink(element.getAttribute('href'));
          for (const child of element.childNodes) {
            if (child.nodeType === Node.TEXT_NODE) {
              const text = (child.textContent ?? '')
                .replace(/\s+/g, ' ')
                .slice(0, Math.min(2000, limits.maxText - textSize));
              if (text.trim() && count < limits.maxNodes) {
                result.children.push({ tag: 'span', text, children: [], styles: {} });
                textSize += text.length;
                count++;
              }
            } else if (child instanceof Element)
              result.children.push(...helpers.walk(child, depth + 1));
          }
          return [result];
        },
      };
      const body = document.body;
      const bodyStyle = getComputedStyle(body);
      const nodes = Array.from(body.childNodes).flatMap((child) => {
        if (child instanceof Element) return helpers.walk(child, 0);
        const text = helpers.clean(child.textContent || '').slice(0, 2000);
        if (text && count + 2 <= limits.maxNodes && textSize + text.length <= limits.maxText) {
          count += 2;
          textSize += text.length;
          return [
            { tag: 'p', children: [{ tag: 'span', text, children: [], styles: {} }], styles: {} },
          ];
        }
        return [];
      });
      const warnings: string[] = [];
      if (truncated)
        warnings.push(
          'The page was simplified to fit the extraction limits. Some content may be omitted.',
        );
      if (omittedForms)
        warnings.push('Form fields were omitted. Buttons are static visual elements.');
      return {
        title: document.title.slice(0, 150) || 'Recreated page',
        url: sourceUrl,
        nodes,
        background: bodyStyle.backgroundColor,
        color: bodyStyle.color,
        fontFamily: bodyStyle.fontFamily,
        warnings,
        nodeCount: count,
      };
    },
    { limits: LIMITS, sourceUrl },
  );
  const text = JSON.stringify(model.nodes);
  if (model.nodeCount < 2 || !model.nodes.length || !/"text":".{2}/.test(text)) {
    throw new AppError(
      'EMPTY_PAGE',
      'This page has too little visible static content. JavaScript-only pages are not supported.',
    );
  }
  return model as PageModel;
}
