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

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect;
}

function mountEditorLaunchers(): void {
  window.history.replaceState({}, '', '/');
  document.body.dataset.editMode = 'true';
  document.body.innerHTML = `
    <button type="button" data-open-create-project>Create</button>
    <button type="button" data-open-project-editor="sample-project">Open Project</button>
    <button type="button" data-open-about-editor>Open About</button>
  `;
}

function mountProjectPage(): void {
  document.body.dataset.editMode = 'true';
  document.body.innerHTML = `
    <article class="project-page" data-project-slug="sample-project">
      <div data-project-page-display>
        <button type="button" data-open-project-editor="sample-project">Edit Project</button>
        <section class="project-body rich-content"><p>Live project page</p></section>
      </div>
      <div class="project-page-editor hidden" data-project-editor-host></div>
    </article>
  `;
}

function mountAboutPage(): void {
  document.body.dataset.editMode = 'true';
  document.body.innerHTML = `
    <section class="about-layout" data-about-page>
      <div class="about-page-display" data-about-page-display>
        <div class="about-page-actions">
          <button type="button" class="site-nav-button" data-open-about-editor>Edit</button>
        </div>
        <div class="about-copy"><p>Live about page</p></div>
      </div>
      <div class="about-page-editor hidden" data-about-editor-host></div>
    </section>
  `;
}

function activateFirstTextLine(): HTMLTextAreaElement {
  const firstLine = document.querySelector<HTMLElement>('.text-block-line');
  if (!firstLine) {
    throw new Error('Missing text line');
  }
  firstLine.click();
  const textarea = firstLine.querySelector<HTMLTextAreaElement>('.text-line-input');
  if (!textarea) {
    throw new Error('Missing text line input');
  }
  return textarea;
}

function activateTextLine(selector: string): HTMLTextAreaElement {
  const line = document.querySelector<HTMLElement>(selector);
  if (!line) {
    throw new Error(`Missing text line for ${selector}`);
  }
  line.click();
  const textarea = line.querySelector<HTMLTextAreaElement>('.text-line-input');
  if (!textarea) {
    throw new Error(`Missing text line input for ${selector}`);
  }
  return textarea;
}

