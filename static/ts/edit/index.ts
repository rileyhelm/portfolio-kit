import {
  blocksToMarkdown,
  cloneBlock,
  createBlock,
  deleteBlock,
  insertBlock,
  moveBlock,
  parseIntoBlocks,
  replaceBlock,
} from './blocks';
import type { AboutPayload, Block, BlockType, ImageBlock, ProjectPayload, SiteSettingsPayload, TextBlock } from '../types';

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

const EDIT_QUERY_KEY = 'edit';
const SCROLL_STORAGE_KEY = 'portfolio-kit-editor-scroll';
const DRAFT_TITLE = 'New Project';

const slashCommands: Array<{ type: BlockType; label: string; description: string }> = [
  { type: 'text', label: 'Text', description: 'Markdown paragraph or heading' },
  { type: 'image', label: 'Image', description: 'Upload or place an image' },
  { type: 'divider', label: 'Divider', description: 'Horizontal rule' },
];

const textPreviewDebouncers = new Map<string, number>();

let state: EditorState | null = null;
let overlayRoot: HTMLElement | null = null;
let overlayScrollTarget: HTMLElement | null = null;
let saveStatus: SaveStatus = 'idle';
let saveTimer: number | null = null;
let isHydrating = false;
let activeSlashBlockId: string | null = null;
let launcherEventsBound = false;
let lastSavedSnapshot: string | null = null;
let closeAfterSave = false;

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
  bindOverlayEvents();
  return overlayRoot;
}

