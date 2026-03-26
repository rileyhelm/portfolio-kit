import {
  blocksToMarkdown,
  cloneBlock,
  createBlock,
  deleteBlock,
  findBlock,
  insertBlock,
  moveBlock,
  parseIntoBlocks,
  replaceBlock,
} from './blocks';
import type {
  AboutPayload,
  Block,
  BlockType,
  ImageBlock,
  ProjectPayload,
  RowBlock,
  RowChildBlock,
  SiteSettingsPayload,
  TextBlock,
} from '../types';
import * as ImageMedia from './image-media';
import { applyTextFormatting } from './text-formatting';
import type { TextFormatAction } from './text-formatting';
import { createTextLineEditor } from './text-line-editor';

type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'conflict';

interface ProjectDraft {
  mode: 'project';
  project: ProjectPayload;
  blocks: Block[];
  revision: string | null;
  originalSlug: string | null;
}

interface AboutDraft {
  mode: 'about';
  markdown: string;
  blocks: Block[];
  revision: string | null;
  settingsRevision: string | null;
  settings: SiteSettingsPayload;
}

type EditorState = ProjectDraft | AboutDraft;
type EditorPresentation = 'overlay' | 'inline-project' | 'inline-about' | null;

const EDIT_QUERY_KEY = 'edit';
const SCROLL_STORAGE_KEY = 'portfolio-kit-editor-scroll';
const DRAFT_TITLE = 'New Project';
const supportedSocialPlatforms = ['Instagram', 'YouTube', 'LinkedIn', 'TikTok'] as const;

type SupportedSocialPlatform = typeof supportedSocialPlatforms[number];

const blockInsertOptions: Array<{ type: BlockType; label: string }> = [
  { type: 'text', label: 'Text' },
  { type: 'image', label: 'Image' },
  { type: 'divider', label: 'Divider' },
];

const IMAGE_ALIGN_ICONS: Record<'left' | 'center' | 'right', string> = {
  left: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="18" x2="18" y2="18"/></svg>',
  center: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="6" y1="12" x2="18" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg>',
  right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="9" y1="12" x2="21" y2="12"/><line x1="6" y1="18" x2="21" y2="18"/></svg>',
};

const ROW_ACTION_ICONS = {
  columns: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="4" y="6" width="7" height="12" rx="1.5"/><rect x="13" y="6" width="7" height="12" rx="1.5"/></svg>',
  swap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M7 7h11"/><path d="m14 4 4 3-4 3"/><path d="M17 17H6"/><path d="m10 20-4-3 4-3"/></svg>',
  split: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 5v14"/><path d="M8 8 5 12l3 4"/><path d="m16 8 3 4-3 4"/></svg>',
} as const;

let state: EditorState | null = null;
let overlayRoot: HTMLElement | null = null;
let editorRoot: HTMLElement | null = null;
let editorShell: HTMLElement | null = null;
let editorScrollTarget: HTMLElement | null = null;
let editorPresentation: EditorPresentation = null;
let saveStatus: SaveStatus = 'idle';
let saveTimer: number | null = null;
let isHydrating = false;
let launcherEventsBound = false;
let globalEditorEventsBound = false;
let lastSavedSnapshot: string | null = null;
let closeAfterSave = false;
let inlineProjectPage: HTMLElement | null = null;
let inlineProjectDisplay: HTMLElement | null = null;
let inlineProjectRefreshOnClose = false;
let inlineAboutPage: HTMLElement | null = null;
let inlineAboutDisplay: HTMLElement | null = null;
let inlineAboutRefreshOnClose = false;

function setInsertControlOpen(control: HTMLElement, isOpen: boolean): void {
  control.classList.toggle('is-open', isOpen);
  const trigger = control.querySelector<HTMLElement>('[data-insert-launcher]');
  if (trigger) {
    trigger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  }
}

function closeInsertControls(root: ParentNode, except: HTMLElement | null = null): void {
  root.querySelectorAll<HTMLElement>('[data-insert-control].is-open').forEach((control) => {
    if (except && control === except) {
      return;
    }
    setInsertControlOpen(control, false);
  });
}

function closeOpenInsertControls(): boolean {
  if (!editorRoot) {
    return false;
  }
  const openControls = editorRoot.querySelectorAll<HTMLElement>('[data-insert-control].is-open');
  if (!openControls.length) {
    return false;
  }
  closeInsertControls(editorRoot);
  return true;
}

function getOverlayRoot(): HTMLElement {
  if (overlayRoot) {
    return overlayRoot;
  }

  overlayRoot = document.createElement('div');
  overlayRoot.className = 'editor-overlay hidden';
  overlayRoot.innerHTML = `
    <div class="editor-overlay-backdrop" data-editor-close></div>
    <section class="editor-panel" role="dialog" aria-modal="true">
      <div class="editor-panel-shell"></div>
    </section>
  `;
  document.body.appendChild(overlayRoot);
  bindEditorRootEvents(overlayRoot);
  return overlayRoot;
}