describe('edit mode runtime', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/');
    resetEditModeForTests();
    mountEditorLaunchers();
  });

  it('replaces the live project page with inline edit mode on project pages', async () => {
    mountProjectPage();

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/render-markdown') {
        return jsonResponse({ html: '<p>Original body.</p>' });
      }
      if (url === '/api/project/sample-project') {
        return jsonResponse({
          slug: 'sample-project',
          name: 'Sample Project',
          date: '2026-01-01',
          draft: false,
          thumbnail: null,
          youtube: null,
          markdown: 'Original body.',
          html: '<p>Original body.</p>',
          revision: 'rev-1',
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    initEditMode();
    document.querySelector<HTMLElement>('[data-open-project-editor]')?.click();
    await flushAsyncWork();

    expect(document.querySelector('[data-project-page-display]')?.classList.contains('hidden')).toBe(true);
    expect(document.querySelector('[data-project-editor-host]')?.classList.contains('hidden')).toBe(false);
    expect(document.querySelector('[data-project-editor-host] input[name="name"]')?.getAttribute('value')
      ?? document.querySelector<HTMLInputElement>('[data-project-editor-host] input[name="name"]')?.value)
      .toBe('Sample Project');
    expect(document.querySelector('[data-project-editor-host] [data-delete-project="sample-project"]')).not.toBeNull();
    expect(document.querySelector('.editor-overlay')).toBeNull();
  });

  it('opens inline project edit mode from the page query param', async () => {
    mountProjectPage();
    window.history.replaceState({}, '', '/sample-project?edit=1');

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/render-markdown') {
        return jsonResponse({ html: '<p>Original body.</p>' });
      }
      if (url === '/api/project/sample-project') {
        return jsonResponse({
          slug: 'sample-project',
          name: 'Sample Project',
          date: '2026-01-01',
          draft: false,
          thumbnail: null,
          youtube: null,
          markdown: 'Original body.',
          html: '<p>Original body.</p>',
          revision: 'rev-1',
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    initEditMode();
    await flushAsyncWork();

    expect(fetchMock).toHaveBeenCalledWith('/api/project/sample-project', expect.objectContaining({ method: 'GET' }));
    expect(document.querySelector('[data-project-page-display]')?.classList.contains('hidden')).toBe(true);
    expect(document.querySelector('[data-project-editor-host]')?.classList.contains('hidden')).toBe(false);
    expect(document.querySelector('.editor-overlay')).toBeNull();
  });

  it('replaces the about page with inline edit mode on the about page', async () => {
    mountAboutPage();

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/render-markdown') {
        return jsonResponse({ html: '<p>About body.</p>' });
      }
      if (url === '/api/about') {
        return jsonResponse({
          markdown: 'About body.',
          revision: 'rev-1',
          settings_revision: 'settings-rev-1',
          settings: {
            site_name: 'Portfolio',
            owner_name: 'Riley Helm',
            tagline: 'Director and editor',
            about_photo: null,
            contact_email: 'alex@example.com',
            social_links: [
              { label: 'Instagram', url: 'https://instagram.com/riley' },
              { label: 'YouTube', url: 'https://www.youtube.com/@riley' },
            ],
          },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    initEditMode();
    document.querySelector<HTMLElement>('[data-open-about-editor]')?.click();
    await flushAsyncWork();

    expect(document.querySelector('[data-about-page-display]')?.classList.contains('hidden')).toBe(true);
    expect(document.querySelector('[data-about-editor-host]')?.classList.contains('hidden')).toBe(false);
    expect(document.querySelector<HTMLInputElement>('[data-about-editor-host] input[name="owner_name"]')?.value)
      .toBe('Riley Helm');
    expect(document.querySelector<HTMLInputElement>('[data-about-editor-host] [data-social-platform-input="YouTube"]')?.value)
      .toBe('https://www.youtube.com/@riley');
    expect(document.querySelector('.editor-overlay')).toBeNull();
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
    mountProjectPage();
    window.history.replaceState({}, '', '/sample-project');

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
          thumbnail: null,
          youtube: null,
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
    expect(document.querySelector('[data-project-page-display]')?.classList.contains('hidden')).toBe(false);
    expect(document.querySelector('[data-project-editor-host]')?.classList.contains('hidden')).toBe(true);
  });

  it('saves dirty project edits and exits when Save now is clicked', async () => {
    mountProjectPage();
    window.history.replaceState({}, '', '/sample-project');

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
          thumbnail: null,
          youtube: null,
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

    document.querySelector<HTMLElement>('[data-editor-save]')?.click();
    await flushAsyncWork();

    expect(fetchMock).toHaveBeenCalledWith('/api/save-project', expect.objectContaining({ method: 'POST' }));
    expect(document.querySelector('[data-project-page-display]')?.classList.contains('hidden')).toBe(false);
    expect(document.querySelector('[data-project-editor-host]')?.classList.contains('hidden')).toBe(true);
  });

  it('exits immediately when Save now is clicked without pending changes', async () => {
    mountProjectPage();
    window.history.replaceState({}, '', '/sample-project');

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/render-markdown') {
        return jsonResponse({ html: '<p>Original body.</p>' });
      }
      if (url === '/api/project/sample-project') {
        return jsonResponse({
          slug: 'sample-project',
          name: 'Sample Project',
          date: '2026-01-01',
          draft: false,
          thumbnail: null,
          youtube: null,
          markdown: 'Original body.',
          html: '<p>Original body.</p>',
          revision: 'rev-1',
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    initEditMode();
    document.querySelector<HTMLElement>('[data-open-project-editor]')?.click();
    await flushAsyncWork();

    document.querySelector<HTMLElement>('[data-editor-save]')?.click();
    await flushAsyncWork();

    expect(fetchMock).not.toHaveBeenCalledWith('/api/save-project', expect.anything());
    expect(document.querySelector('[data-project-page-display]')?.classList.contains('hidden')).toBe(false);
    expect(document.querySelector('[data-project-editor-host]')?.classList.contains('hidden')).toBe(true);
  });

  it('reloads the full current project state when a save conflict loads theirs', async () => {
    mountProjectPage();
    window.history.replaceState({}, '', '/sample-project');

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
          thumbnail: null,
          youtube: null,
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
          thumbnail: '/static/server-thumb.svg',
          youtube: null,
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
    expect(document.querySelector<HTMLTextAreaElement>('.text-line-input')?.value).toContain('Server body.');
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

    const textarea = activateFirstTextLine();
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

  it('replaces image width and align fields with selectable image controls', async () => {
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

    const textarea = activateFirstTextLine();
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

    expect(document.querySelector('select[name="align"]')).toBeNull();
    expect(document.querySelector('input[name="width"]')).toBeNull();
    expect(document.querySelectorAll('[data-image-align-block]')).toHaveLength(3);
    expect(document.querySelector('[data-image-preview]')).not.toBeNull();
  });

  it('resizes and realigns images from the preview controls before save', async () => {
    const savedPayload: { current: { markdown?: unknown } | null } = { current: null };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
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
      if (url === '/api/create-project') {
        savedPayload.current = JSON.parse(String(init?.body ?? '{}')) as { markdown?: unknown };
        return jsonResponse({ success: true, slug: 'new-project', revision: 'rev-1' });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    initEditMode();
    document.querySelector<HTMLElement>('[data-open-create-project]')?.click();
    await flushAsyncWork();

    const textarea = activateFirstTextLine();
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

    const stage = document.querySelector<HTMLElement>('[data-image-stage]');
    const image = document.querySelector<HTMLImageElement>('[data-image-preview]');
    if (!stage || !image) {
      throw new Error('Missing image preview');
    }

    stage.getBoundingClientRect = () => rect(0, 0, 1000, 420);
    image.getBoundingClientRect = () => rect(120, 24, 820, 320);

    image.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.querySelector('[data-image-field]')?.classList.contains('is-selected')).toBe(true);
    expect(document.querySelectorAll('.image-resize-handle')).toHaveLength(4);

    document.querySelector<HTMLElement>('[data-image-align="right"]')?.click();
    expect(stage.classList.contains('align-right')).toBe(true);

    const handle = document.querySelector<HTMLElement>('.image-resize-handle.se');
    if (!handle) {
      throw new Error('Missing southeast resize handle');
    }

    handle.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true,
      clientX: 940,
      clientY: 344,
    }));
    document.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true,
      clientX: 1020,
      clientY: 344,
    }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

    expect(image.style.maxWidth).toBe('90%');
    expect(image.style.width).toBe('auto');

    document.querySelector<HTMLElement>('[data-editor-save]')?.click();
    await flushAsyncWork();

    expect(savedPayload.current).not.toBeNull();
    const savedBody = savedPayload.current;
    if (!savedBody) {
      throw new Error('Missing save payload');
    }
    const savedMarkdown = String(savedBody.markdown ?? '');
    expect(savedMarkdown).toContain('portfolio-image align-right');
    expect(savedMarkdown).toContain('max-width:90%');
  });

  it('opens the insert launcher and adds a block from the revealed menu', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/render-markdown') {
        return jsonResponse({ html: '' });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    initEditMode();
    document.querySelector<HTMLElement>('[data-open-create-project]')?.click();
    await flushAsyncWork();

    const launcher = document.querySelector<HTMLElement>('[data-insert-launcher]');
    if (!launcher) {
      throw new Error('Missing insert launcher');
    }

    launcher.click();

    const control = launcher.closest<HTMLElement>('[data-insert-control]');
    expect(control?.classList.contains('is-open')).toBe(true);
    expect(launcher.getAttribute('aria-expanded')).toBe('true');

    document.querySelector<HTMLElement>('[data-insert-block="image"][data-insert-index="0"]')?.click();

    expect(document.querySelector('[data-image-field]')).not.toBeNull();
    expect(document.querySelectorAll('[data-draggable-block]')).toHaveLength(2);
  });

  it('merges two blocks into columns, keeps them editable, and serializes swapped order', async () => {
    const savedPayload: { current: { markdown?: unknown } | null } = { current: null };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/render-markdown') {
        return jsonResponse({ html: '' });
      }
      if (url === '/api/create-project') {
        savedPayload.current = JSON.parse(String(init?.body ?? '{}')) as { markdown?: unknown };
        return jsonResponse({ success: true, slug: 'new-project', revision: 'rev-1' });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    initEditMode();
    document.querySelector<HTMLElement>('[data-open-create-project]')?.click();
    await flushAsyncWork();

    document.querySelector<HTMLElement>('[data-insert-block="text"][data-insert-index="1"]')?.click();
    expect(document.querySelectorAll('[data-draggable-block]')).toHaveLength(2);

    document.querySelector<HTMLElement>('[data-merge-into-row="1"]')?.click();
    expect(document.querySelectorAll('[data-draggable-block]')).toHaveLength(1);
    expect(document.querySelector('.editor-row-columns')).not.toBeNull();

    const leftInput = activateTextLine('.editor-row-column-left .text-block-line');
    leftInput.value = 'Left column';
    leftInput.dispatchEvent(new Event('input', { bubbles: true }));

    const rightInput = activateTextLine('.editor-row-column-right .text-block-line');
    rightInput.value = 'Right column';
    rightInput.dispatchEvent(new Event('input', { bubbles: true }));

    document.querySelector<HTMLElement>('[data-swap-row]')?.click();
    document.querySelector<HTMLElement>('[data-editor-save]')?.click();
    await flushAsyncWork();

    const savedMarkdown = String(savedPayload.current?.markdown ?? '');
    expect(savedMarkdown).toContain('<!-- row -->');
    expect(savedMarkdown).toContain('<!-- col -->');
    expect(savedMarkdown.indexOf('Right column')).toBeLessThan(savedMarkdown.indexOf('Left column'));
  });

  it('splits a row back into top-level blocks', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/render-markdown') {
        return jsonResponse({ html: '' });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    initEditMode();
    document.querySelector<HTMLElement>('[data-open-create-project]')?.click();
    await flushAsyncWork();

    document.querySelector<HTMLElement>('[data-insert-block="text"][data-insert-index="1"]')?.click();
    document.querySelector<HTMLElement>('[data-merge-into-row="1"]')?.click();

    expect(document.querySelectorAll('[data-draggable-block]')).toHaveLength(1);
    expect(document.querySelector('.editor-row-columns')).not.toBeNull();

    document.querySelector<HTMLElement>('[data-split-row]')?.click();

    expect(document.querySelectorAll('[data-draggable-block]')).toHaveLength(2);
    expect(document.querySelector('.editor-row-columns')).toBeNull();
    expect(document.querySelector('[data-split-row]')).toBeNull();
  });

  it('does not open slash command UI when typing slash in a text block', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/render-markdown') {
        return jsonResponse({ html: '' });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    initEditMode();
    document.querySelector<HTMLElement>('[data-open-create-project]')?.click();
    await flushAsyncWork();

    const textarea = activateFirstTextLine();

    textarea.value = '/image';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));

    expect(document.querySelector('[data-slash-menu]')).toBeNull();
    expect(document.querySelectorAll('[data-draggable-block]')).toHaveLength(1);
    expect(textarea.value).toBe('/image');
  });

  it('renders text blocks line-by-line without requesting server preview HTML', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      throw new Error(`Unexpected fetch: ${String(input)}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    initEditMode();
    document.querySelector<HTMLElement>('[data-open-create-project]')?.click();
    await flushAsyncWork();

    const textarea = activateFirstTextLine();
    textarea.value = '## Heading';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('blur'));

    expect(document.querySelector('.text-block-line-preview h2')?.textContent).toBe('Heading');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows format controls only while text is highlighted', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      throw new Error(`Unexpected fetch: ${String(input)}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    initEditMode();
    document.querySelector<HTMLElement>('[data-open-create-project]')?.click();
    await flushAsyncWork();

    const textarea = activateFirstTextLine();
    const controls = document.querySelector<HTMLElement>('[data-text-format-controls]');
    if (!controls) {
      throw new Error('Missing text format controls');
    }

    expect(controls.classList.contains('is-visible')).toBe(false);

    textarea.value = 'Hello world';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.selectionStart = 0;
    textarea.selectionEnd = 5;
    textarea.dispatchEvent(new Event('select', { bubbles: true }));

    expect(controls.classList.contains('is-visible')).toBe(true);

    textarea.selectionStart = 5;
    textarea.selectionEnd = 5;
    textarea.dispatchEvent(new Event('select', { bubbles: true }));

    expect(controls.classList.contains('is-visible')).toBe(false);
  });

  it('applies bold and italic keyboard shortcuts to the selected text', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      throw new Error(`Unexpected fetch: ${String(input)}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    initEditMode();
    document.querySelector<HTMLElement>('[data-open-create-project]')?.click();
    await flushAsyncWork();

    const textarea = activateFirstTextLine();
    textarea.value = 'Hello world';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));

    textarea.selectionStart = 6;
    textarea.selectionEnd = 11;
    const boldEvent = new KeyboardEvent('keydown', {
      key: 'b',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    textarea.dispatchEvent(boldEvent);

    expect(boldEvent.defaultPrevented).toBe(true);
    expect(textarea.value).toBe('Hello **world**');
    expect(textarea.selectionStart).toBe(8);
    expect(textarea.selectionEnd).toBe(13);

    const italicEvent = new KeyboardEvent('keydown', {
      key: 'i',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    textarea.dispatchEvent(italicEvent);

    expect(italicEvent.defaultPrevented).toBe(true);
    expect(textarea.value).toBe('Hello ***world***');
    expect(textarea.selectionStart).toBe(9);
    expect(textarea.selectionEnd).toBe(14);
  });

  it('applies the link keyboard shortcut to the selected text', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      throw new Error(`Unexpected fetch: ${String(input)}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('prompt', vi.fn(() => 'openai.com'));

    initEditMode();
    document.querySelector<HTMLElement>('[data-open-create-project]')?.click();
    await flushAsyncWork();

    const textarea = activateFirstTextLine();
    textarea.value = 'Visit OpenAI';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));

    textarea.selectionStart = 6;
    textarea.selectionEnd = 12;
    const linkEvent = new KeyboardEvent('keydown', {
      key: 'k',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    textarea.dispatchEvent(linkEvent);

    expect(linkEvent.defaultPrevented).toBe(true);
    expect(window.prompt).toHaveBeenCalledWith('Enter a URL for this link.', 'https://');
    expect(textarea.value).toBe('Visit [OpenAI](https://openai.com/)');
    expect(textarea.selectionStart).toBe(7);
    expect(textarea.selectionEnd).toBe(13);
  });

  it('only starts block dragging from the drag handle', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/render-markdown') {
        return jsonResponse({ html: '' });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    initEditMode();
    document.querySelector<HTMLElement>('[data-open-create-project]')?.click();
    await flushAsyncWork();

    const block = document.querySelector<HTMLElement>('[data-draggable-block]');
    const handle = document.querySelector<HTMLElement>('[data-drag-handle]');
    if (!block || !handle) {
      throw new Error('Missing draggable block');
    }

    expect(block.getAttribute('draggable')).toBeNull();
    expect(handle.getAttribute('draggable')).toBe('true');

    const setData = vi.fn();

    const blockDragStart = new Event('dragstart', { bubbles: true }) as DragEvent;
    Object.defineProperty(blockDragStart, 'dataTransfer', {
      value: { setData },
    });
    block.dispatchEvent(blockDragStart);

    expect(setData).not.toHaveBeenCalled();

    const handleDragStart = new Event('dragstart', { bubbles: true }) as DragEvent;
    Object.defineProperty(handleDragStart, 'dataTransfer', {
      value: { setData },
    });
    handle.dispatchEvent(handleDragStart);

    expect(setData).toHaveBeenCalledWith('text/plain', expect.any(String));
    expect(setData).toHaveBeenCalledWith('application/x-portfolio-kit-block', expect.any(String));
  });

  it('shows only duplicate and delete actions on the right side of the block header', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/render-markdown') {
        return jsonResponse({ html: '' });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    initEditMode();
    document.querySelector<HTMLElement>('[data-open-create-project]')?.click();
    await flushAsyncWork();

    const header = document.querySelector<HTMLElement>('.editor-block-header');
    const actions = header?.querySelector<HTMLElement>('.editor-block-actions');
    if (!header || !actions) {
      throw new Error('Missing block header');
    }

    expect(header.firstElementChild?.classList.contains('editor-block-meta')).toBe(true);
    expect(header.lastElementChild).toBe(actions);
    expect(actions.querySelector('[data-duplicate-block]')).not.toBeNull();
    expect(actions.querySelector('[data-delete-block]')).not.toBeNull();
    expect(actions.querySelector('[data-move-block]')).toBeNull();
    expect(document.querySelector('[aria-label="Move up"]')).toBeNull();
    expect(document.querySelector('[aria-label="Move down"]')).toBeNull();
  });
});
