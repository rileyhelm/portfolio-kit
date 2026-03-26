import type { Align, Block, BlockType, DividerBlock, ImageBlock, RowBlock, RowChildBlock, TextBlock } from '../types';

export const BLOCK_SEPARATOR = '<!-- block -->';
export const ROW_START = '<!-- row -->';
export const ROW_END = '<!-- /row -->';
export const COL_SEPARATOR = '<!-- col -->';

const FIGURE_PATTERN = /^<figure\s+class="portfolio-image(?:\s+align-(left|center|right))?"[^>]*>\s*<img\s+([^>]+?)>\s*(?:<figcaption>([\s\S]*?)<\/figcaption>)?\s*<\/figure>$/i;
const WIDTH_PATTERN = /max-width:\s*(\d+)%/i;

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function decodeHtml(text: string): string {
  const textarea = document.createElement('textarea');
  textarea.innerHTML = text;
  return textarea.value;
}

function encodeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function parseFigureBlock(markdown: string): ImageBlock | null {
  const trimmed = markdown.trim();
  const figureMatch = trimmed.match(FIGURE_PATTERN);
  if (!figureMatch) {
    const imageMatch = trimmed.match(/^!\[(.*?)\]\((.*?)\)$/);
    if (!imageMatch) {
      return null;
    }
    return {
      id: generateId('image'),
      type: 'image',
      src: imageMatch[2] ?? '',
      alt: imageMatch[1] ?? '',
      caption: '',
      align: 'left',
      width: 100,
    };
  }

  const align = (figureMatch[1] as Align | undefined) ?? 'left';
  const imageTag = figureMatch[2] ?? '';
  const caption = decodeHtml((figureMatch[3] ?? '').trim());
  const srcMatch = imageTag.match(/src="([^"]+)"/i);
  const altMatch = imageTag.match(/alt="([^"]*)"/i);
  const styleMatch = imageTag.match(/style="([^"]+)"/i);
  const widthMatch = styleMatch?.[1]?.match(WIDTH_PATTERN);
  const width = widthMatch?.[1];

  return {
    id: generateId('image'),
    type: 'image',
    src: srcMatch?.[1] ?? '',
    alt: altMatch?.[1] ?? '',
    caption,
    align,
    width: width ? Number.parseInt(width, 10) : 100,
  };
}

function parseSingleBlock(markdown: string): RowChildBlock {
  const raw = markdown.trim();
  if (/^(-{3,}|\*{3,}|_{3,})$/.test(raw)) {
    return createBlock('divider');
  }

  const imageBlock = parseFigureBlock(raw);
  if (imageBlock) {
    return imageBlock;
  }

  return {
    ...createBlock('text'),
    markdown: raw,
  };
}

function parseRowBlock(markdown: string): RowBlock | null {
  const trimmed = markdown.trim();
  if (!trimmed.startsWith(ROW_START) || !trimmed.endsWith(ROW_END)) {
    return null;
  }

  const inner = trimmed
    .slice(ROW_START.length, trimmed.length - ROW_END.length)
    .trim();
  const columns = inner.split(new RegExp(`\\n*${COL_SEPARATOR}\\n*`));
  if (columns.length !== 2) {
    return null;
  }

  return {
    id: generateId('row'),
    type: 'row',
    left: parseSingleBlock(columns[0] ?? ''),
    right: parseSingleBlock(columns[1] ?? ''),
  };
}

export function createBlock<T extends BlockType>(type: T): Extract<Block, { type: T }> {
  if (type === 'text') {
    return {
      id: generateId('text'),
      type: 'text',
      markdown: '',
    } as Extract<Block, { type: T }>;
  }

  if (type === 'image') {
    return {
      id: generateId('image'),
      type: 'image',
      src: '',
      alt: '',
      caption: '',
      align: 'left',
      width: 100,
    } as Extract<Block, { type: T }>;
  }

  if (type === 'row') {
    return {
      id: generateId('row'),
      type: 'row',
      left: createBlock('text'),
      right: createBlock('text'),
    } as Extract<Block, { type: T }>;
  }

  return {
    id: generateId('divider'),
    type: 'divider',
  } as Extract<Block, { type: T }>;
}