function bindEditorRootEvents(root: HTMLElement): void {
  if (root.dataset.editorEventsBound === 'true') {
    return;
  }

  root.dataset.editorEventsBound = 'true';

  root.addEventListener('mousedown', (event) => {
    const target = event.target as HTMLElement;
    if (target.closest('[data-format-action]')) {
      event.preventDefault();
    }
  });

  root.addEventListener('click', async (event) => {
    const target = event.target as HTMLElement;
    const insertControl = target.closest<HTMLElement>('[data-insert-control]');
    const insertLauncher = target.closest<HTMLElement>('[data-insert-launcher]');

    if (insertLauncher && insertControl) {
      const nextOpen = !insertControl.classList.contains('is-open');
      closeInsertControls(root);
      setInsertControlOpen(insertControl, nextOpen);
      return;
    }

    closeInsertControls(root, insertControl);

    const imagePreview = target.closest<HTMLImageElement>('[data-image-preview]');
    if (imagePreview) {
      ImageMedia.select(imagePreview, imagePreview.dataset.imagePreview ?? '');
      return;
    }

    const imageAlignButton = target.closest<HTMLElement>('[data-image-align][data-image-align-block]');
    if (imageAlignButton) {
      ImageMedia.setAlignment(
        imageAlignButton.dataset.imageAlignBlock ?? '',
        (imageAlignButton.dataset.imageAlign ?? 'left') as ImageBlock['align'],
      );
      return;
    }

    if (target.closest('[data-editor-close]')) {
      await requestCloseEditor();
      return;
    }

    if (target.closest('[data-editor-save]')) {
      await requestCloseEditor();
      return;
    }

    const createInsert = target.closest<HTMLElement>('[data-insert-block]');
    if (createInsert) {
      const index = Number.parseInt(createInsert.dataset.insertIndex ?? '', 10);
      const type = (createInsert.dataset.insertBlock ?? 'text') as BlockType;
      if (!Number.isNaN(index)) {
        updateBlocks(insertBlock(currentBlocks(), index, type));
      }
      return;
    }

    const mergeIntoRowButton = target.closest<HTMLElement>('[data-merge-into-row]');
    if (mergeIntoRowButton) {
      const index = Number.parseInt(mergeIntoRowButton.dataset.mergeIntoRow ?? '', 10);
      if (!Number.isNaN(index)) {
        mergeBlocksIntoRow(index);
      }
      return;
    }

    const blockDelete = target.closest<HTMLElement>('[data-delete-block]');
    if (blockDelete) {
      updateBlocks(deleteBlock(currentBlocks(), blockDelete.dataset.deleteBlock ?? ''));
      return;
    }

    const blockDuplicate = target.closest<HTMLElement>('[data-duplicate-block]');
    if (blockDuplicate) {
      const blockId = blockDuplicate.dataset.duplicateBlock ?? '';
      const blocks = currentBlocks();
      const index = blocks.findIndex((block) => block.id === blockId);
      if (index >= 0) {
        const next = [...blocks];
        next.splice(index + 1, 0, cloneBlock(blocks[index] as Block));
        updateBlocks(next);
      }
      return;
    }

    const swapRowButton = target.closest<HTMLElement>('[data-swap-row]');
    if (swapRowButton) {
      swapRowColumns(swapRowButton.dataset.swapRow ?? '');
      return;
    }

    const splitRowButton = target.closest<HTMLElement>('[data-split-row]');
    if (splitRowButton) {
      splitRowIntoBlocks(splitRowButton.dataset.splitRow ?? '');
      return;
    }

    const openProject = target.closest<HTMLElement>('[data-open-project-editor]');
    if (openProject) {
      await openProjectEditor(openProject.dataset.openProjectEditor ?? '');
      return;
    }

    if (target.closest('[data-open-create-project]')) {
      await openCreateProject();
      return;
    }

    if (target.closest('[data-open-about-editor]')) {
      await openAboutEditor();
      return;
    }

    const deleteProjectButton = target.closest<HTMLElement>('[data-delete-project]');
    if (deleteProjectButton) {
      const slug = deleteProjectButton.dataset.deleteProject ?? '';
      if (slug && window.confirm(`Delete "${slug}"?`)) {
        await requestJSON(`/api/project/${slug}`, { method: 'DELETE' });
        if (window.location.pathname === `/${slug}`) {
          window.location.href = '/';
        } else {
          window.location.reload();
        }
      }
      return;
    }

    const formatButton = target.closest<HTMLElement>('[data-format-action]');
    if (formatButton) {
      const blockId = formatButton.dataset.blockId ?? '';
      const action = formatButton.dataset.formatAction ?? '';
      const blockRoot = root.querySelector<HTMLElement>(`[data-text-block-root="${blockId}"]`);
      if (!blockRoot?.querySelector('.text-block-line.is-editing')) {
        blockRoot?.querySelector<HTMLElement>('.text-block-line')?.click();
      }
      const textarea = blockRoot?.querySelector<HTMLTextAreaElement>('.text-block-line.is-editing .text-line-input') ?? null;
      if (textarea) {
        applyTextFormatting(textarea, action as TextFormatAction);
      }
      return;
    }

    const thumbUpload = target.closest<HTMLElement>('[data-project-upload]');
    if (thumbUpload) {
      const targetField = thumbUpload.dataset.projectUpload ?? '';
      await pickAndUploadImage((url) => {
        const input = root.querySelector<HTMLInputElement>(`input[name="${targetField}"]`);
        if (input) {
          input.value = url;
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });
      return;
    }

    const settingsUpload = target.closest<HTMLElement>('[data-settings-upload]');
    if (settingsUpload) {
      const targetField = settingsUpload.dataset.settingsUpload ?? '';
      await pickAndUploadImage((url) => {
        const input = root.querySelector<HTMLInputElement>(`input[name="${targetField}"]`);
        if (input) {
          input.value = url;
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });
      return;
    }

    const imageUpload = target.closest<HTMLElement>('[data-image-upload]');
    if (imageUpload) {
      const blockId = imageUpload.dataset.imageUpload ?? '';
      await pickAndUploadImage((url, block) => {
        const current = currentBlockById(blockId);
        if (!current || current.type !== 'image') {
          return;
        }
        updateBlocks(
          replaceBlock(currentBlocks(), blockId, {
            ...current,
            src: url,
            alt: current.alt || (block?.alt ?? ''),
            caption: current.caption || (block?.caption ?? ''),
            width: current.width || Number(block?.width ?? 100),
          }),
        );
      });
      return;
    }

    const thumbnailShortcut = target.closest<HTMLElement>('[data-use-image-thumbnail]');
    if (thumbnailShortcut && state?.mode === 'project') {
      const blockId = thumbnailShortcut.dataset.useImageThumbnail ?? '';
      const block = currentBlockById(blockId);
      if (block?.type === 'image') {
        state.project.thumbnail = block.src;
        render();
        markDirty();
      }
      return;
    }

  });

  root.addEventListener('input', (event) => {
    const target = event.target as HTMLElement;

    if (target.matches('input[name], textarea[name], select[name]')) {
      if (state?.mode === 'project') {
        syncProjectFields();
      } else if (state?.mode === 'about') {
        syncAboutFields();
      }
      markDirty();
    }

    const imageInput = target.closest<HTMLElement>('[data-image-field]');
    if (imageInput) {
      const blockId = imageInput.dataset.imageField ?? '';
      syncImageBlock(blockId);
      markDirty();
    }

    const settingsList = target.closest<HTMLElement>('[data-social-links]');
    if (settingsList && state?.mode === 'about') {
      syncAboutFields();
      markDirty();
    }
  });

  root.addEventListener('change', (event) => {
    const target = event.target as HTMLInputElement;
    if (target.matches('[data-block-upload-input]')) {
      const blockId = target.dataset.blockUploadInput ?? '';
      const file = target.files?.[0];
      if (!file) {
        return;
      }
      void uploadImageFile(file).then(({ url, block }) => {
        const current = currentBlockById(blockId);
        if (!current || current.type !== 'image') {
          return;
        }
        updateBlocks(
          replaceBlock(currentBlocks(), blockId, {
            ...current,
            src: url,
            alt: current.alt || (block?.alt ?? ''),
            caption: current.caption || (block?.caption ?? ''),
            width: current.width || Number(block?.width ?? 100),
          }),
        );
      });
    }
  });

  root.addEventListener('paste', (event) => {
    const file = imageFileFromClipboard(event);
    if (!file) {
      return;
    }

    event.preventDefault();
    void handleClipboardImagePaste(file, event.target);
  });

  root.addEventListener('dragstart', (event) => {
    const target = event.target;
    if (!(target instanceof Element) || !('dataTransfer' in event)) {
      return;
    }

    const handle = target.closest<HTMLElement>('[data-drag-handle]');
    const block = handle?.closest<HTMLElement>('[data-draggable-block]');
    if (!handle || !block) {
      return;
    }
    event.dataTransfer?.setData('text/plain', block.dataset.draggableBlock ?? '');
    event.dataTransfer?.setData('application/x-portfolio-kit-block', block.dataset.draggableBlock ?? '');
  });

  root.addEventListener('dragover', (event) => {
    const target = event.target as HTMLElement;
    if (target.closest('[data-draggable-block]')) {
      event.preventDefault();
    }
  });

  root.addEventListener('drop', (event) => {
    const target = event.target;
    if (!(target instanceof Element) || !('dataTransfer' in event)) {
      return;
    }

    const block = target.closest<HTMLElement>('[data-draggable-block]');
    if (!block) {
      return;
    }

    event.preventDefault();
    const sourceId = event.dataTransfer?.getData('application/x-portfolio-kit-block') ?? '';
    const targetId = block.dataset.draggableBlock ?? '';
    if (!sourceId || !targetId || sourceId === targetId) {
      return;
    }

    const blocks = currentBlocks();
    const fromIndex = blocks.findIndex((item) => item.id === sourceId);
    const toIndex = blocks.findIndex((item) => item.id === targetId);
    if (fromIndex >= 0 && toIndex >= 0) {
      updateBlocks(moveBlock(blocks, fromIndex, toIndex));
    }
  });

  bindGlobalEditorEvents();
}

function bindGlobalEditorEvents(): void {
  if (globalEditorEventsBound) {
    return;
  }

  globalEditorEventsBound = true;

  window.addEventListener('beforeunload', (event) => {
    if (hasUnsavedChanges() || saveStatus === 'saving') {
      event.preventDefault();
      event.returnValue = '';
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !isEditorVisible()) {
      return;
    }

    if (closeOpenInsertControls()) {
      event.preventDefault();
      return;
    }

    event.preventDefault();
    void requestCloseEditor();
  });
}

function bindLauncherEvents(): void {
  if (launcherEventsBound) {
    return;
  }

  launcherEventsBound = true;
  document.addEventListener('click', async (event) => {
    const target = event.target as HTMLElement | null;
    if (!target || target.closest('.editor-overlay, [data-project-editor-host], [data-about-editor-host]')) {
      return;
    }

    const createButton = target.closest<HTMLElement>('[data-open-create-project]');
    if (createButton) {
      event.preventDefault();
      await openCreateProject();
      return;
    }

    const aboutButton = target.closest<HTMLElement>('[data-open-about-editor]');
    if (aboutButton) {
      event.preventDefault();
      await openAboutEditor();
      return;
    }

    const projectButton = target.closest<HTMLElement>('[data-open-project-editor]');
    if (projectButton) {
      event.preventDefault();
      const slug = projectButton.dataset.openProjectEditor ?? '';
      if (slug) {
        await openProjectEditor(slug);
      }
      return;
    }

    const deleteButton = target.closest<HTMLElement>('[data-delete-project]');
    if (deleteButton) {
      event.preventDefault();
      const slug = deleteButton.dataset.deleteProject ?? '';
      if (slug && window.confirm(`Delete "${slug}"?`)) {
        await requestJSON(`/api/project/${slug}`, { method: 'DELETE' });
        window.location.reload();
      }
    }
  });
}

function currentBlocks(): Block[] {
  if (!state) {
    return [];
  }
  return state.blocks;
}

function currentBlockById(blockId: string): Block | null {
  return findBlock(currentBlocks(), blockId);
}

function topLevelBlockIndex(blockId: string): number {
  return currentBlocks().findIndex((block) => block.id === blockId);
}

function topLevelContainerIndexForBlockId(blockId: string): number {
  return currentBlocks().findIndex((block) => (
    block.id === blockId
    || (block.type === 'row' && (block.left.id === blockId || block.right.id === blockId))
  ));
}

function canMergeBlocksIntoRow(index: number): boolean {
  const blocks = currentBlocks();
  if (index <= 0 || index >= blocks.length) {
    return false;
  }

  const left = blocks[index - 1];
  const right = blocks[index];
  return Boolean(left && right && left.type !== 'row' && right.type !== 'row');
}

function mergeBlocksIntoRow(index: number): void {
  if (!canMergeBlocksIntoRow(index)) {
    return;
  }

  const blocks = currentBlocks();
  const left = blocks[index - 1];
  const right = blocks[index];
  if (!left || !right || left.type === 'row' || right.type === 'row') {
    return;
  }

  const next = [...blocks];
  const row: RowBlock = {
    id: createBlock('row').id,
    type: 'row',
    left,
    right,
  };
  next.splice(index - 1, 2, row);
  updateBlocks(next);
}

function swapRowColumns(rowId: string): void {
  const index = topLevelBlockIndex(rowId);
  if (index < 0) {
    return;
  }

  const row = currentBlocks()[index];
  if (!row || row.type !== 'row') {
    return;
  }

  const next = [...currentBlocks()];
  next[index] = { ...row, left: row.right, right: row.left };
  updateBlocks(next);
}

function splitRowIntoBlocks(rowId: string): void {
  const index = topLevelBlockIndex(rowId);
  if (index < 0) {
    return;
  }

  const row = currentBlocks()[index];
  if (!row || row.type !== 'row') {
    return;
  }

  const next = [...currentBlocks()];
  next.splice(index, 1, row.left, row.right);
  updateBlocks(next);
}

function getProjectPage(slug: string): HTMLElement | null {
  const page = document.querySelector<HTMLElement>('.project-page[data-project-slug]');
  if (!page || page.dataset.projectSlug !== slug) {
    return null;
  }
  return page;
}

function canRenderProjectInline(slug: string): boolean {
  const page = getProjectPage(slug);
  return Boolean(
    page?.querySelector<HTMLElement>('[data-project-page-display]')
    && page.querySelector<HTMLElement>('[data-project-editor-host]'),
  );
}

function getAboutPage(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-about-page]');
}

function canRenderAboutInline(): boolean {
  const page = getAboutPage();
  return Boolean(
    page?.querySelector<HTMLElement>('[data-about-page-display]')
    && page.querySelector<HTMLElement>('[data-about-editor-host]'),
  );
}

function projectPageSlugForState(project: ProjectPayload): string {
  const mountedPageSlug = inlineProjectPage?.dataset.projectSlug;
  if (mountedPageSlug) {
    return mountedPageSlug;
  }
  return state?.mode === 'project'
    ? (state.originalSlug ?? project.slug)
    : project.slug;
}

function readProjectSlugFromPath(): string | null {
  const pathname = window.location.pathname.replace(/\/+$/, '');
  if (!pathname || pathname === '/' || pathname === '/me') {
    return null;
  }

  const slug = decodeURIComponent(pathname.slice(1)).trim();
  return slug && !slug.includes('/') ? slug : null;
}

function readProjectSlugFromPageOrPath(): string | null {
  return document.querySelector<HTMLElement>('.project-page[data-project-slug]')?.dataset.projectSlug ?? readProjectSlugFromPath();
}

function buildProjectEditUrl(slug: string): string {
  const url = new URL(`/${encodeURIComponent(slug)}`, window.location.origin);
  url.searchParams.set(EDIT_QUERY_KEY, '1');
  return url.toString();
}

function buildAboutEditUrl(): string {
  const url = new URL('/me', window.location.origin);
  url.searchParams.set(EDIT_QUERY_KEY, '1');
  return url.toString();
}

function mountOverlayEditor(): void {
  teardownInlineProjectEditor();
  teardownInlineAboutEditor();
  const overlay = getOverlayRoot();
  overlay.classList.remove('hidden');
  document.documentElement.classList.add('editor-open');
  editorPresentation = 'overlay';
  editorRoot = overlay;
  editorShell = overlay.querySelector<HTMLElement>('.editor-panel-shell');
}

function mountInlineProjectEditor(slug: string): boolean {
  const page = getProjectPage(slug);
  const display = page?.querySelector<HTMLElement>('[data-project-page-display]') ?? null;
  const host = page?.querySelector<HTMLElement>('[data-project-editor-host]') ?? null;
  if (!page || !display || !host) {
    return false;
  }

  overlayRoot?.classList.add('hidden');
  document.documentElement.classList.remove('editor-open');

  inlineProjectPage = page;
  inlineProjectDisplay = display;
  inlineProjectDisplay.classList.add('hidden');
  inlineProjectPage.classList.add('is-editing');
  host.classList.remove('hidden');
  bindEditorRootEvents(host);

  editorPresentation = 'inline-project';
  editorRoot = host;
  editorShell = host;
  return true;
}

function teardownInlineProjectEditor(): void {
  if (!inlineProjectPage || !inlineProjectDisplay) {
    editorPresentation = editorPresentation === 'inline-project' ? null : editorPresentation;
    return;
  }

  const host = inlineProjectPage.querySelector<HTMLElement>('[data-project-editor-host]');
  if (host) {
    host.innerHTML = '';
    host.classList.add('hidden');
  }

  inlineProjectDisplay.classList.remove('hidden');
  inlineProjectPage.classList.remove('is-editing');
  inlineProjectPage = null;
  inlineProjectDisplay = null;
}

function mountInlineAboutEditor(): boolean {
  const page = getAboutPage();
  const display = page?.querySelector<HTMLElement>('[data-about-page-display]') ?? null;
  const host = page?.querySelector<HTMLElement>('[data-about-editor-host]') ?? null;
  if (!page || !display || !host) {
    return false;
  }

  overlayRoot?.classList.add('hidden');
  document.documentElement.classList.remove('editor-open');

  inlineAboutPage = page;
  inlineAboutDisplay = display;
  inlineAboutDisplay.classList.add('hidden');
  inlineAboutPage.classList.add('is-editing');
  host.classList.remove('hidden');
  bindEditorRootEvents(host);

  editorPresentation = 'inline-about';
  editorRoot = host;
  editorShell = host;
  return true;
}

function teardownInlineAboutEditor(): void {
  if (!inlineAboutPage || !inlineAboutDisplay) {
    editorPresentation = editorPresentation === 'inline-about' ? null : editorPresentation;
    return;
  }

  const host = inlineAboutPage.querySelector<HTMLElement>('[data-about-editor-host]');
  if (host) {
    host.innerHTML = '';
    host.classList.add('hidden');
  }

  inlineAboutDisplay.classList.remove('hidden');
  inlineAboutPage.classList.remove('is-editing');
  inlineAboutPage = null;
  inlineAboutDisplay = null;
}

function buildProjectPageUrl(slug: string): string {
  const url = new URL(window.location.href);
  url.pathname = `/${encodeURIComponent(slug)}`;
  url.searchParams.delete(EDIT_QUERY_KEY);
  return url.toString();
}

function markInlineProjectForRefresh(): void {
  if (editorPresentation === 'inline-project') {
    inlineProjectRefreshOnClose = true;
  }
}

function markInlineAboutForRefresh(): void {
  if (editorPresentation === 'inline-about') {
    inlineAboutRefreshOnClose = true;
  }
}

function snapshotProject(project: ProjectPayload, blocks: Block[]): string {
  return JSON.stringify({
    mode: 'project',
    slug: project.slug,
    name: project.name,
    date: project.date,
    draft: project.draft,
    thumbnail: project.thumbnail,
    youtube: project.youtube,
    markdown: blocksToMarkdown(blocks),
  });
}

function snapshotSettings(settings: SiteSettingsPayload): SiteSettingsPayload {
  return {
    site_name: settings.site_name,
    owner_name: settings.owner_name,
    tagline: settings.tagline,
    about_photo: settings.about_photo,
    contact_email: settings.contact_email,
    social_links: settings.social_links.map((item) => ({
      label: item.label,
      url: item.url,
    })),
  };
}

function currentSnapshot(): string | null {
  if (!state) {
    return null;
  }

  if (state.mode === 'project') {
    return snapshotProject(state.project, state.blocks);
  }

  return JSON.stringify({
    mode: 'about',
    markdown: blocksToMarkdown(state.blocks),
    settings: snapshotSettings(state.settings),
  });
}

function rememberSavedSnapshot(): void {
  lastSavedSnapshot = currentSnapshot();
}

function hasUnsavedChanges(): boolean {
  const snapshot = currentSnapshot();
  return snapshot !== null && snapshot !== lastSavedSnapshot;
}

function isEditorVisible(): boolean {
  if (!editorRoot) {
    return false;
  }
  if (editorPresentation === 'inline-project' || editorPresentation === 'inline-about') {
    return true;
  }
  return Boolean(overlayRoot && !overlayRoot.classList.contains('hidden'));
}

function markDirty(): void {
  if (!state) {
    return;
  }

  if (!hasUnsavedChanges()) {
    if (saveTimer) {
      window.clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (saveStatus !== 'saving') {
      saveStatus = 'idle';
    }
    syncStatusChip();
    return;
  }

  if (saveStatus !== 'saving') {
    saveStatus = 'dirty';
  }
  syncStatusChip();
  scheduleSave();
}

function scheduleSave(): void {
  if (saveTimer) {
    window.clearTimeout(saveTimer);
  }
  saveTimer = window.setTimeout(() => {
    void saveNow();
  }, 1400);
}

async function saveNow(force = false): Promise<void> {
  if (!state || saveStatus === 'saving') {
    return;
  }

  if (!force && !hasUnsavedChanges()) {
    saveStatus = 'idle';
    syncStatusChip();
    return;
  }

  if (saveTimer) {
    window.clearTimeout(saveTimer);
    saveTimer = null;
  }

  const snapshotBeforeSave = currentSnapshot();
  saveStatus = 'saving';
  syncStatusChip();

  try {
    if (state.mode === 'project') {
      syncProjectFields();
      const url = state.originalSlug ? '/api/save-project' : '/api/create-project';
      const body = state.originalSlug
        ? {
            ...state.project,
            original_slug: state.originalSlug,
            markdown: blocksToMarkdown(state.blocks),
            base_revision: state.revision,
            force,
          }
        : {
            ...state.project,
            markdown: blocksToMarkdown(state.blocks),
          };

      const response = await requestJSON(url, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
      }, true);

      state.project.slug = response.slug;
      state.revision = response.revision ?? state.revision;
      state.originalSlug = response.slug;
      markInlineProjectForRefresh();
    } else {
      syncAboutFields();
      const response = await requestJSON('/api/save-about', {
        method: 'POST',
        body: JSON.stringify({
          markdown: blocksToMarkdown(state.blocks),
          settings: state.settings,
          base_revision: state.revision,
          settings_base_revision: state.settingsRevision,
          force,
        }),
        headers: { 'Content-Type': 'application/json' },
      }, true);

      state.revision = response.revision ?? state.revision;
      state.settingsRevision = response.settings_revision ?? state.settingsRevision;
      markInlineAboutForRefresh();
    }

    lastSavedSnapshot = snapshotBeforeSave;
    if (hasUnsavedChanges()) {
      saveStatus = 'dirty';
      syncStatusChip();
      scheduleSave();
      return;
    }

    saveStatus = 'saved';
    syncStatusChip();
    if (closeAfterSave) {
      closeAfterSave = false;
      closeEditorImmediately();
      return;
    }
    window.setTimeout(() => {
      if (saveStatus === 'saved') {
        saveStatus = 'idle';
        syncStatusChip();
      }
    }, 1600);
  } catch (error) {
    if (isConflictResponse(error)) {
      const shouldCloseAfterResolve = closeAfterSave;
      saveStatus = 'conflict';
      syncStatusChip();
      const overwrite = window.confirm('This content changed in another session. Press OK to overwrite with your version, or Cancel to load the current server version.');
      if (overwrite) {
        closeAfterSave = shouldCloseAfterResolve;
        await saveNow(true);
        return;
      }

      closeAfterSave = false;
      if (state.mode === 'project') {
        await reloadProjectFromServer(state.originalSlug ?? state.project.slug);
      } else {
        await reloadAboutFromServer();
      }
      return;
    }

    closeAfterSave = false;
    saveStatus = 'error';
    syncStatusChip();
  }
}

function syncProjectFields(): void {
  if (state?.mode !== 'project' || !editorRoot) {
    return;
  }
  state.project.name = valueOf('name');
  state.project.slug = slugify(valueOf('slug'));
  state.project.date = valueOf('date');
  state.project.thumbnail = valueOfNullable('thumbnail');
  state.project.youtube = valueOfNullable('youtube');
  state.project.draft = checkedValue('draft');
}

function syncAboutFields(): void {
  if (state?.mode !== 'about' || !editorRoot) {
    return;
  }

  state.settings.site_name = valueOf('site_name');
  state.settings.owner_name = valueOf('owner_name');
  state.settings.tagline = valueOf('tagline');
  state.settings.contact_email = valueOfNullable('contact_email');
  state.settings.about_photo = valueOfNullable('about_photo');

  const list = editorRoot.querySelector<HTMLElement>('[data-social-links]');
  if (!list) {
    return;
  }

  const footerLinks = Array.from(list.querySelectorAll<HTMLInputElement>('[data-social-platform-input]'))
    .map((input) => ({
      label: input.dataset.socialPlatformInput ?? '',
      url: input.value.trim(),
    }))
    .filter((item) => item.url);
  const preservedLinks = state.settings.social_links.filter((item) => !platformLabel(item.label) && item.label && item.url);
  state.settings.social_links = [...footerLinks, ...preservedLinks];
}

function socialLinksByPlatform(settings: SiteSettingsPayload): Partial<Record<SupportedSocialPlatform, string>> {
  const links: Partial<Record<SupportedSocialPlatform, string>> = {};
  settings.social_links.forEach((item) => {
    const platform = platformLabel(item.label);
    if (platform && item.url && !links[platform]) {
      links[platform] = item.url;
    }
  });
  return links;
}

function platformLabel(label: string): SupportedSocialPlatform | null {
  const normalized = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
  return supportedSocialPlatforms.find((platform) => platform.toLowerCase().replace(/[^a-z0-9]+/g, '') === normalized) ?? null;
}

function syncImageBlock(blockId: string): void {
  const wrapper = editorRoot?.querySelector<HTMLElement>(`[data-image-field="${blockId}"]`);
  const block = currentBlockById(blockId);
  if (!wrapper || !block || block.type !== 'image') {
    return;
  }

  const next: ImageBlock = {
    ...block,
    src: wrapper.querySelector<HTMLInputElement>('input[name="src"]')?.value.trim() ?? '',
    alt: wrapper.querySelector<HTMLInputElement>('input[name="alt"]')?.value.trim() ?? '',
    caption: wrapper.querySelector<HTMLInputElement>('input[name="caption"]')?.value.trim() ?? '',
  };
  updateBlocks(replaceBlock(currentBlocks(), blockId, next), { rerender: false });
}

function updateImageBlock(
  blockId: string,
  updates: Partial<ImageBlock>,
  options: { markDirty?: boolean } = {},
): void {
  const current = currentBlockById(blockId);
  if (!current || current.type !== 'image') {
    return;
  }

  updateBlocks(
    replaceBlock(currentBlocks(), blockId, { ...current, ...updates }),
    { rerender: false, markDirty: options.markDirty ?? true },
  );
}

function valueOf(name: string): string {
  return editorRoot?.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`)?.value.trim() ?? '';
}

function valueOfNullable(name: string): string | null {
  const value = valueOf(name);
  return value || null;
}

function checkedValue(name: string): boolean {
  return editorRoot?.querySelector<HTMLInputElement>(`[name="${name}"]`)?.checked ?? false;
}

function updateBlocks(nextBlocks: Block[], options: { rerender?: boolean; markDirty?: boolean } = {}): void {
  if (!state) {
    return;
  }
  state.blocks = nextBlocks;
  if (options.rerender !== false) {
    renderBlocks();
  }
  if (options.markDirty !== false) {
    markDirty();
  }
}

function render(): void {
  if (!state) {
    return;
  }

  const deleteAction = state.mode === 'project' && state.originalSlug
    ? `<button type="button" class="editor-secondary-button" data-delete-project="${escapeAttr(state.originalSlug)}">Delete project</button>`
    : '';

  if (state.mode === 'project' && state.originalSlug && canRenderProjectInline(projectPageSlugForState(state.project))) {
    mountInlineProjectEditor(projectPageSlugForState(state.project));
  } else if (state.mode === 'about' && canRenderAboutInline()) {
    mountInlineAboutEditor();
  } else if (state.mode === 'project' && state.originalSlug) {
    window.location.assign(buildProjectEditUrl(state.originalSlug));
    return;
  } else if (state.mode === 'about') {
    window.location.assign(buildAboutEditUrl());
    return;
  } else {
    mountOverlayEditor();
  }

  const shell = editorShell;
  if (!shell || !state) {
    return;
  }

  updateEditQuery(editorPresentation !== 'overlay');

  shell.innerHTML = `
    <div class="editor-scroll">
      ${state.mode === 'project'
        ? renderProjectForm(state.project, deleteAction)
        : renderAboutForm(state.settings)}
      <section class="editor-blocks-shell">
        <div class="editor-blocks" data-editor-blocks></div>
      </section>
    </div>
  `;

  editorScrollTarget = editorPresentation === 'overlay'
    ? shell.querySelector<HTMLElement>('.editor-scroll')
    : null;
  restoreScrollPosition();
  renderBlocks();
}

function renderProjectForm(project: ProjectPayload, deleteAction: string): string {
  return `
    <section class="editor-section">
      <div class="editor-section-bar">
        <div>
          <p class="editor-eyebrow">Project Editor</p>
          <h2>${escapeHtml(project.name || DRAFT_TITLE)}</h2>
        </div>
        <div class="editor-actions">
          ${checkboxField('draft', 'Draft', project.draft)}
          ${deleteAction}
          <button type="button" class="editor-primary-button" data-editor-save>Save now</button>
          <span class="editor-status" data-save-status>${saveStatusLabel()}</span>
        </div>
      </div>
      <div class="field-grid field-grid-project-meta">
        ${textField('name', 'Name', project.name)}
        ${textField('slug', 'Slug', project.slug)}
        ${textField('date', 'Date', project.date, 'date')}
      </div>
      <div class="field-grid">
        ${textField('youtube', 'YouTube URL', project.youtube ?? '')}
        ${imagePickerField('thumbnail', 'Thumbnail', project.thumbnail ?? '')}
      </div>
    </section>
  `;
}

function renderAboutForm(settings: SiteSettingsPayload): string {
  const socialLinks = socialLinksByPlatform(settings);
  return `
    <section class="editor-section">
      <div class="editor-section-bar">
        <div>
          <p class="editor-eyebrow">About Editor</p>
          <h2>About & Settings</h2>
        </div>
        <div class="editor-actions">
          <button type="button" class="editor-primary-button" data-editor-save>Save now</button>
          <span class="editor-status" data-save-status>${saveStatusLabel()}</span>
        </div>
      </div>
      <div class="field-grid">
        ${textField('site_name', 'Site name', settings.site_name)}
        ${textField('owner_name', 'Owner name', settings.owner_name)}
        ${textField('tagline', 'Tagline', settings.tagline)}
        ${textField('contact_email', 'Contact email', settings.contact_email ?? '')}
        ${settingsImageField('about_photo', 'About photo', settings.about_photo ?? '')}
      </div>
      <div class="social-links-editor">
        <div class="social-links-header">
          <div>
            <h3>Footer social icons</h3>
            <p>Instagram, YouTube, LinkedIn, and TikTok appear in the footer when their URL is set.</p>
          </div>
        </div>
        <div class="field-grid" data-social-links>
          ${supportedSocialPlatforms.map((platform) => renderSocialLinkField(platform, socialLinks[platform] ?? '')).join('')}
        </div>
      </div>
    </section>
  `;
}

function renderSocialLinkField(platform: SupportedSocialPlatform, url: string): string {
  const placeholders: Record<SupportedSocialPlatform, string> = {
    Instagram: 'https://instagram.com/yourhandle',
    YouTube: 'https://www.youtube.com/@yourchannel',
    LinkedIn: 'https://www.linkedin.com/in/yourname',
    TikTok: 'https://www.tiktok.com/@yourhandle',
  };
  return `
    <label>
      <span>${platform} URL</span>
      <input
        data-social-platform-input="${platform}"
        value="${escapeAttr(url)}"
        placeholder="${placeholders[platform]}"
        inputmode="url"
      >
    </label>
  `;
}

function renderBlocks(): void {
  const container = editorRoot?.querySelector<HTMLElement>('[data-editor-blocks]');
  if (!container || !state) {
    return;
  }

  const markup: string[] = [];
  for (let index = 0; index <= state.blocks.length; index += 1) {
    markup.push(renderInsertRow(index, index === state.blocks.length));
    if (index < state.blocks.length) {
      markup.push(renderBlock(state.blocks[index] as Block));
    }
  }

  container.innerHTML = markup.join('');

  hydrateTextEditors(container, state.blocks);
  ImageMedia.syncSelectionFromDOM();
}

function hydrateTextEditors(container: HTMLElement, blocks: Block[]): void {
  blocks.forEach((block) => {
    if (block.type === 'row') {
      hydrateTextEditors(container, [block.left, block.right]);
      return;
    }

    if (block.type !== 'text') {
      return;
    }

    const blockRoot = container.querySelector<HTMLElement>(`[data-text-block-root="${block.id}"]`);
    if (!blockRoot) {
      return;
    }

    blockRoot.replaceChildren(createTextLineEditor({
      blockId: block.id,
      markdown: block.markdown,
      onSelectionChange: (hasSelection) => {
        setTextFormattingVisibility(block.id, hasSelection);
      },
      onUpdate: (markdown) => {
        const current = currentBlockById(block.id);
        if (!current || current.type !== 'text') {
          return;
        }

        const nextBlock: TextBlock = {
          ...current,
          markdown,
        };
        updateBlocks(replaceBlock(currentBlocks(), block.id, nextBlock), { rerender: false, markDirty: false });
        markDirty();
      },
    }));
  });
}

function renderBlock(block: Block): string {
  return `
    <article class="editor-block${block.type === 'row' ? ' editor-block-row' : ''}" data-draggable-block="${block.id}">
      ${renderBlockBody(block)}
    </article>
  `;
}

function renderInsertRow(index: number, isTerminal = false): string {
  return `
    <div class="block-insert-row${isTerminal ? ' block-insert-row-terminal' : ''}">
      ${canMergeBlocksIntoRow(index) ? `
        <button type="button" class="block-merge-trigger" data-merge-into-row="${index}" title="Turn these two blocks into columns" aria-label="Turn these two blocks into columns">
          ${ROW_ACTION_ICONS.columns}
        </button>
      ` : ''}
      <div class="block-insert-control" data-insert-control>
        <button
          type="button"
          class="block-insert-trigger"
          data-insert-launcher
          aria-label="Add block"
          aria-haspopup="true"
          aria-expanded="false"
        >+</button>
        <div class="block-insert-menu" aria-label="Block types">
          ${blockInsertOptions.map((command) => `
            <button
              type="button"
              class="block-insert-option"
              data-insert-block="${command.type}"
              data-insert-index="${index}"
            >${command.label}</button>
          `).join('')}
        </div>
      </div>
    </div>
  `;
}

interface RenderBlockBodyOptions {
  nested?: boolean;
}

function setTextFormattingVisibility(blockId: string, visible: boolean): void {
  const controls = editorRoot?.querySelector<HTMLElement>(`[data-text-format-controls="${blockId}"]`);
  if (!controls) {
    return;
  }
  controls.classList.toggle('is-visible', visible);
  controls.setAttribute('aria-hidden', visible ? 'false' : 'true');
}

function renderBlockActions(blockId: string): string {
  return `
    <div class="block-inline-actions editor-block-actions">
      <button type="button" class="editor-icon-button" data-duplicate-block="${blockId}" aria-label="Duplicate">⧉</button>
      <button type="button" class="editor-icon-button" data-delete-block="${blockId}" aria-label="Delete">×</button>
    </div>
  `;
}

function renderTextFormattingButtons(blockId: string): string {
  const buttons = [
    ['bold', 'bold'],
    ['italic', 'italic'],
    ['link', 'link'],
    ['h2', 'subheading'],
    ['quote', 'quote'],
    ['list', 'list'],
  ].map(([action, label]) => (
    `<button type="button" class="editor-icon-button" data-format-action="${action}" data-block-id="${blockId}">${label}</button>`
  )).join('');

  return `
    <div class="text-format-controls" data-text-format-controls="${blockId}" aria-hidden="true">
      ${buttons}
    </div>
  `;
}

function renderTextBlockBody(block: TextBlock, options: RenderBlockBodyOptions = {}): string {
  return `
    <div class="text-format-toolbar editor-block-header${options.nested ? ' editor-block-header-nested' : ''}">
      <div class="text-format-actions editor-block-meta">
        ${options.nested ? '' : '<span class="drag-handle" draggable="true" data-drag-handle title="Drag to reorder" aria-label="Drag to reorder">⋮⋮</span>'}
        ${renderTextFormattingButtons(block.id)}
      </div>
      ${options.nested ? '' : renderBlockActions(block.id)}
    </div>
    <div data-text-block-root="${block.id}"></div>
  `;
}

function renderImageBlockBody(block: ImageBlock, options: RenderBlockBodyOptions = {}): string {
  return `
    <div class="block-toolbar editor-block-header${options.nested ? ' editor-block-header-nested' : ''}">
      <div class="text-format-actions editor-block-meta">
        ${options.nested ? '' : '<span class="drag-handle" draggable="true" data-drag-handle title="Drag to reorder" aria-label="Drag to reorder">⋮⋮</span>'}
        <button type="button" class="editor-secondary-button" data-image-upload="${block.id}">Upload image</button>
        <button type="button" class="editor-secondary-button" data-use-image-thumbnail="${block.id}">Use as thumbnail</button>
      </div>
      ${options.nested ? '' : renderBlockActions(block.id)}
    </div>
    <div class="image-editor" data-image-field="${block.id}">
      <div class="field-grid field-grid-image-meta">
        ${textField('src', 'Image URL', block.src)}
        ${textField('alt', 'Alt text', block.alt)}
        ${textField('caption', 'Caption', block.caption)}
      </div>
      <input type="file" accept="image/*" hidden data-block-upload-input="${block.id}">
      <div class="image-preview-shell">
        ${block.src ? renderImagePreview(block) : '<div class="image-preview placeholder">Upload an image</div>'}
      </div>
    </div>
  `;
}

function renderDividerBlockBody(blockId: string, options: RenderBlockBodyOptions = {}): string {
  return `
    <div class="block-toolbar editor-block-header${options.nested ? ' editor-block-header-nested' : ''}">
      <div class="text-format-actions editor-block-meta">
        ${options.nested ? '' : '<span class="drag-handle" draggable="true" data-drag-handle title="Drag to reorder" aria-label="Drag to reorder">⋮⋮</span>'}
      </div>
      ${options.nested ? '' : renderBlockActions(blockId)}
    </div>
    <div class="divider-preview"><hr></div>
  `;
}

function renderRowChildBlock(block: RowChildBlock): string {
  return `
    <div class="editor-row-child editor-row-child-${block.type}" data-editor-block-id="${block.id}">
      ${renderBlockBody(block, { nested: true })}
    </div>
  `;
}

function renderBlockBody(block: Block, options: RenderBlockBodyOptions = {}): string {
  if (block.type === 'row') {
    return `
      <div class="block-toolbar editor-block-header editor-row-header">
        <div class="text-format-actions editor-block-meta">
          <span class="drag-handle" draggable="true" data-drag-handle title="Drag to reorder" aria-label="Drag to reorder">⋮⋮</span>
          <span class="editor-row-label">Columns</span>
        </div>
        <div class="block-inline-actions editor-block-actions">
          <button type="button" class="editor-secondary-button row-action-button" data-swap-row="${block.id}" title="Swap columns" aria-label="Swap columns">
            ${ROW_ACTION_ICONS.swap}
          </button>
          <button type="button" class="editor-secondary-button row-action-button" data-split-row="${block.id}" title="Split columns into blocks" aria-label="Split columns into blocks">
            ${ROW_ACTION_ICONS.split}
          </button>
          <button type="button" class="editor-icon-button" data-duplicate-block="${block.id}" aria-label="Duplicate">⧉</button>
          <button type="button" class="editor-icon-button" data-delete-block="${block.id}" aria-label="Delete">×</button>
        </div>
      </div>
      <div class="editor-row-columns">
        <div class="editor-row-column editor-row-column-left">${renderRowChildBlock(block.left)}</div>
        <div class="editor-row-column editor-row-column-right">${renderRowChildBlock(block.right)}</div>
      </div>
    `;
  }

  if (block.type === 'text') {
    return renderTextBlockBody(block, options);
  }

  if (block.type === 'image') {
    return renderImageBlockBody(block, options);
  }

  return renderDividerBlockBody(block.id, options);
}

function textField(name: string, label: string, value: string, type = 'text'): string {
  return `<label><span>${label}</span><input type="${type}" name="${name}" value="${escapeAttr(value)}"></label>`;
}

function renderImagePreview(block: ImageBlock): string {
  const width = clampImageWidth(block.width);
  return `
    <div class="image-preview-stage align-${block.align}" data-image-stage="${block.id}">
      <div class="image-align-toolbar" role="toolbar" aria-label="Image alignment">
        ${(['left', 'center', 'right'] as const).map((align) => `
          <button
            type="button"
            class="image-align-button${block.align === align ? ' is-active' : ''}"
            data-image-align="${align}"
            data-image-align-block="${block.id}"
            aria-label="Align ${align}"
            title="Align ${align}"
          >${IMAGE_ALIGN_ICONS[align]}</button>
        `).join('')}
      </div>
      <img
        src="${escapeAttr(block.src)}"
        alt="${escapeAttr(block.alt)}"
        class="image-preview"
        data-image-preview="${block.id}"
        style="width:auto;max-width:${width}%;height:auto;"
      >
    </div>
  `;
}

function imagePickerField(name: string, label: string, value: string): string {
  return `
    <label class="image-picker-field">
      <span>${label}</span>
      <div class="image-picker-row">
        <input name="${name}" value="${escapeAttr(value)}">
        <button type="button" class="editor-secondary-button" data-project-upload="${name}">Upload</button>
      </div>
    </label>
  `;
}

function settingsImageField(name: string, label: string, value: string): string {
  return `
    <label class="image-picker-field">
      <span>${label}</span>
      <div class="image-picker-row">
        <input name="${name}" value="${escapeAttr(value)}">
        <button type="button" class="editor-secondary-button" data-settings-upload="${name}">Upload</button>
      </div>
    </label>
  `;
}

function checkboxField(name: string, label: string, checked: boolean): string {
  return `
    <label class="checkbox-field">
      <input type="checkbox" name="${name}" ${checked ? 'checked' : ''}>
      <span>${label}</span>
    </label>
  `;
}

function syncStatusChip(): void {
  const chip = editorRoot?.querySelector<HTMLElement>('[data-save-status]');
  if (chip) {
    chip.textContent = saveStatusLabel();
  }
}

function saveStatusLabel(): string {
  switch (saveStatus) {
    case 'dirty':
      return 'Unsaved';
    case 'saving':
      return 'Saving...';
    case 'saved':
      return 'Saved';
    case 'error':
      return 'Save failed';
    case 'conflict':
      return 'Conflict';
    default:
      return 'Up to date';
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replaceAll('"', '&quot;');
}

function clampImageWidth(width: number): number {
  return Math.max(35, Math.min(100, Number.isFinite(width) ? width : 100));
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function updateEditQuery(active: boolean): void {
  const url = new URL(window.location.href);
  if (active) {
    url.searchParams.set(EDIT_QUERY_KEY, '1');
  } else {
    url.searchParams.delete(EDIT_QUERY_KEY);
  }
  window.history.replaceState(window.history.state, '', url.toString());
}

async function requestCloseEditor(): Promise<void> {
  if (!state) {
    closeEditorImmediately();
    return;
  }

  if (!hasUnsavedChanges()) {
    closeEditorImmediately();
    return;
  }

  closeAfterSave = true;
  if (saveStatus === 'saving') {
    return;
  }

  await saveNow();
}

function closeEditorImmediately(): void {
  const shouldRefreshInlineProject = Boolean(
    state?.mode === 'project'
    && editorPresentation === 'inline-project'
    && inlineProjectRefreshOnClose,
  );
  const shouldRefreshInlineAbout = Boolean(
    state?.mode === 'about'
    && editorPresentation === 'inline-about'
    && inlineAboutRefreshOnClose,
  );
  const nextProjectUrl = shouldRefreshInlineProject && state?.mode === 'project'
    ? buildProjectPageUrl(state.project.slug)
    : null;
  const nextAboutUrl = shouldRefreshInlineAbout ? '/me' : null;

  if (saveTimer) {
    window.clearTimeout(saveTimer);
    saveTimer = null;
  }
  ImageMedia.reset();
  persistScrollPosition();
  updateEditQuery(false);
  overlayRoot?.classList.add('hidden');
  document.documentElement.classList.remove('editor-open');
  teardownInlineProjectEditor();
  teardownInlineAboutEditor();
  state = null;
  editorRoot = null;
  editorShell = null;
  editorScrollTarget = null;
  editorPresentation = null;
  lastSavedSnapshot = null;
  closeAfterSave = false;
  saveStatus = 'idle';
  inlineProjectRefreshOnClose = false;
  inlineAboutRefreshOnClose = false;

  if (nextProjectUrl) {
    window.location.assign(nextProjectUrl);
  } else if (nextAboutUrl) {
    window.location.assign(nextAboutUrl);
  }
}

function applyProjectState(project: ProjectPayload): void {
  state = {
    mode: 'project',
    project,
    blocks: parseIntoBlocks(String(project.markdown ?? '')),
    revision: project.revision ?? null,
    originalSlug: project.slug,
  };
  rememberSavedSnapshot();
  saveStatus = 'idle';
  render();
}

function applyAboutState(payload: AboutPayload): void {
  state = {
    mode: 'about',
    markdown: String(payload.markdown ?? ''),
    blocks: parseIntoBlocks(String(payload.markdown ?? '')),
    revision: payload.revision ?? null,
    settingsRevision: payload.settings_revision ?? null,
    settings: payload.settings,
  };
  rememberSavedSnapshot();
  saveStatus = 'idle';
  render();
}

function persistScrollPosition(): void {
  if (editorScrollTarget) {
    window.sessionStorage.setItem(SCROLL_STORAGE_KEY, String(editorScrollTarget.scrollTop));
  }
}

function restoreScrollPosition(): void {
  if (!editorScrollTarget) {
    return;
  }
  const value = Number.parseInt(window.sessionStorage.getItem(SCROLL_STORAGE_KEY) ?? '0', 10);
  if (!Number.isNaN(value)) {
    editorScrollTarget.scrollTop = value;
  }
}

async function pickAndUploadImage(
  onComplete: (url: string, block?: Partial<ImageBlock>) => void,
): Promise<void> {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.click();
  await new Promise<void>((resolve) => {
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) {
        resolve();
        return;
      }
      const response = await uploadImageFile(file);
      onComplete(response.url, response.block);
      resolve();
    }, { once: true });
  });
}

function imageFileFromClipboard(event: Event & { clipboardData?: DataTransfer | null }): File | null {
  const items = Array.from(event.clipboardData?.items ?? []);
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      return item.getAsFile();
    }
  }
  return null;
}

function focusedBlockId(target: EventTarget | null): string | null {
  const element = target instanceof HTMLElement
    ? target
    : (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  return element?.closest<HTMLElement>('[data-editor-block-id]')?.dataset.editorBlockId
    ?? element?.closest<HTMLElement>('[data-draggable-block]')?.dataset.draggableBlock
    ?? null;
}

function uploadedImageBlock(url: string, incoming?: Partial<ImageBlock>, current?: ImageBlock): ImageBlock {
  const seed = current ?? createBlock('image');
  return {
    ...seed,
    type: 'image',
    src: url,
    alt: current?.alt || (incoming?.alt ?? ''),
    caption: current?.caption || (incoming?.caption ?? ''),
    align: current?.align ?? ((incoming?.align as ImageBlock['align'] | undefined) ?? 'left'),
    width: current?.width ?? Number(incoming?.width ?? 100),
  };
}

async function handleClipboardImagePaste(file: File, target: EventTarget | null): Promise<void> {
  const response = await uploadImageFile(file);
  const activeBlockId = focusedBlockId(target);
  const existing = activeBlockId ? currentBlockById(activeBlockId) : null;

  if (existing?.type === 'image') {
    updateBlocks(
      replaceBlock(currentBlocks(), existing.id, uploadedImageBlock(response.url, response.block, existing)),
    );
    return;
  }

  const blocks = currentBlocks();
  const insertIndex = activeBlockId
    ? Math.max(topLevelContainerIndexForBlockId(activeBlockId) + 1, 0)
    : blocks.length;
  const nextBlocks = [...blocks];
  nextBlocks.splice(insertIndex, 0, uploadedImageBlock(response.url, response.block));
  updateBlocks(nextBlocks);
}

async function uploadImageFile(file: File): Promise<{ url: string; block?: Partial<ImageBlock> }> {
  const formData = new FormData();
  formData.append('file', file);
  return requestJSON('/api/upload-image', {
    method: 'POST',
    body: formData,
  });
}

async function reloadProjectFromServer(slug: string): Promise<void> {
  const project = await requestJSON(`/api/project/${slug}`, { method: 'GET' });
  markInlineProjectForRefresh();
  applyProjectState(project as ProjectPayload);
}

async function reloadAboutFromServer(): Promise<void> {
  const payload = await requestJSON('/api/about', { method: 'GET' });
  markInlineAboutForRefresh();
  applyAboutState(payload as AboutPayload);
}

function isConflictResponse(error: unknown): error is { payload: Record<string, unknown>; status: number } {
  return Boolean(
    error
    && typeof error === 'object'
    && 'status' in error
    && 'payload' in error
    && (error as { status: number }).status === 409,
  );
}

async function requestJSON(url: string, init: RequestInit, throwOnConflict = false): Promise<any> {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (throwOnConflict && response.status === 409) {
      throw { status: response.status, payload };
    }
    throw new Error(String(payload.detail ?? response.statusText));
  }
  return payload;
}

async function openProjectEditor(slug: string): Promise<void> {
  if (!canRenderProjectInline(slug)) {
    window.location.assign(buildProjectEditUrl(slug));
    return;
  }

  const project = await requestJSON(`/api/project/${slug}`, { method: 'GET' });
  applyProjectState(project as ProjectPayload);
}

async function openCreateProject(): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  state = {
    mode: 'project',
    project: {
      slug: slugify(DRAFT_TITLE),
      name: DRAFT_TITLE,
      date: today,
      draft: false,
      thumbnail: null,
      youtube: null,
      markdown: '',
      html: '',
      revision: null,
    },
    blocks: [createBlock('text')],
    revision: null,
    originalSlug: null,
  };
  rememberSavedSnapshot();
  saveStatus = 'idle';
  render();
}

async function openAboutEditor(): Promise<void> {
  if (!canRenderAboutInline()) {
    window.location.assign(buildAboutEditUrl());
    return;
  }

  const payload = await requestJSON('/api/about', { method: 'GET' });
  applyAboutState(payload as AboutPayload);
}

function openFromQueryParam(): void {
  const url = new URL(window.location.href);
  const value = url.searchParams.get(EDIT_QUERY_KEY);
  if (!value) {
    return;
  }

  if (canRenderAboutInline() && window.location.pathname.replace(/\/+$/, '') === '/me') {
    void openAboutEditor();
    return;
  }

  const projectSlug = readProjectSlugFromPageOrPath();
  if (projectSlug && canRenderProjectInline(projectSlug)) {
    void openProjectEditor(projectSlug);
    return;
  }

  if (value === 'about') {
    window.location.replace(buildAboutEditUrl());
    return;
  }

  if (value !== '1') {
    window.location.replace(buildProjectEditUrl(value));
  }
}

export function initEditMode(): void {
  if (document.body.dataset.editMode !== 'true' || isHydrating) {
    return;
  }
  isHydrating = true;
  ImageMedia.init({
    getRoot: () => editorRoot,
    getBlock: (blockId) => {
      const block = currentBlockById(blockId);
      return block?.type === 'image' ? block : null;
    },
    updateBlock: (blockId, updates, options) => {
      updateImageBlock(blockId, updates, options);
    },
    markDirty: () => markDirty(),
    isActive: () => isEditorVisible(),
  });
  bindLauncherEvents();
  openFromQueryParam();
}

export function resetEditModeForTests(): void {
  if (saveTimer) {
    window.clearTimeout(saveTimer);
    saveTimer = null;
  }
  teardownInlineProjectEditor();
  overlayRoot?.remove();
  overlayRoot = null;
  editorRoot = null;
  editorShell = null;
  editorScrollTarget = null;
  editorPresentation = null;
  state = null;
  saveStatus = 'idle';
  isHydrating = false;
  lastSavedSnapshot = null;
  closeAfterSave = false;
  inlineProjectRefreshOnClose = false;
  inlineAboutRefreshOnClose = false;
  ImageMedia.reset();
  document.documentElement.classList.remove('editor-open');
  window.sessionStorage.removeItem(SCROLL_STORAGE_KEY);
}

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initEditMode());
  } else {
    initEditMode();
  }
}
