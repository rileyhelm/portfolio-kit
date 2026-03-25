import { beforeEach, describe, expect, it, vi } from 'vitest';

import { initEditMode, resetEditModeForTests } from '../../static/ts/edit/index';

function jsonResponse(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  } as Response;
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => window.setTimeout(resolve, 0));
}

function mountEditorLaunchers(): void {
  document.body.dataset.editMode = 'true';
  document.body.innerHTML = `
    <button type="button" data-open-create-project>Create</button>
    <button type="button" data-open-project-editor="sample-project">Open Project</button>
    <button type="button" data-open-about-editor>Open About</button>
  `;
}

describe('edit mode runtime', () => {
  beforeEach(() => {
    resetEditModeForTests();
    mountEditorLaunchers();
  });

  it('saves dirty changes before closing from the backdrop', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/render-markdown') {
        return jsonResponse({ html: '' });
      }
      if (url === '/api/create-project') {
        return jsonResponse({ success: true, slug: 'new-project', revision: 'rev-1' });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    initEditMode();
    document.querySelector<HTMLElement>('[data-open-create-project]')?.click();

    const nameInput = document.querySelector<HTMLInputElement>('input[name="name"]');
    if (!nameInput) {
      throw new Error('Missing name input');
    }
    nameInput.value = 'Changed Draft';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));

    document.querySelector<HTMLElement>('.editor-overlay-backdrop')?.click();
    await flushAsyncWork();

    expect(fetchMock).toHaveBeenCalledWith('/api/create-project', expect.objectContaining({ method: 'POST' }));
    expect(document.querySelector('.editor-overlay')?.classList.contains('hidden')).toBe(true);
  });

  it('saves dirty project edits when escape closes the editor', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/render-markdown') {
        return jsonResponse({ html: '' });
      }
      if (url === '/api/project/sample-project') {
        return jsonResponse({
          slug: 'sample-project',
          name: 'Sample Project',
          date: '2026-01-01',
          draft: false,
          pinned: false,
          thumbnail: null,
          youtube: null,
          og_image: null,
          markdown: 'Original body.',
          html: '<p>Original body.</p>',
          revision: 'rev-1',
        });
      }
      if (url === '/api/save-project') {
        return jsonResponse({ success: true, slug: 'sample-project', revision: 'rev-2' });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    initEditMode();
    document.querySelector<HTMLElement>('[data-open-project-editor]')?.click();
    await flushAsyncWork();

    const nameInput = document.querySelector<HTMLInputElement>('input[name="name"]');
    if (!nameInput) {
      throw new Error('Missing name input');
    }
    nameInput.value = 'Renamed Project';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flushAsyncWork();

    expect(fetchMock).toHaveBeenCalledWith('/api/save-project', expect.objectContaining({ method: 'POST' }));
    expect(document.querySelector('.editor-overlay')?.classList.contains('hidden')).toBe(true);
  });

  it('reloads the full current project state when a save conflict loads theirs', async () => {
    let projectFetchCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/render-markdown') {
        return jsonResponse({ html: '' });
      }
      if (url === '/api/project/sample-project') {
        projectFetchCount += 1;
        if (projectFetchCount === 1) {
          return jsonResponse({
            slug: 'sample-project',
            name: 'Original Project',
            date: '2026-01-01',
            draft: false,
            pinned: false,
            thumbnail: null,
            youtube: null,
            og_image: null,
            markdown: 'Original body.',
            html: '<p>Original body.</p>',
            revision: 'rev-1',
          });
        }
        return jsonResponse({
          slug: 'sample-project',
          name: 'Server Project',
          date: '2026-02-01',
          draft: false,
          pinned: true,
          thumbnail: '/static/server-thumb.svg',
          youtube: null,
          og_image: null,
          markdown: 'Server body.',
          html: '<p>Server body.</p>',
          revision: 'rev-2',
        });
      }
      if (url === '/api/save-project' && init?.method === 'POST') {
        return jsonResponse({
          conflict: true,
          server_revision: 'rev-2',
          server_project: { slug: 'sample-project' },
        }, 409);
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('confirm', vi.fn(() => false));

    initEditMode();
    document.querySelector<HTMLElement>('[data-open-project-editor]')?.click();
    await flushAsyncWork();

    const nameInput = document.querySelector<HTMLInputElement>('input[name="name"]');
    if (!nameInput) {
      throw new Error('Missing name input');
    }
    nameInput.value = 'Local Edit';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));

    document.querySelector<HTMLElement>('[data-editor-save]')?.click();
    await flushAsyncWork();

    expect(projectFetchCount).toBeGreaterThanOrEqual(2);
    expect(document.querySelector<HTMLInputElement>('input[name="name"]')?.value).toBe('Server Project');
    expect(document.querySelector<HTMLInputElement>('input[name="date"]')?.value).toBe('2026-02-01');
    expect(document.querySelector<HTMLInputElement>('input[name="draft"]')?.checked).toBe(false);
    expect(document.querySelector<HTMLInputElement>('input[name="pinned"]')?.checked).toBe(true);
    expect(document.querySelector<HTMLTextAreaElement>('textarea[data-text-block]')?.value).toContain('Server body.');
  });

  it('uploads pasted clipboard images into a new image block', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/render-markdown') {
        return jsonResponse({ html: '' });
      }
      if (url === '/api/upload-image') {
        return jsonResponse({
          success: true,
          url: '/static/uploads/images/pasted.webp',
          block: {
            type: 'image',
            alt: 'Clipboard Alt',
            caption: 'Clipboard Caption',
            align: 'center',
            width: 82,
          },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    initEditMode();
    document.querySelector<HTMLElement>('[data-open-create-project]')?.click();
    await flushAsyncWork();

    const textarea = document.querySelector<HTMLTextAreaElement>('textarea[data-text-block]');
    if (!textarea) {
      throw new Error('Missing text block');
    }
    textarea.focus();

    const file = new File(['image-bytes'], 'paste.png', { type: 'image/png' });
    const pasteEvent = new Event('paste', { bubbles: true, cancelable: true }) as Event & {
      clipboardData?: { items: Array<{ type: string; getAsFile: () => File }> };
    };
    Object.defineProperty(pasteEvent, 'clipboardData', {
      value: {
        items: [{ type: 'image/png', getAsFile: () => file }],
      },
    });

    textarea.dispatchEvent(pasteEvent);
    await flushAsyncWork();

    const imageSrcInput = document.querySelector<HTMLInputElement>('[data-image-field] input[name="src"]');
    expect(fetchMock).toHaveBeenCalledWith('/api/upload-image', expect.objectContaining({ method: 'POST' }));
    expect(imageSrcInput?.value).toBe('/static/uploads/images/pasted.webp');
    expect(document.querySelector<HTMLInputElement>('[data-image-field] input[name="alt"]')?.value).toBe('Clipboard Alt');
  });
});