function bindOverlayEvents(): void {
  if (!overlayRoot) {
    return;
  }

  overlayRoot.addEventListener('click', async (event) => {
    const target = event.target as HTMLElement;

    if (target.closest('[data-editor-close]')) {
      await requestCloseEditor();
      return;
    }

    if (target.closest('[data-editor-save]')) {
      await saveNow();
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

    const moveButton = target.closest<HTMLElement>('[data-move-block]');
    if (moveButton) {
      const id = moveButton.dataset.moveBlock ?? '';
      const direction = moveButton.dataset.direction === 'up' ? -1 : 1;
      const blocks = currentBlocks();
      const index = blocks.findIndex((block) => block.id === id);
      if (index >= 0) {
        updateBlocks(moveBlock(blocks, index, index + direction));
      }
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

    const previewToggle = target.closest<HTMLElement>('[data-text-view]');
    if (previewToggle) {
      const blockId = previewToggle.dataset.blockId ?? '';
      const viewMode = previewToggle.dataset.textView as TextBlock['previewMode'];
      const block = currentBlocks().find((item) => item.id === blockId);
      if (block?.type === 'text') {
        updateBlocks(
          replaceBlock(currentBlocks(), blockId, {
            ...block,
            previewMode: viewMode,
          }),
          { markDirty: false },
        );
        if (viewMode !== 'edit') {
          void requestTextPreview(blockId, block.markdown);
        }
      }
      return;
    }

    const formatButton = target.closest<HTMLElement>('[data-format-action]');
    if (formatButton) {
      const blockId = formatButton.dataset.blockId ?? '';
      const action = formatButton.dataset.formatAction ?? '';
      const textarea = overlayRoot?.querySelector<HTMLTextAreaElement>(`textarea[data-text-block="${blockId}"]`);
      if (textarea) {
        applyFormatting(textarea, action);
      }
      return;
    }

    const thumbUpload = target.closest<HTMLElement>('[data-project-upload]');
    if (thumbUpload) {
      const targetField = thumbUpload.dataset.projectUpload ?? '';
      await pickAndUploadImage((url) => {
        const input = overlayRoot?.querySelector<HTMLInputElement>(`input[name="${targetField}"]`);
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
        const input = overlayRoot?.querySelector<HTMLInputElement>(`input[name="${targetField}"]`);
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
        const current = currentBlocks().find((item) => item.id === blockId);
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
      const block = currentBlocks().find((item) => item.id === blockId);
      if (block?.type === 'image') {
        state.project.thumbnail = block.src;
        render();
        markDirty();
      }
      return;
    }

    const slashCommand = target.closest<HTMLElement>('[data-slash-command]');
    if (slashCommand) {
      const type = slashCommand.dataset.slashCommand as BlockType;
      if (activeSlashBlockId) {
        insertSlashCommand(activeSlashBlockId, type);
      }
      hideSlashMenu();
    }
  });

  overlayRoot.addEventListener('input', (event) => {
    const target = event.target as HTMLElement;

    if (target.matches('input[name], textarea[name], select[name]')) {
      if (state?.mode === 'project') {
        syncProjectFields();
      } else if (state?.mode === 'about') {
        syncAboutFields();
      }
      markDirty();
    }

    const textarea = target as HTMLTextAreaElement;
    if (textarea.matches('textarea[data-text-block]')) {
      const blockId = textarea.dataset.textBlock ?? '';
      const block = currentBlocks().find((item) => item.id === blockId);
      if (!block || block.type !== 'text') {
        return;
      }

      const nextBlock: TextBlock = {
        ...block,
        markdown: textarea.value,
      };
      updateBlocks(replaceBlock(currentBlocks(), blockId, nextBlock), { rerender: false });
      scheduleTextPreview(blockId, nextBlock.markdown);
      detectSlashIntent(textarea, blockId);
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

  overlayRoot.addEventListener('change', (event) => {
    const target = event.target as HTMLInputElement;
    if (target.matches('[data-block-upload-input]')) {
      const blockId = target.dataset.blockUploadInput ?? '';
      const file = target.files?.[0];
      if (!file) {
        return;
      }
      void uploadImageFile(file).then(({ url, block }) => {
        const current = currentBlocks().find((item) => item.id === blockId);
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

  overlayRoot.addEventListener('paste', (event) => {
    const file = imageFileFromClipboard(event);
    if (!file) {
      return;
    }

    event.preventDefault();
    void handleClipboardImagePaste(file, event.target);
  });

  overlayRoot.addEventListener('dragstart', (event) => {
    const target = event.target as HTMLElement;
    const block = target.closest<HTMLElement>('[data-draggable-block]');
    if (!block || !(event instanceof DragEvent)) {
      return;
    }
    event.dataTransfer?.setData('text/plain', block.dataset.draggableBlock ?? '');
    event.dataTransfer?.setData('application/x-portfolio-kit-block', block.dataset.draggableBlock ?? '');
  });

  overlayRoot.addEventListener('dragover', (event) => {
    const target = event.target as HTMLElement;
    if (target.closest('[data-draggable-block]')) {
      event.preventDefault();
    }
  });

  overlayRoot.addEventListener('drop', (event) => {
    const target = event.target as HTMLElement;
    const block = target.closest<HTMLElement>('[data-draggable-block]');
    if (!block || !(event instanceof DragEvent)) {
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

    if (activeSlashBlockId) {
      event.preventDefault();
      hideSlashMenu();
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
    if (!target || target.closest('.editor-overlay')) {
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

function snapshotProject(project: ProjectPayload, blocks: Block[]): string {
  return JSON.stringify({
    mode: 'project',
    slug: project.slug,
    name: project.name,
    date: project.date,
    draft: project.draft,
    pinned: project.pinned,
    thumbnail: project.thumbnail,
    youtube: project.youtube,
    og_image: project.og_image,
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
      updateEditQuery(state.project.slug);
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
      updateEditQuery('about');
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
  if (state?.mode !== 'project' || !overlayRoot) {
    return;
  }
  state.project.name = valueOf('name');
  state.project.slug = slugify(valueOf('slug'));
  state.project.date = valueOf('date');
  state.project.thumbnail = valueOfNullable('thumbnail');
  state.project.youtube = valueOfNullable('youtube');
  state.project.og_image = valueOfNullable('og_image');
  state.project.draft = checkedValue('draft');
  state.project.pinned = checkedValue('pinned');
}

function syncAboutFields(): void {
  if (state?.mode !== 'about' || !overlayRoot) {
    return;
  }

  state.settings.site_name = valueOf('site_name');
  state.settings.owner_name = valueOf('owner_name');
  state.settings.tagline = valueOf('tagline');
  state.settings.contact_email = valueOfNullable('contact_email');
  state.settings.about_photo = valueOfNullable('about_photo');

  const list = overlayRoot.querySelector<HTMLElement>('[data-social-links]');
  if (!list) {
    return;
  }

  state.settings.social_links = Array.from(list.querySelectorAll<HTMLElement>('[data-social-row]')).map((row) => ({
    label: row.querySelector<HTMLInputElement>('input[data-social-label]')?.value.trim() ?? '',
    url: row.querySelector<HTMLInputElement>('input[data-social-url]')?.value.trim() ?? '',
  }));
}

function syncImageBlock(blockId: string): void {
  const wrapper = overlayRoot?.querySelector<HTMLElement>(`[data-image-field="${blockId}"]`);
  const block = currentBlocks().find((item) => item.id === blockId);
  if (!wrapper || !block || block.type !== 'image') {
    return;
  }

  const next: ImageBlock = {
    ...block,
    src: wrapper.querySelector<HTMLInputElement>('input[name="src"]')?.value.trim() ?? '',
    alt: wrapper.querySelector<HTMLInputElement>('input[name="alt"]')?.value.trim() ?? '',
    caption: wrapper.querySelector<HTMLInputElement>('input[name="caption"]')?.value.trim() ?? '',
    align: (wrapper.querySelector<HTMLSelectElement>('select[name="align"]')?.value as ImageBlock['align']) ?? 'left',
    width: Number.parseInt(wrapper.querySelector<HTMLInputElement>('input[name="width"]')?.value ?? '100', 10) || 100,
  };
  updateBlocks(replaceBlock(currentBlocks(), blockId, next), { rerender: false });
}

function valueOf(name: string): string {
  return overlayRoot?.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`)?.value.trim() ?? '';
}

function valueOfNullable(name: string): string | null {
  const value = valueOf(name);
  return value || null;
}

function checkedValue(name: string): boolean {
  return overlayRoot?.querySelector<HTMLInputElement>(`[name="${name}"]`)?.checked ?? false;
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
  const overlay = getOverlayRoot();
  overlay.classList.remove('hidden');
  document.documentElement.classList.add('editor-open');

  const shell = overlay.querySelector<HTMLElement>('.editor-panel-shell');
  if (!shell || !state) {
    return;
  }

  updateEditQuery(state.mode === 'about' ? 'about' : state.project.slug);

  shell.innerHTML = `
    <header class="editor-header">
      <div>
        <p class="editor-eyebrow">${state.mode === 'project' ? 'Project Editor' : 'About Editor'}</p>
        <h2>${state.mode === 'project' ? escapeHtml(state.project.name || DRAFT_TITLE) : 'About & Settings'}</h2>
      </div>
      <div class="editor-actions">
        <span class="editor-status" data-save-status>${saveStatusLabel()}</span>
        <button type="button" class="editor-primary-button" data-editor-save>Save now</button>
        <button type="button" class="editor-secondary-button" data-editor-close>Close</button>
      </div>
    </header>
    <div class="editor-scroll">
      ${state.mode === 'project' ? renderProjectForm(state.project) : renderAboutForm(state.settings)}
      <section class="editor-blocks-shell">
        <div class="editor-blocks-header">
          <h3>Content Blocks</h3>
          <p>Use markdown for text blocks. Type <code>/</code> on a new line for quick insert.</p>
        </div>
        <div class="slash-menu hidden" data-slash-menu></div>
        <div class="editor-blocks" data-editor-blocks></div>
      </section>
    </div>
  `;

  overlayScrollTarget = shell.querySelector<HTMLElement>('.editor-scroll');
  restoreScrollPosition();
  renderBlocks();
}

function renderProjectForm(project: ProjectPayload): string {
  return `
    <section class="editor-section">
      <div class="field-grid">
        ${textField('name', 'Name', project.name)}
        ${textField('slug', 'Slug', project.slug)}
        ${textField('date', 'Date', project.date, 'date')}
      </div>
      <div class="field-grid field-grid-compact">
        ${checkboxField('draft', 'Draft', project.draft)}
        ${checkboxField('pinned', 'Pinned', project.pinned)}
      </div>
      <div class="field-grid">
        ${textField('youtube', 'YouTube URL', project.youtube ?? '')}
        ${imagePickerField('thumbnail', 'Thumbnail', project.thumbnail ?? '')}
        ${imagePickerField('og_image', 'OG image', project.og_image ?? '')}
      </div>
    </section>
  `;
}

function renderAboutForm(settings: SiteSettingsPayload): string {
  return `
    <section class="editor-section">
      <div class="field-grid">
        ${textField('site_name', 'Site name', settings.site_name)}
        ${textField('owner_name', 'Owner name', settings.owner_name)}
        ${textField('tagline', 'Tagline', settings.tagline)}
        ${textField('contact_email', 'Contact email', settings.contact_email ?? '')}
        ${settingsImageField('about_photo', 'About photo', settings.about_photo ?? '')}
      </div>
      <div class="social-links-editor">
        <div class="social-links-header">
          <h3>Social links</h3>
          <button type="button" class="editor-secondary-button" data-add-social-link>Add link</button>
        </div>
        <div data-social-links>
          ${settings.social_links.map(renderSocialLinkRow).join('')}
        </div>
      </div>
    </section>
  `;
}

function renderSocialLinkRow(item: { label: string; url: string }, index = 0): string {
  return `
    <div class="social-row" data-social-row>
      <label><span>Label</span><input data-social-label value="${escapeAttr(item.label)}" placeholder="Instagram"></label>
      <label><span>URL</span><input data-social-url value="${escapeAttr(item.url)}" placeholder="https://"></label>
      <button type="button" class="editor-icon-button" data-remove-social-link="${index}" aria-label="Remove link">×</button>
    </div>
  `;
}

function renderBlocks(): void {
  const container = overlayRoot?.querySelector<HTMLElement>('[data-editor-blocks]');
  if (!container || !state) {
    return;
  }

  container.innerHTML = state.blocks.map((block, index) => renderBlock(block, index)).join('');

  state.blocks.forEach((block) => {
    if (block.type === 'text') {
      void requestTextPreview(block.id, block.markdown);
    }
  });

  container.querySelectorAll('textarea[data-text-block]').forEach((node) => autoResize(node as HTMLTextAreaElement));

  const addSocialButton = overlayRoot?.querySelector<HTMLElement>('[data-add-social-link]');
  if (addSocialButton && addSocialButton.dataset.bound !== 'true') {
    addSocialButton.dataset.bound = 'true';
    addSocialButton.addEventListener('click', () => {
      if (state?.mode !== 'about') {
        return;
      }
      state.settings.social_links.push({ label: '', url: '' });
      render();
      markDirty();
    });
  }

  overlayRoot?.querySelectorAll<HTMLElement>('[data-remove-social-link]').forEach((button) => {
    if (button.dataset.bound === 'true') {
      return;
    }
    button.dataset.bound = 'true';
    button.addEventListener('click', () => {
      if (state?.mode !== 'about') {
        return;
      }
      const index = Number.parseInt(button.dataset.removeSocialLink ?? '', 10);
      state.settings.social_links.splice(index, 1);
      render();
      markDirty();
    });
  });
}

function renderBlock(block: Block, index: number): string {
  return `
    ${indexInsertRow(index)}
    <article class="editor-block" draggable="true" data-draggable-block="${block.id}">
      <header class="editor-block-header">
        <div class="editor-block-meta">
          <span class="drag-handle" title="Drag to reorder">⋮⋮</span>
          <strong>${block.type}</strong>
        </div>
        <div class="editor-block-actions">
          <button type="button" class="editor-icon-button" data-move-block="${block.id}" data-direction="up" aria-label="Move up">↑</button>
          <button type="button" class="editor-icon-button" data-move-block="${block.id}" data-direction="down" aria-label="Move down">↓</button>
          <button type="button" class="editor-icon-button" data-duplicate-block="${block.id}" aria-label="Duplicate">⧉</button>
          <button type="button" class="editor-icon-button" data-delete-block="${block.id}" aria-label="Delete">×</button>
        </div>
      </header>
      ${renderBlockBody(block)}
    </article>
  `;
}

function indexInsertRow(index: number): string {
  return `
    <div class="block-insert-row">
      <button type="button" class="editor-secondary-button" data-insert-block="text" data-insert-index="${index}">+ Text</button>
      <button type="button" class="editor-secondary-button" data-insert-block="image" data-insert-index="${index}">+ Image</button>
      <button type="button" class="editor-secondary-button" data-insert-block="divider" data-insert-index="${index}">+ Divider</button>
    </div>
  `;
}

function renderBlockBody(block: Block): string {
  if (block.type === 'text') {
    const previewMode = block.previewMode ?? 'split';
    return `
      <div class="text-format-toolbar">
        ${['bold', 'italic', 'link', 'h2', 'quote', 'code', 'ul'].map((action) => (
          `<button type="button" class="editor-icon-button" data-format-action="${action}" data-block-id="${block.id}">${action}</button>`
        )).join('')}
      </div>
      <div class="text-preview-toggle">
        ${['split', 'edit', 'preview'].map((view) => (
          `<button type="button" class="editor-chip ${previewMode === view ? 'active' : ''}" data-text-view="${view}" data-block-id="${block.id}">${view}</button>`
        )).join('')}
      </div>
      <div class="text-editor-layout text-mode-${previewMode}">
        <textarea class="editor-textarea" data-text-block="${block.id}" placeholder="Write markdown...">${escapeHtml(block.markdown)}</textarea>
        <div class="text-preview rich-content" data-text-preview="${block.id}">${block.previewHtml ?? ''}</div>
      </div>
    `;
  }

  if (block.type === 'image') {
    return `
      <div class="image-editor" data-image-field="${block.id}">
        <div class="field-grid">
          ${textField('src', 'Image URL', block.src)}
          ${textField('alt', 'Alt text', block.alt)}
          ${textField('caption', 'Caption', block.caption)}
        </div>
        <div class="field-grid field-grid-compact">
          <label><span>Align</span>
            <select name="align">
              ${['left', 'center', 'right'].map((value) => `<option value="${value}" ${block.align === value ? 'selected' : ''}>${value}</option>`).join('')}
            </select>
          </label>
          <label><span>Width</span><input type="range" name="width" min="35" max="100" value="${block.width}"></label>
        </div>
        <div class="image-editor-actions">
          <button type="button" class="editor-secondary-button" data-image-upload="${block.id}">Upload image</button>
          <button type="button" class="editor-secondary-button" data-use-image-thumbnail="${block.id}">Use as thumbnail</button>
          <input type="file" accept="image/*" hidden data-block-upload-input="${block.id}">
        </div>
        <div class="image-preview-shell">
          ${block.src ? `<img src="${escapeAttr(block.src)}" alt="${escapeAttr(block.alt)}" class="image-preview">` : '<div class="image-preview placeholder">Upload an image</div>'}
        </div>
      </div>
    `;
  }

  return `<div class="divider-preview"><hr></div>`;
}

function textField(name: string, label: string, value: string, type = 'text'): string {
  return `<label><span>${label}</span><input type="${type}" name="${name}" value="${escapeAttr(value)}"></label>`;
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
  const chip = overlayRoot?.querySelector<HTMLElement>('[data-save-status]');
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

function autoResize(textarea: HTMLTextAreaElement): void {
  textarea.style.height = '0px';
  textarea.style.height = `${textarea.scrollHeight}px`;
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

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function updateEditQuery(value: string): void {
  const url = new URL(window.location.href);
  if (value) {
    url.searchParams.set(EDIT_QUERY_KEY, value);
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
  if (saveTimer) {
    window.clearTimeout(saveTimer);
    saveTimer = null;
  }
  persistScrollPosition();
  updateEditQuery('');
  overlayRoot?.classList.add('hidden');
  document.documentElement.classList.remove('editor-open');
  hideSlashMenu();
  state = null;
  lastSavedSnapshot = null;
  closeAfterSave = false;
  saveStatus = 'idle';
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
  if (overlayScrollTarget) {
    window.sessionStorage.setItem(SCROLL_STORAGE_KEY, String(overlayScrollTarget.scrollTop));
  }
}

function restoreScrollPosition(): void {
  if (!overlayScrollTarget) {
    return;
  }
  const value = Number.parseInt(window.sessionStorage.getItem(SCROLL_STORAGE_KEY) ?? '0', 10);
  if (!Number.isNaN(value)) {
    overlayScrollTarget.scrollTop = value;
  }
}

async function requestTextPreview(blockId: string, markdown: string): Promise<void> {
  const block = currentBlocks().find((item) => item.id === blockId);
  if (!block || block.type !== 'text') {
    return;
  }
  try {
    const response = await requestJSON('/api/render-markdown', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markdown }),
    });

    if (state) {
      state.blocks = replaceBlock(currentBlocks(), blockId, {
        ...block,
        previewHtml: String(response.html ?? ''),
      });
    }

    const preview = overlayRoot?.querySelector<HTMLElement>(`[data-text-preview="${blockId}"]`);
    if (preview) {
      preview.innerHTML = String(response.html ?? '');
    }
  } catch {
    // Preview failures should not block editing.
  }
}

function scheduleTextPreview(blockId: string, markdown: string): void {
  const existing = textPreviewDebouncers.get(blockId);
  if (existing) {
    window.clearTimeout(existing);
  }

  const timer = window.setTimeout(() => {
    void requestTextPreview(blockId, markdown);
  }, 160);

  textPreviewDebouncers.set(blockId, timer);
}

function detectSlashIntent(textarea: HTMLTextAreaElement, blockId: string): void {
  const cursor = textarea.selectionStart;
  const before = textarea.value.slice(0, cursor);
  const lineStart = before.lastIndexOf('\n') + 1;
  const currentLine = before.slice(lineStart);
  if (currentLine.startsWith('/')) {
    showSlashMenu(blockId, currentLine.slice(1).trim(), textarea);
  } else {
    hideSlashMenu();
  }
}

function showSlashMenu(blockId: string, query: string, anchor: HTMLElement): void {
  const menu = overlayRoot?.querySelector<HTMLElement>('[data-slash-menu]');
  if (!menu) {
    return;
  }

  activeSlashBlockId = blockId;
  const filtered = slashCommands.filter((command) => {
    if (!query) {
      return true;
    }
    const candidate = `${command.label} ${command.type} ${command.description}`.toLowerCase();
    return candidate.includes(query.toLowerCase());
  });

  if (!filtered.length) {
    hideSlashMenu();
    return;
  }

  menu.innerHTML = filtered.map((command) => `
    <button type="button" class="slash-item" data-slash-command="${command.type}">
      <strong>${command.label}</strong>
      <span>${command.description}</span>
    </button>
  `).join('');
  menu.classList.remove('hidden');

  const anchorRect = anchor.getBoundingClientRect();
  menu.style.top = `${anchorRect.bottom + window.scrollY + 8}px`;
  menu.style.left = `${anchorRect.left + window.scrollX}px`;
}

function hideSlashMenu(): void {
  const menu = overlayRoot?.querySelector<HTMLElement>('[data-slash-menu]');
  activeSlashBlockId = null;
  if (menu) {
    menu.classList.add('hidden');
    menu.innerHTML = '';
  }
}

function insertSlashCommand(blockId: string, type: BlockType): void {
  const blocks = currentBlocks();
  const index = blocks.findIndex((block) => block.id === blockId);
  if (index < 0) {
    return;
  }

  const current = blocks[index];
  if (current?.type === 'text') {
    const nextCurrent = {
      ...current,
      markdown: current.markdown.replace(/(^|\n)\/[^\n]*$/, '$1').trim(),
    };
    const nextBlocks = [...blocks];
    nextBlocks[index] = nextCurrent;
    updateBlocks(insertBlock(nextBlocks, index + 1, type));
    return;
  }

  updateBlocks(insertBlock(blocks, index + 1, type));
}

function applyFormatting(textarea: HTMLTextAreaElement, action: string): void {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selected = textarea.value.slice(start, end) || 'text';
  let replacement = selected;

  switch (action) {
    case 'bold':
      replacement = `**${selected}**`;
      break;
    case 'italic':
      replacement = `*${selected}*`;
      break;
    case 'link':
      replacement = `[${selected}](https://example.com)`;
      break;
    case 'h2':
      replacement = `## ${selected}`;
      break;
    case 'quote':
      replacement = `> ${selected}`;
      break;
    case 'code':
      replacement = `\`${selected}\``;
      break;
    case 'ul':
      replacement = `- ${selected}`;
      break;
    default:
      return;
  }

  textarea.setRangeText(replacement, start, end, 'end');
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.focus();
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
  return element?.closest<HTMLElement>('[data-draggable-block]')?.dataset.draggableBlock ?? null;
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
  const existing = activeBlockId ? currentBlocks().find((item) => item.id === activeBlockId) : null;

  if (existing?.type === 'image') {
    updateBlocks(
      replaceBlock(currentBlocks(), existing.id, uploadedImageBlock(response.url, response.block, existing)),
    );
    return;
  }

  const blocks = currentBlocks();
  const insertIndex = activeBlockId
    ? Math.max(blocks.findIndex((item) => item.id === activeBlockId) + 1, 0)
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
  applyProjectState(project as ProjectPayload);
}

async function reloadAboutFromServer(): Promise<void> {
  const payload = await requestJSON('/api/about', { method: 'GET' });
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
      pinned: false,
      thumbnail: null,
      youtube: null,
      og_image: null,
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
  const payload = await requestJSON('/api/about', { method: 'GET' });
  applyAboutState(payload as AboutPayload);
}

function openFromQueryParam(): void {
  const value = new URL(window.location.href).searchParams.get(EDIT_QUERY_KEY);
  if (!value) {
    return;
  }

  if (value === 'about') {
    void openAboutEditor();
    return;
  }
  void openProjectEditor(value);
}

export function initEditMode(): void {
  if (document.body.dataset.editMode !== 'true' || isHydrating) {
    return;
  }
  isHydrating = true;
  bindLauncherEvents();
  getOverlayRoot();
  openFromQueryParam();
}

export function resetEditModeForTests(): void {
  if (saveTimer) {
    window.clearTimeout(saveTimer);
    saveTimer = null;
  }
  textPreviewDebouncers.forEach((timer) => window.clearTimeout(timer));
  textPreviewDebouncers.clear();
  overlayRoot?.remove();
  overlayRoot = null;
  overlayScrollTarget = null;
  state = null;
  saveStatus = 'idle';
  isHydrating = false;
  activeSlashBlockId = null;
  lastSavedSnapshot = null;
  closeAfterSave = false;
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
