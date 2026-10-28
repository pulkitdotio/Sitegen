import type { PageModel } from '../shared/types.js';

export const fixture: PageModel = {
  title: 'Test page',
  url: 'https://example.com/',
  background: 'rgb(250, 250, 250)',
  color: 'rgb(20, 20, 20)',
  fontFamily: 'Arial, sans-serif',
  warnings: [],
  nodeCount: 6,
  nodes: [
    {
      tag: 'main',
      styles: { display: 'block', 'max-width': '900px' },
      children: [
        {
          tag: 'h1',
          styles: { 'font-size': '48px' },
          text: 'A useful starting point',
          children: [],
        },
        { tag: 'p', styles: {}, text: 'Real extracted content.', children: [] },
        { tag: 'button', styles: {}, text: 'Visual only', children: [] },
        {
          tag: 'a',
          styles: {},
          text: 'Read more',
          href: 'https://example.com/about',
          children: [],
        },
      ],
    },
  ],
};
