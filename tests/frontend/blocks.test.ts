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
});

