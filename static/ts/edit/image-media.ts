import type { Align, ImageBlock } from '../types';

type HandlePosition = 'nw' | 'ne' | 'sw' | 'se';

interface Callbacks {
  getRoot: () => ParentNode | null;
  getBlock: (blockId: string) => ImageBlock | null;
  updateBlock: (
    blockId: string,
    updates: Partial<ImageBlock>,
    options?: { markDirty?: boolean },
  ) => void;
  markDirty: () => void;
  isActive: () => boolean;
}

interface SelectedImage {
  blockId: string;
  element: HTMLImageElement;
  field: HTMLElement;
}

interface ResizeState {
  position: HandlePosition;
  startX: number;
  startWidthPx: number;
  containerWidthPx: number;
  minWidthPx: number;
  maxWidthPx: number;
  lastWidthPercent: number;
}

const RESIZE_CONFIG = {
  MIN_WIDTH_PERCENT: 35,
  MAX_WIDTH_PERCENT: 100,
  FULL_WIDTH_THRESHOLD: 1,
} as const;

let callbacks: Callbacks | null = null;
let selectedImage: SelectedImage | null = null;
let selectedBlockId: string | null = null;
let resizeHandles: HTMLDivElement[] = [];
let resizeState: ResizeState | null = null;
let isResizing = false;
let listenersBound = false;
let boundHandleResize: ((event: MouseEvent) => void) | null = null;
let boundStopResize: (() => void) | null = null;
let boundSyncSelection: (() => void) | null = null;
let boundDocumentClick: ((event: MouseEvent) => void) | null = null;

export function init(nextCallbacks: Callbacks): void {
  callbacks = nextCallbacks;
  bindListeners();
}

export function syncSelectionFromDOM(): void {
  if (!selectedBlockId) {
    deselect();
    return;
  }

  const root = callbacks?.getRoot();
  if (!root) {
    deselect();
    return;
  }

  const element = root.querySelector<HTMLImageElement>(`[data-image-preview="${selectedBlockId}"]`);
  const field = root.querySelector<HTMLElement>(`[data-image-field="${selectedBlockId}"]`);
  if (!element || !field) {
    deselect();
    return;
  }

  applySelection(element, field, selectedBlockId);
}

export function select(element: HTMLImageElement, blockId: string): void {
  if (!blockId) {
    return;
  }

  const field = element.closest<HTMLElement>(`[data-image-field="${blockId}"]`);
  if (!field) {
    return;
  }

  applySelection(element, field, blockId);
}

export function deselect(): void {
  if (isResizing) {
    stopResize();
  }

  if (selectedImage) {
    selectedImage.element.classList.remove('is-selected');
    selectedImage.field.classList.remove('is-selected');
  }

  selectedImage = null;
  selectedBlockId = null;
  removeResizeHandles();
}

export function setAlignment(blockId: string, align: Align): void {
  const block = callbacks?.getBlock(blockId);
  if (!block || block.align === align) {
    return;
  }

  callbacks?.updateBlock(blockId, { align }, { markDirty: true });
  updateAlignmentUI(blockId, align);
}

export function reset(): void {
  deselect();
}

function bindListeners(): void {
  if (listenersBound) {
    return;
  }

  boundHandleResize = (event: MouseEvent) => handleResize(event);
  boundStopResize = () => stopResize();
  boundSyncSelection = () => updateHandlePositions();
  boundDocumentClick = (event: MouseEvent) => {
    if (!callbacks?.isActive() || !selectedImage || isResizing) {
      return;
    }

    const target = event.target as HTMLElement | null;
    if (!target) {
      return;
    }

    if (target.closest('.image-resize-handle')) {
      return;
    }
    if (target.closest('.image-align-toolbar')) {
      return;
    }
    if (target.closest(`[data-image-preview="${selectedImage.blockId}"]`)) {
      return;
    }
    if (target.closest(`[data-image-field="${selectedImage.blockId}"]`)) {
      return;
    }

    deselect();
  };

  document.addEventListener('click', boundDocumentClick);
  window.addEventListener('resize', boundSyncSelection);
  window.addEventListener('scroll', boundSyncSelection, true);
  listenersBound = true;
}

function applySelection(element: HTMLImageElement, field: HTMLElement, blockId: string): void {
  if (selectedImage && selectedImage.blockId === blockId && selectedImage.element === element) {
    updateHandlePositions();
    return;
  }

  if (selectedImage) {
    selectedImage.element.classList.remove('is-selected');
    selectedImage.field.classList.remove('is-selected');
  }

  removeResizeHandles();
  selectedBlockId = blockId;
  selectedImage = { blockId, element, field };
  element.classList.add('is-selected');
  field.classList.add('is-selected');
  createResizeHandles(element);
  updateAlignmentUI(blockId, callbacks?.getBlock(blockId)?.align ?? 'left');
  updateHandlePositions();
}

function createResizeHandles(element: HTMLImageElement): void {
  removeResizeHandles();

  (['nw', 'ne', 'sw', 'se'] as HandlePosition[]).forEach((position) => {
    const handle = document.createElement('div');
    handle.className = `image-resize-handle ${position}`;
    handle.dataset.position = position;
    handle.addEventListener('mousedown', (event) => startResize(event, position));
    document.body.appendChild(handle);
    resizeHandles.push(handle);
  });

  updateHandlePositions(element.getBoundingClientRect());
}

