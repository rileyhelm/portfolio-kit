function showToast(message: string): void {
  let toast = document.querySelector<HTMLElement>('.site-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'site-toast';
    document.body.appendChild(toast);
  }

  toast.textContent = message;
  toast.classList.add('is-visible');
  window.setTimeout(() => {
    toast?.classList.remove('is-visible');
  }, 1800);
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

export function initPublicPage(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-copy-link]').forEach((button) => {
    if (button.dataset.boundCopy === 'true') {
      return;
    }

    button.dataset.boundCopy = 'true';
    button.addEventListener('click', async () => {
      const value = button.dataset.copyLink;
      if (!value) {
        return;
      }
      try {
        await copyText(value);
        showToast('Link copied');
      } catch {
        showToast('Copy failed');
      }
    });
  });
}

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initPublicPage());
  } else {
    initPublicPage();
  }
}