export function parseIntoBlocks(markdown: string): Block[] {
  if (!markdown.trim()) {
    return [createBlock('text')];
  }

  const rawBlocks = markdown.split(new RegExp(`\\n+${BLOCK_SEPARATOR}\\n+`));
  const blocks = rawBlocks
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((raw): Block => {
      const rowBlock = parseRowBlock(raw);
      if (rowBlock) {
        return rowBlock;
      }
      return parseSingleBlock(raw);
    });

  return blocks.length ? blocks : [createBlock('text')];
}

function textBlockToMarkdown(block: TextBlock): string {
  return block.markdown.trim();
}

function imageBlockToMarkdown(block: ImageBlock): string {
  const align = block.align || 'left';
  const width = Number.isFinite(block.width) ? Math.max(35, Math.min(100, block.width)) : 100;
  const style = width < 100 ? ` style="max-width:${width}%;"` : '';
  const caption = block.caption.trim()
    ? `\n<figcaption>${encodeHtml(block.caption.trim())}</figcaption>`
    : '';
  return [
    `<figure class="portfolio-image align-${align}">`,
    `<img src="${encodeHtml(block.src.trim())}" alt="${encodeHtml(block.alt.trim())}"${style}>${caption}`,
    '</figure>',
  ].join('\n');
}

export function blockToMarkdown(block: Block): string {
  if (block.type === 'row') {
    return [
      ROW_START,
      blockToMarkdown(block.left),
      COL_SEPARATOR,
      blockToMarkdown(block.right),
      ROW_END,
    ].join('\n');
  }
  if (block.type === 'text') {
    return textBlockToMarkdown(block);
  }
  if (block.type === 'image') {
    return imageBlockToMarkdown(block);
  }
  return '---';
}

export function blocksToMarkdown(blocks: Block[]): string {
  return blocks
    .map((block) => blockToMarkdown(block))
    .filter((block) => block.trim().length > 0)
    .join(`\n\n${BLOCK_SEPARATOR}\n\n`);
}

export function findBlock(blocks: Block[], blockId: string): Block | null {
  for (const block of blocks) {
    if (block.id === blockId) {
      return block;
    }
    if (block.type === 'row') {
      if (block.left.id === blockId) {
        return block.left;
      }
      if (block.right.id === blockId) {
        return block.right;
      }
    }
  }
  return null;
}

export function replaceBlock(blocks: Block[], blockId: string, nextBlock: Block): Block[] {
  return blocks.map((block) => {
    if (block.id === blockId) {
      return nextBlock;
    }
    if (block.type !== 'row') {
      return block;
    }

    let changed = false;
    let left = block.left;
    let right = block.right;

    if (block.left.id === blockId && nextBlock.type !== 'row') {
      left = nextBlock;
      changed = true;
    }
    if (block.right.id === blockId && nextBlock.type !== 'row') {
      right = nextBlock;
      changed = true;
    }

    return changed ? { ...block, left, right } : block;
  });
}

export function moveBlock(blocks: Block[], fromIndex: number, toIndex: number): Block[] {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= blocks.length || toIndex >= blocks.length) {
    return blocks;
  }
  const next = [...blocks];
  const [item] = next.splice(fromIndex, 1);
  if (!item) {
    return blocks;
  }
  next.splice(toIndex, 0, item);
  return next;
}

export function insertBlock(blocks: Block[], index: number, type: BlockType): Block[] {
  const next = [...blocks];
  next.splice(index, 0, createBlock(type));
  return next;
}

export function deleteBlock(blocks: Block[], blockId: string): Block[] {
  const next = blocks.filter((block) => block.id !== blockId);
  return next.length ? next : [createBlock('text')];
}

export function cloneBlock(block: Block): Block {
  if (block.type === 'row') {
    return {
      ...block,
      id: generateId('row'),
      left: cloneBlock(block.left) as RowChildBlock,
      right: cloneBlock(block.right) as RowChildBlock,
    };
  }
  if (block.type === 'text') {
    return {
      ...block,
      id: generateId('text'),
    };
  }
  if (block.type === 'image') {
    return {
      ...block,
      id: generateId('image'),
    };
  }
  return {
    id: generateId('divider'),
    type: 'divider',
  } as DividerBlock;
}