function updateHandlePositions(rectOverride?: DOMRect): void {
  if (!selectedImage || !resizeHandles.length) {
    return;
  }

  const rect = rectOverride ?? selectedImage.element.getBoundingClientRect();
  const offset = 6;

  resizeHandles.forEach((handle) => {
    const position = handle.dataset.position as HandlePosition;
    handle.style.position = 'fixed';

    switch (position) {
      case 'nw':
        handle.style.top = `${rect.top - offset}px`;
        handle.style.left = `${rect.left - offset}px`;
        break;
      case 'ne':
        handle.style.top = `${rect.top - offset}px`;
        handle.style.left = `${rect.right - offset}px`;
        break;
      case 'sw':
        handle.style.top = `${rect.bottom - offset}px`;
        handle.style.left = `${rect.left - offset}px`;
        break;
      case 'se':
        handle.style.top = `${rect.bottom - offset}px`;
        handle.style.left = `${rect.right - offset}px`;
        break;
    }
  });
}

function removeResizeHandles(): void {
  resizeHandles.forEach((handle) => handle.remove());
  resizeHandles = [];
}

function startResize(event: MouseEvent, position: HandlePosition): void {
  if (!selectedImage) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  const elementRect = selectedImage.element.getBoundingClientRect();
  const stage = selectedImage.element.closest<HTMLElement>('[data-image-stage]');
  const stageRect = stage?.getBoundingClientRect();
  if (!elementRect.width || !stageRect?.width) {
    return;
  }

  const minWidthPx = (stageRect.width * RESIZE_CONFIG.MIN_WIDTH_PERCENT) / 100;
  const maxWidthPx = (stageRect.width * RESIZE_CONFIG.MAX_WIDTH_PERCENT) / 100;

  resizeState = {
    position,
    startX: event.clientX,
    startWidthPx: elementRect.width,
    containerWidthPx: stageRect.width,
    minWidthPx,
    maxWidthPx,
    lastWidthPercent: clampPercent((elementRect.width / stageRect.width) * 100),
  };

  isResizing = true;
  selectedImage.element.classList.add('is-resizing');
  document.body.style.userSelect = 'none';

  if (boundHandleResize && boundStopResize) {
    document.addEventListener('mousemove', boundHandleResize);
    document.addEventListener('mouseup', boundStopResize);
  }
}

function handleResize(event: MouseEvent): void {
  if (!selectedImage || !resizeState) {
    return;
  }

  let deltaX = event.clientX - resizeState.startX;
  if (resizeState.position === 'nw' || resizeState.position === 'sw') {
    deltaX = -deltaX;
  }

  const widthPx = clamp(
    resizeState.startWidthPx + deltaX,
    resizeState.minWidthPx,
    resizeState.maxWidthPx,
  );
  const widthPercent = clampPercent((widthPx / resizeState.containerWidthPx) * 100);

  resizeState.lastWidthPercent = widthPercent;
  applyWidthUI(selectedImage.element, widthPercent);
  callbacks?.updateBlock(selectedImage.blockId, { width: widthPercent }, { markDirty: false });
  updateHandlePositions();
}

function stopResize(): void {
  if (!isResizing) {
    return;
  }

  isResizing = false;

  if (selectedImage) {
    selectedImage.element.classList.remove('is-resizing');
  }

  if (boundHandleResize && boundStopResize) {
    document.removeEventListener('mousemove', boundHandleResize);
    document.removeEventListener('mouseup', boundStopResize);
  }

  document.body.style.userSelect = '';

  if (resizeState && selectedImage) {
    const nextWidth = resizeState.lastWidthPercent;
    callbacks?.updateBlock(selectedImage.blockId, { width: nextWidth }, { markDirty: false });
    callbacks?.markDirty();
    applyWidthUI(selectedImage.element, nextWidth);
  }

  resizeState = null;
}

function updateAlignmentUI(blockId: string, align: Align): void {
  const root = callbacks?.getRoot();
  const stage = root?.querySelector<HTMLElement>(`[data-image-stage="${blockId}"]`);
  if (stage) {
    stage.classList.remove('align-left', 'align-center', 'align-right');
    stage.classList.add(`align-${align}`);
  }

  root?.querySelectorAll<HTMLElement>(`[data-image-align-block="${blockId}"]`).forEach((button) => {
    button.classList.toggle('is-active', button.dataset.imageAlign === align);
  });
}

function applyWidthUI(element: HTMLImageElement, widthPercent: number): void {
  element.style.width = 'auto';
  element.style.maxWidth = `${widthPercent}%`;
  element.style.height = 'auto';
}

function clampPercent(value: number): number {
  const clamped = clamp(
    value,
    RESIZE_CONFIG.MIN_WIDTH_PERCENT,
    RESIZE_CONFIG.MAX_WIDTH_PERCENT,
  );

  if (Math.abs(clamped - RESIZE_CONFIG.MAX_WIDTH_PERCENT) <= RESIZE_CONFIG.FULL_WIDTH_THRESHOLD) {
    return RESIZE_CONFIG.MAX_WIDTH_PERCENT;
  }

  return Math.round(clamped);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
