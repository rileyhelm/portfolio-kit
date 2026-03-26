import { INLINE_MAX_DEPTH, findNextInlineMatch, renderInlineMarkdown, sanitizeUrl } from './inline-markdown';
import { applyTextFormatting, textFormattingShortcut } from './text-formatting';

type LinePreviewType =
  | 'empty'
  | 'divider'
  | 'heading-1'
  | 'heading-2'
  | 'heading-3'
  | 'heading-4'
  | 'heading-5'
  | 'heading-6'
  | 'quote'
  | 'list'
  | 'paragraph';

interface LinePreviewResult {
  node: Node;
  type: LinePreviewType;
}

interface CaretPositionLike {
  offsetNode: Node;
  offset: number;
}

type CaretPointDocument = Document & {
  caretPositionFromPoint?: (x: number, y: number) => CaretPositionLike | null;
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
};

interface CreateTextLineEditorOptions {
  blockId: string;
  markdown: string;
  onSelectionChange?: (hasSelection: boolean) => void;
  onUpdate: (markdown: string) => void;
}

function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x00-\x7F]/g, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '-');
}

function uniqueSlug(slug: string, existing: Set<string>): string {
  if (!existing.has(slug) && slug) {
    existing.add(slug);
    return slug;
  }

  const match = slug.match(/^(.+)_(\d+)$/);
  const base = match?.[1] ?? slug;
  let counter = match?.[2] ? Number.parseInt(match[2], 10) + 1 : 1;
  let candidate = `${base}_${counter}`;
  while (existing.has(candidate)) {
    counter += 1;
    candidate = `${base}_${counter}`;
  }
  existing.add(candidate);
  return candidate;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function mapLiteralToRawBoundaries(text: string, rawStart: number): number[] {
  const map = [rawStart];
  for (let index = 0; index < text.length; index += 1) {
    map.push(rawStart + index + 1);
  }
  return map;
}

function appendBoundaryMap(target: number[], incoming: number[]): void {
  if (!incoming.length) {
    return;
  }
  target[target.length - 1] = incoming[0] ?? target[target.length - 1] ?? 0;
  if (incoming.length > 1) {
    target.push(...incoming.slice(1));
  }
}

function mapInlineToRawBoundaries(text: string, rawStart: number, depth = 0): number[] {
  const map = [rawStart];
  if (!text) {
    return map;
  }

  if (depth >= INLINE_MAX_DEPTH) {
    appendBoundaryMap(map, mapLiteralToRawBoundaries(text, rawStart));
    return map;
  }

  let cursor = 0;
  while (cursor < text.length) {
    const remaining = text.slice(cursor);
    const match = findNextInlineMatch(remaining);

    if (!match) {
      appendBoundaryMap(map, mapLiteralToRawBoundaries(remaining, rawStart + cursor));
      break;
    }

    if (match.index > 0) {
      const literal = remaining.slice(0, match.index);
      appendBoundaryMap(map, mapLiteralToRawBoundaries(literal, rawStart + cursor));
    }

    const tokenStart = cursor + match.index;
    const tokenRawStart = rawStart + tokenStart;
    const tokenText = remaining.slice(match.index, match.index + match.length);
    const contentIndex = tokenText.indexOf(match.content);

    if (contentIndex < 0) {
      appendBoundaryMap(map, mapLiteralToRawBoundaries(tokenText, tokenRawStart));
      cursor = tokenStart + match.length;
      continue;
    }

    const contentRawStart = tokenRawStart + contentIndex;
    const tokenMap = match.tagName === 'code'
      ? mapLiteralToRawBoundaries(match.content, contentRawStart)
      : mapInlineToRawBoundaries(match.content, contentRawStart, depth + 1);
    appendBoundaryMap(map, tokenMap);

    cursor = tokenStart + match.length;
  }

  return map;
}

function mapRenderedToRawBoundaries(lineText: string, lineType: string | undefined): number[] {
  if (!lineText) {
    return [0];
  }
  if (lineType === 'divider') {
    return [lineText.length];
  }

  let bodyStart = 0;
  if (lineType?.startsWith('heading-')) {
    const headingPrefix = lineText.match(/^(\s*)(#{1,6})\s+/);
    if (headingPrefix) {
      bodyStart = headingPrefix[0].length;
    }
  } else if (lineType === 'quote') {
    const quotePrefix = lineText.match(/^(\s*)>\s+/);
    if (quotePrefix) {
      bodyStart = quotePrefix[0].length;
    }
  }

  const body = lineText.slice(bodyStart);
  const map = [bodyStart];
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = linkRegex.exec(body)) !== null) {
    const offset = match.index;
    if (offset > lastIndex) {
      const before = body.slice(lastIndex, offset);
      appendBoundaryMap(map, mapInlineToRawBoundaries(before, bodyStart + lastIndex));
    }

    const wholeMatch = match[0] ?? '';
    const linkText = match[1] ?? '';
    const linkUrl = match[2] ?? '';
    if (sanitizeUrl(linkUrl)) {
      appendBoundaryMap(map, mapInlineToRawBoundaries(linkText, bodyStart + offset + 1));
    } else {
      appendBoundaryMap(map, mapLiteralToRawBoundaries(wholeMatch, bodyStart + offset));
    }

    lastIndex = offset + wholeMatch.length;
  }

  if (lastIndex < body.length) {
    const tail = body.slice(lastIndex);
    appendBoundaryMap(map, mapInlineToRawBoundaries(tail, bodyStart + lastIndex));
  }

  return map;
}

function renderLinePreview(lineText: string, headingSlugState: Set<string>): LinePreviewResult {
  const trimmed = lineText.trim();
  if (!trimmed) {
    const empty = document.createElement('span');
    empty.innerHTML = '&nbsp;';
    return { node: empty, type: 'empty' };
  }

  if (/^(\*{3,}|-{3,}|_{3,})$/.test(trimmed)) {
    const divider = document.createElement('hr');
    divider.className = 'text-line-divider';
    return { node: divider, type: 'divider' };
  }

  const headingMatch = lineText.match(/^(\s*)(#{1,6})\s+(.*)$/);
  if (headingMatch) {
    const level = headingMatch[2]?.length ?? 1;
    const heading = document.createElement(`h${level}`) as HTMLHeadingElement;
    heading.appendChild(renderInlineMarkdown(headingMatch[3] ?? ''));
    const baseSlug = slugify(heading.textContent?.trim() ?? '');
    if (baseSlug) {
      heading.id = uniqueSlug(baseSlug, headingSlugState);
    }
    return { node: heading, type: `heading-${level}` as LinePreviewType };
  }

  const quoteMatch = lineText.match(/^(\s*)>\s+(.*)$/);
  if (quoteMatch) {
    const quote = document.createElement('blockquote');
    quote.appendChild(renderInlineMarkdown(quoteMatch[2] ?? ''));
    return { node: quote, type: 'quote' };
  }

  if (/^(\s*)([-*+]|\d+\.)\s+/.test(lineText)) {
    const span = document.createElement('span');
    span.appendChild(renderInlineMarkdown(lineText));
    return { node: span, type: 'list' };
  }

  const span = document.createElement('span');
  span.appendChild(renderInlineMarkdown(lineText));
  return { node: span, type: 'paragraph' };
}

function hasExpandedSelectionInNode(node: Node): boolean {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return false;
  }

  for (let index = 0; index < selection.rangeCount; index += 1) {
    const range = selection.getRangeAt(index);
    try {
      if (range.intersectsNode(node)) {
        return true;
      }
    } catch {
      // Ignore transient DOM selection states while the browser updates the range.
    }
  }

  return false;
}

function getPreviewTextOffsetFromPoint(preview: HTMLElement, event: MouseEvent): number | null {
  const doc = preview.ownerDocument as CaretPointDocument;
  const { clientX, clientY } = event;

  let container: Node | null = null;
  let offset = 0;

  if (typeof doc.caretPositionFromPoint === 'function') {
    const position = doc.caretPositionFromPoint(clientX, clientY);
    if (position) {
      container = position.offsetNode;
      offset = position.offset;
    }
  }

  if (!container && typeof doc.caretRangeFromPoint === 'function') {
    const range = doc.caretRangeFromPoint(clientX, clientY);
    if (range) {
      container = range.startContainer;
      offset = range.startOffset;
    }
  }

  if (!container || (container !== preview && !preview.contains(container))) {
    return null;
  }

  const range = doc.createRange();
  range.selectNodeContents(preview);
  try {
    range.setEnd(container, offset);
  } catch {
    return null;
  }

  return range.toString().length;
}

function getPreviewTextOffsetFromBoundary(preview: HTMLElement, container: Node, offset: number): number | null {
  if (container !== preview && !preview.contains(container)) {
    return null;
  }

  const range = preview.ownerDocument.createRange();
  range.selectNodeContents(preview);
  try {
    range.setEnd(container, offset);
  } catch {
    return null;
  }

  return range.toString().length;
}

function getSelectedRawRangeForPreview(row: HTMLElement): { start: number; end: number } | null {
  const textarea = row.querySelector<HTMLTextAreaElement>('.text-line-input');
  const preview = row.querySelector<HTMLElement>('.text-block-line-preview');
  if (!textarea || !preview) {
    return null;
  }

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }

  let startRendered: number | null = null;
  let endRendered: number | null = null;
  for (let index = 0; index < selection.rangeCount; index += 1) {
    const range = selection.getRangeAt(index);
    try {
      if (!range.intersectsNode(preview)) {
        continue;
      }
    } catch {
      continue;
    }

    const start = getPreviewTextOffsetFromBoundary(preview, range.startContainer, range.startOffset);
    const end = getPreviewTextOffsetFromBoundary(preview, range.endContainer, range.endOffset);
    if (start === null || end === null) {
      continue;
    }

    startRendered = Math.min(start, end);
    endRendered = Math.max(start, end);
    break;
  }

  if (startRendered === null || endRendered === null || startRendered === endRendered) {
    return null;
  }

  const boundaries = mapRenderedToRawBoundaries(textarea.value, row.dataset.lineType);
  if (!boundaries.length) {
    return null;
  }

  const rawStart = boundaries[clamp(startRendered, 0, boundaries.length - 1)] ?? textarea.value.length;
  const rawEnd = boundaries[clamp(endRendered, 0, boundaries.length - 1)] ?? textarea.value.length;
  if (rawStart === rawEnd) {
    return null;
  }

  return {
    start: Math.min(rawStart, rawEnd),
    end: Math.max(rawStart, rawEnd),
  };
}

function getClickedCaretForPreview(row: HTMLElement, event: MouseEvent): number | null {
  const textarea = row.querySelector<HTMLTextAreaElement>('.text-line-input');
  const preview = row.querySelector<HTMLElement>('.text-block-line-preview');
  if (!textarea || !preview) {
    return null;
  }

  const renderedOffset = getPreviewTextOffsetFromPoint(preview, event);
  if (renderedOffset === null) {
    return null;
  }

  const boundaries = mapRenderedToRawBoundaries(textarea.value, row.dataset.lineType);
  if (!boundaries.length) {
    return null;
  }

  const boundaryIndex = clamp(renderedOffset, 0, boundaries.length - 1);
  return boundaries[boundaryIndex] ?? textarea.value.length;
}

export function createTextLineEditor(options: CreateTextLineEditorOptions): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'text-block-editor rich-content';
  wrapper.dataset.textBlockRoot = options.blockId;

  const lineContainer = document.createElement('div');
  lineContainer.className = 'text-block-lines';
  wrapper.appendChild(lineContainer);

  let lines = options.markdown.split('\n');
  if (!lines.length) {
    lines = [''];
  }

  let activeLineIndex: number | null = null;
  let suppressNextLineActivationClick = false;

  const notifySelectionChange = (hasSelection: boolean): void => {
    options.onSelectionChange?.(hasSelection);
  };

  const updateSelectionState = (textarea: HTMLTextAreaElement | null): void => {
    notifySelectionChange(Boolean(textarea && document.activeElement === textarea && textarea.selectionStart !== textarea.selectionEnd));
  };

  const updateMarkdown = (): void => {
    options.onUpdate(lines.join('\n'));
  };

  const syncLineHeight = (row: HTMLElement): void => {
    const preview = row.querySelector<HTMLElement>('.text-block-line-preview');
    const textarea = row.querySelector<HTMLTextAreaElement>('.text-line-input');

    requestAnimationFrame(() => {
      const previewHeight = preview?.offsetHeight ?? 0;
      const inputHeight = textarea?.scrollHeight ?? 0;
      const minHeight = Math.max(27, previewHeight);
      row.style.minHeight = `${minHeight}px`;
      if (row.classList.contains('is-editing')) {
        row.style.height = `${Math.max(minHeight, inputHeight)}px`;
      } else {
        row.style.height = '';
      }
    });
  };

  const getListContinuation = (lineText: string): string | null => {
    const unorderedMatch = lineText.match(/^(\s*)([-*+])\s+/);
    if (unorderedMatch) {
      return `${unorderedMatch[1] ?? ''}${unorderedMatch[2] ?? '-'} `;
    }
    const orderedMatch = lineText.match(/^(\s*)(\d+)\.\s+/);
    if (orderedMatch) {
      return `${orderedMatch[1] ?? ''}${Number.parseInt(orderedMatch[2] ?? '1', 10) + 1}. `;
    }
    return null;
  };

  const activateLine = (
    row: HTMLElement,
    selection: number | { start: number; end?: number } | null = null,
  ): void => {
    const lineIndex = Number.parseInt(row.dataset.lineIndex ?? '', 10);
    if (Number.isNaN(lineIndex)) {
      return;
    }

    if (activeLineIndex !== null && activeLineIndex !== lineIndex) {
      const previousRow = lineContainer.querySelector<HTMLElement>(`.text-block-line[data-line-index="${activeLineIndex}"]`);
      if (previousRow) {
        deactivateLine(previousRow);
      }
    }

    activeLineIndex = lineIndex;
    row.classList.add('is-editing');

    const textarea = row.querySelector<HTMLTextAreaElement>('.text-line-input');
    if (!textarea) {
      return;
    }

    textarea.focus({ preventScroll: true });
    if (selection && typeof selection === 'object') {
      textarea.selectionStart = selection.start;
      textarea.selectionEnd = selection.end ?? selection.start;
    } else if (typeof selection === 'number') {
      textarea.selectionStart = selection;
      textarea.selectionEnd = selection;
    } else {
      textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
    }

    updateSelectionState(textarea);
    syncLineHeight(row);
  };

  const deactivateLine = (row: HTMLElement): void => {
    const textarea = row.querySelector<HTMLTextAreaElement>('.text-line-input');
    const preview = row.querySelector<HTMLElement>('.text-block-line-preview');
    const lineIndex = Number.parseInt(row.dataset.lineIndex ?? '', 10);
    const currentText = textarea?.value ?? '';

    row.classList.remove('is-editing');
    preview?.classList.remove('text-block-line-placeholder');
    if (preview) {
      preview.innerHTML = '';
    }

    const isSingleEmptyLine = lines.length === 1 && !lines[0]?.trim();
    if (isSingleEmptyLine && !currentText.trim()) {
      row.dataset.lineType = 'empty';
      preview?.classList.add('text-block-line-placeholder');
      if (preview) {
        preview.textContent = 'Type something...';
      }
    } else if (preview) {
      const headingSlugState = new Set<string>();
      if (!Number.isNaN(lineIndex)) {
        for (let index = 0; index < lineIndex; index += 1) {
          const priorText = lines[index] ?? '';
          const priorHeadingMatch = priorText.match(/^(\s*)(#{1,6})\s+(.*)$/);
          if (!priorHeadingMatch) {
            continue;
          }
          const priorPreview = document.createElement('span');
          priorPreview.appendChild(renderInlineMarkdown(priorHeadingMatch[3] ?? ''));
          const priorBaseSlug = slugify(priorPreview.textContent?.trim() ?? '');
          if (priorBaseSlug) {
            uniqueSlug(priorBaseSlug, headingSlugState);
          }
        }
      }

      const rendered = renderLinePreview(currentText, headingSlugState);
      row.dataset.lineType = rendered.type;
      preview.appendChild(rendered.node);
    }

    activeLineIndex = null;
    notifySelectionChange(false);
    syncLineHeight(row);
  };

  const renderLines = (
    focusLineIndex: number | null = null,
    focusCaret: number | { start: number; end?: number } | null = null,
  ): void => {
    lineContainer.innerHTML = '';
    const headingSlugState = new Set<string>();
    lines.forEach((lineText, lineIndex) => {
      const row = document.createElement('div');
      row.className = 'text-block-line';
      row.dataset.lineIndex = String(lineIndex);

      const preview = document.createElement('div');
      preview.className = 'text-block-line-preview';
      const isSingleEmptyLine = lines.length === 1 && !lines[0]?.trim();
      if (isSingleEmptyLine) {
        row.dataset.lineType = 'empty';
        preview.classList.add('text-block-line-placeholder');
        preview.textContent = 'Type something...';
      } else {
        const rendered = renderLinePreview(lineText, headingSlugState);
        row.dataset.lineType = rendered.type;
        preview.appendChild(rendered.node);
      }

      const textarea = document.createElement('textarea');
      textarea.className = 'text-line-input';
      textarea.dataset.textLineInput = options.blockId;
      textarea.value = lineText;
      textarea.rows = 1;
      textarea.placeholder = 'Type something...';

      preview.addEventListener('mouseup', (event) => {
        if (row.classList.contains('is-editing')) {
          return;
        }
        const selectionRange = getSelectedRawRangeForPreview(row);
        if (!selectionRange) {
          return;
        }
        suppressNextLineActivationClick = true;
        event.stopPropagation();
        activateLine(row, selectionRange);
      });

      preview.addEventListener('click', (event) => {
        if (suppressNextLineActivationClick) {
          suppressNextLineActivationClick = false;
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        if (hasExpandedSelectionInNode(preview)) {
          event.stopPropagation();
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        activateLine(row, getClickedCaretForPreview(row, event));
      });

      row.addEventListener('click', (event) => {
        if (suppressNextLineActivationClick) {
          suppressNextLineActivationClick = false;
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        if (hasExpandedSelectionInNode(row)) {
          return;
        }
        if (!row.classList.contains('is-editing')) {
          event.preventDefault();
          event.stopPropagation();
          activateLine(row);
        }
      });

      textarea.addEventListener('input', () => {
        const nextValue = textarea.value;
        if (nextValue.includes('\n')) {
          const splitLines = nextValue.split('\n');
          lines.splice(lineIndex, 1, ...splitLines);
          updateMarkdown();
          const lastLineText = splitLines[splitLines.length - 1] ?? '';
          renderLines(lineIndex + splitLines.length - 1, lastLineText.length);
          return;
        }

        const currentLineIndex = Number.parseInt(row.dataset.lineIndex ?? '', 10);
        const targetLineIndex = Number.isNaN(currentLineIndex) ? lineIndex : currentLineIndex;
        lines[targetLineIndex] = nextValue;
        updateMarkdown();
        updateSelectionState(textarea);
        syncLineHeight(row);
      });

      textarea.addEventListener('keydown', (event) => {
        const currentLineIndex = Number.parseInt(row.dataset.lineIndex ?? '', 10);
        const targetLineIndex = Number.isNaN(currentLineIndex) ? lineIndex : currentLineIndex;
        const shortcutAction = textFormattingShortcut(event);

        if (shortcutAction) {
          event.preventDefault();
          applyTextFormatting(textarea, shortcutAction);
          updateSelectionState(textarea);
          return;
        }

        if (event.key === 'Enter' && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
          event.preventDefault();
          const value = textarea.value;
          const cursor = textarea.selectionStart;
          const before = value.slice(0, cursor);
          const after = value.slice(cursor);
          const listContinuation = getListContinuation(before);

          lines[targetLineIndex] = before;
          lines.splice(
            targetLineIndex + 1,
            0,
            listContinuation ? listContinuation + after.replace(/^\s+/, '') : after,
          );
          updateMarkdown();
          renderLines(targetLineIndex + 1, listContinuation ? listContinuation.length : 0);
          return;
        }

        if (event.key === 'Backspace' && textarea.selectionStart === 0 && textarea.selectionEnd === 0) {
          if (targetLineIndex > 0) {
            event.preventDefault();
            const previous = lines[targetLineIndex - 1] ?? '';
            const current = lines[targetLineIndex] ?? '';
            lines.splice(targetLineIndex - 1, 2, previous + current);
            updateMarkdown();
            renderLines(targetLineIndex - 1, previous.length);
          }
          return;
        }

        if (
          event.key === 'Delete'
          && textarea.selectionStart === textarea.value.length
          && textarea.selectionEnd === textarea.value.length
        ) {
          if (targetLineIndex < lines.length - 1) {
            event.preventDefault();
            const current = lines[targetLineIndex] ?? '';
            const next = lines[targetLineIndex + 1] ?? '';
            lines.splice(targetLineIndex, 2, current + next);
            updateMarkdown();
            renderLines(targetLineIndex, current.length);
          }
          return;
        }

        if (
          event.key === 'ArrowLeft'
          && !event.shiftKey
          && !event.metaKey
          && !event.ctrlKey
          && !event.altKey
          && textarea.selectionStart === 0
          && textarea.selectionEnd === 0
        ) {
          if (targetLineIndex > 0) {
            event.preventDefault();
            renderLines(targetLineIndex - 1, lines[targetLineIndex - 1]?.length ?? 0);
          }
          return;
        }

        if (
          event.key === 'ArrowRight'
          && !event.shiftKey
          && !event.metaKey
          && !event.ctrlKey
          && !event.altKey
          && textarea.selectionStart === textarea.value.length
          && textarea.selectionEnd === textarea.value.length
        ) {
          if (targetLineIndex < lines.length - 1) {
            event.preventDefault();
            renderLines(targetLineIndex + 1, 0);
          }
          return;
        }

        if (event.key === 'ArrowUp' && textarea.selectionStart === 0 && textarea.selectionEnd === 0) {
          if (targetLineIndex > 0) {
            event.preventDefault();
            renderLines(targetLineIndex - 1, lines[targetLineIndex - 1]?.length ?? 0);
          }
          return;
        }

        if (
          event.key === 'ArrowDown'
          && textarea.selectionStart === textarea.value.length
          && textarea.selectionEnd === textarea.value.length
          && targetLineIndex < lines.length - 1
        ) {
          event.preventDefault();
          renderLines(targetLineIndex + 1, 0);
        }
      });

      textarea.addEventListener('select', () => {
        updateSelectionState(textarea);
      });

      textarea.addEventListener('focus', () => {
        updateSelectionState(textarea);
      });

      textarea.addEventListener('mouseup', () => {
        updateSelectionState(textarea);
      });

      textarea.addEventListener('keyup', () => {
        updateSelectionState(textarea);
      });

      textarea.addEventListener('blur', () => {
        notifySelectionChange(false);
        if (activeLineIndex !== lineIndex) {
          return;
        }
        deactivateLine(row);
      });

      row.appendChild(preview);
      row.appendChild(textarea);
      lineContainer.appendChild(row);
    });

    requestAnimationFrame(() => {
      lineContainer.querySelectorAll<HTMLElement>('.text-block-line').forEach((row) => {
        syncLineHeight(row);
      });
    });

    if (focusLineIndex !== null) {
      const row = lineContainer.querySelector<HTMLElement>(`.text-block-line[data-line-index="${focusLineIndex}"]`);
      if (row) {
        activateLine(row, focusCaret);
      }
    }
  };

  lineContainer.addEventListener('click', (event) => {
    if (event.target !== lineContainer) {
      return;
    }

    const rows = Array.from(lineContainer.querySelectorAll<HTMLElement>('.text-block-line'));
    if (!rows.length) {
      return;
    }

    const clickY = (event as MouseEvent).clientY;
    let closestRow: HTMLElement | null = null;
    let closestDistance = Number.POSITIVE_INFINITY;
    for (const row of rows) {
      const rect = row.getBoundingClientRect();
      const rowMiddle = rect.top + rect.height / 2;
      const distance = Math.abs(clickY - rowMiddle);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestRow = row;
      }
    }

    if (closestRow && !closestRow.classList.contains('is-editing')) {
      event.preventDefault();
      activateLine(closestRow);
    }
  });

  renderLines();
  return wrapper;
}
