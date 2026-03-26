import { describe, expect, it } from 'vitest';

import { blocksToMarkdown, parseIntoBlocks } from '../../static/ts/edit/blocks';

describe('edit blocks', () => {
  it('parses and serializes text, image, and divider blocks', () => {
    const markdown = [
      '## Heading',
      '',
      '<!-- block -->',
      '',
      '<figure class="portfolio-image align-center">',
      '<img src="/static/example.svg" alt="Example" style="max-width:72%;">',
      '<figcaption>Caption text</figcaption>',
      '</figure>',
      '',
      '<!-- block -->',
      '',
      '---',
    ].join('\n');

    const blocks = parseIntoBlocks(markdown);
    expect(blocks).toHaveLength(3);
    expect(blocks[0]?.type).toBe('text');
    expect(blocks[1]?.type).toBe('image');
    expect(blocks[2]?.type).toBe('divider');
    if (blocks[1]?.type === 'image') {
      expect(blocks[1].align).toBe('center');
      expect(blocks[1].width).toBe(72);
      expect(blocks[1].caption).toBe('Caption text');
    }

    const serialized = blocksToMarkdown(blocks);
    expect(serialized).toContain('## Heading');
    expect(serialized).toContain('portfolio-image align-center');
    expect(serialized).toContain('<figcaption>Caption text</figcaption>');
    expect(serialized).toContain('---');
  });

  it('parses and serializes row blocks with two child blocks', () => {
    const markdown = [
      '<!-- row -->',
      'Left column copy.',
      '<!-- col -->',
      '<figure class="portfolio-image align-right">',
      '<img src="/static/column.svg" alt="Column image" style="max-width:64%;">',
      '</figure>',
      '<!-- /row -->',
    ].join('\n');

    const blocks = parseIntoBlocks(markdown);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.type).toBe('row');

    if (blocks[0]?.type === 'row') {
      expect(blocks[0].left.type).toBe('text');
      expect(blocks[0].right.type).toBe('image');
      if (blocks[0].right.type === 'image') {
        expect(blocks[0].right.align).toBe('right');
        expect(blocks[0].right.width).toBe(64);
      }
    }

    const serialized = blocksToMarkdown(blocks);
    expect(serialized).toContain('<!-- row -->');
    expect(serialized).toContain('<!-- col -->');
    expect(serialized).toContain('Left column copy.');
    expect(serialized).toContain('portfolio-image align-right');
  });
});
