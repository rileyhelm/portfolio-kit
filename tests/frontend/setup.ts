import { afterEach, vi } from 'vitest';

afterEach(() => {
  document.body.innerHTML = '';
  window.history.replaceState(null, '', 'http://localhost/');
  vi.unstubAllGlobals();
});
