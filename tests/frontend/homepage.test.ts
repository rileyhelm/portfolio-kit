import { describe, expect, it, vi } from 'vitest';

import { initPublicPage } from '../../static/ts/public/index';

describe('homepage runtime', () => {
  it('does not hijack project card navigation', () => {
    document.body.innerHTML = `
      <main>
        <a class="project-card-link" href="/studio-refresh">Project</a>
      </main>
    `;

    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    initPublicPage();

    const link = document.querySelector<HTMLAnchorElement>('.project-card-link');
    if (!link) {
      throw new Error('Missing homepage link');
    }

    let preventedAtListener: boolean | null = null;
    link.addEventListener('click', (event) => {
      preventedAtListener = event.defaultPrevented;
      event.preventDefault();
    });

    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(preventedAtListener).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(document.querySelector('[data-homepage-detail-content]')).toBeNull();
  });
});
