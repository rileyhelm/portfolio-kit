import { sanitizeUrl } from './inline-markdown';

export type TextFormatAction = 'bold' | 'italic' | 'link' | 'h2' | 'quote' | 'list';

function normalizeLinkUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return trimmed;
  }

  if (
    trimmed.startsWith('#')
    || trimmed.startsWith('/')
    || trimmed.startsWith('./')
    || trimmed.startsWith('../')
    || /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
  ) {
    return trimmed;
  }

  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return `mailto:${trimmed}`;
  }

  return `https://${trimmed}`;
}

function placeholderFor(action: TextFormatAction): string {
  switch (action) {
    case 'link':
      return 'link text';
    default:
      return 'text';
  }
}

function selectionForReplacement(
  action: TextFormatAction,
  start: number,
  insertedTextLength: number,
  replacement: string,
): { start: number; end: number } {
  switch (action) {
    case 'bold':
      return { start: start + 2, end: start + 2 + insertedTextLength };
    case 'italic':
      return { start: start + 1, end: start + 1 + insertedTextLength };
    case 'link':
      return { start: start + 1, end: start + 1 + insertedTextLength };
    default:
      return { start: start, end: start + replacement.length };
  }
}

function replacementFor(textarea: HTMLTextAreaElement, action: TextFormatAction): {
  replacement: string;
  selectionStart: number;
  selectionEnd: number;
} | null {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selected = textarea.value.slice(start, end) || placeholderFor(action);

  switch (action) {
    case 'bold': {
      const replacement = `**${selected}**`;
      const selection = selectionForReplacement(action, start, selected.length, replacement);
      return { replacement, selectionStart: selection.start, selectionEnd: selection.end };
    }
    case 'italic': {
      const replacement = `*${selected}*`;
      const selection = selectionForReplacement(action, start, selected.length, replacement);
      return { replacement, selectionStart: selection.start, selectionEnd: selection.end };
    }
    case 'link': {
      const prompted = window.prompt('Enter a URL for this link.', 'https://');
      if (prompted === null) {
        return null;
      }

      const normalized = normalizeLinkUrl(prompted);
      const safeUrl = sanitizeUrl(normalized);
      if (!safeUrl) {
        return null;
      }

      const replacement = `[${selected}](${safeUrl})`;
      const selection = selectionForReplacement(action, start, selected.length, replacement);
      return { replacement, selectionStart: selection.start, selectionEnd: selection.end };
    }
    case 'h2': {
      const replacement = `## ${selected}`;
      return { replacement, selectionStart: start, selectionEnd: start + replacement.length };
    }
    case 'quote': {
      const replacement = `> ${selected}`;
      return { replacement, selectionStart: start, selectionEnd: start + replacement.length };
    }
    case 'list': {
      const replacement = `- ${selected}`;
      return { replacement, selectionStart: start, selectionEnd: start + replacement.length };
    }
    default:
      return null;
  }
}

export function applyTextFormatting(textarea: HTMLTextAreaElement, action: TextFormatAction): boolean {
  const formatted = replacementFor(textarea, action);
  if (!formatted) {
    return false;
  }

  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  textarea.setRangeText(formatted.replacement, start, end, 'end');
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.focus();
  textarea.selectionStart = formatted.selectionStart;
  textarea.selectionEnd = formatted.selectionEnd;
  return true;
}

export function textFormattingShortcut(event: KeyboardEvent): TextFormatAction | null {
  if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) {
    return null;
  }

  switch (event.key.toLowerCase()) {
    case 'b':
      return 'bold';
    case 'i':
      return 'italic';
    case 'k':
      return 'link';
    default:
      return null;
  }
}
