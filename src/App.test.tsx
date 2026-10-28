import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { generateProject } from '../server/generate';
import { fixture } from '../tests/fixture';

const output = generateProject(fixture);
const response = {
  ...output,
  id: 'demo-id',
  title: fixture.title,
  sourceUrl: fixture.url,
  isDemo: true,
  screenshot: null,
  warnings: ['Static only.'],
  stats: { nodes: 6, components: 1, assets: 0, durationMs: 500 },
};
beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('important frontend interactions', () => {
  it('validates URL input and permission before making a request', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch');
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: 'Generate code' }));
    expect(screen.getByRole('alert')).toHaveTextContent('valid URL');
    await userEvent.type(screen.getByLabelText('Website URL'), 'https://example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Generate code' }));
    expect(screen.getByRole('alert')).toHaveTextContent('permission');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('runs the demo and shows actual generated files and a sandboxed preview', async () => {
    const fetcher = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(response), { status: 200 }));
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: 'Try the demo' }));
    await screen.findByText('Test page');
    expect(fetcher).toHaveBeenCalledWith('/api/demo', expect.objectContaining({ method: 'POST' }));
    const iframe = screen.getByTitle('Generated page preview');
    expect(iframe).toHaveAttribute('sandbox', '');
    expect(iframe.getAttribute('srcdoc')).toContain('A useful starting point');
    await userEvent.click(screen.getByRole('button', { name: 'package.json' }));
    expect(screen.getByLabelText('Code for package.json')).toHaveTextContent('sitegen-export');
    await userEvent.click(screen.getByRole('button', { name: 'Reference' }));
    expect(screen.getByText(/reference screenshot was not available/)).toBeInTheDocument();
  });
  it('prevents duplicate generation while pending', async () => {
    let finish!: (value: Response) => void;
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Try the demo' }));
    expect(screen.getByRole('button', { name: 'Generating' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Try the demo' }));
    expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async () => finish(new Response(JSON.stringify(response))));
  });
  it('reports API and network errors without showing success', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'This address is blocked.' } }), {
        status: 422,
      }),
    );
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: 'Try the demo' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('This address is blocked.'),
    );
    expect(screen.queryByTitle('Generated page preview')).not.toBeInTheDocument();
  });
  it('toggles and persists the theme', async () => {
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: 'Switch to light theme' }));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem('sitegen-theme')).toBe('light');
  });
  it('copies the selected file and confirms it', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(response)));
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Try the demo' }));
    await screen.findByText('Test page');
    const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    await user.click(screen.getByRole('button', { name: 'Copy src/App.tsx' }));
    expect(copy).toHaveBeenCalledWith(
      response.files.find((file) => file.path === 'src/App.tsx')!.content,
    );
    expect(screen.getByText('Copied src/App.tsx')).toBeInTheDocument();
  });
});
