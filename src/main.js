import { mount } from './app.js';

/**
 * ?embed=1 sets data-embed on <html> before first paint. Inside a frame, a ResizeObserver posts
 * { type: 'csv-zero:height', height } to the parent whenever the rounded-up height of <html> changes.
 * targetOrigin is '*' because the payload is one number.
 */
function setupEmbed() {
  const root = document.documentElement;
  if (root.dataset.embed !== '1' || window.parent === window) return;
  let sent = 0;
  new ResizeObserver(() => {
    const height = Math.ceil(root.getBoundingClientRect().height);
    if (height === sent) return;
    sent = height;
    window.parent.postMessage({ type: 'csv-zero:height', height }, '*');
  }).observe(root);
}

function setupCopy() {
  const button = document.querySelector('[data-testid="copy-embed"]');
  const code = document.querySelector('[data-ref="embed-code"]');
  const label = document.querySelector('[data-ref="copy-label"]');
  if (!(button instanceof HTMLButtonElement) || !(code instanceof HTMLElement) || !(label instanceof HTMLElement)) return;
  const idle = label.textContent ?? '';
  let timer = 0;
  button.addEventListener('click', async () => {
    let copied = false;
    try {
      await navigator.clipboard.writeText(code.textContent ?? '');
      copied = true;
    } catch {
      const range = document.createRange();
      range.selectNodeContents(code);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    button.dataset.state = copied ? 'copied' : 'selected';
    label.textContent = copied ? 'コピーしました' : '選択しました。Ctrl+Cでコピーできます';
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      delete button.dataset.state;
      label.textContent = idle;
    }, 2400);
  });
}

mount({ kind: 'page', document });
setupEmbed();
setupCopy();
