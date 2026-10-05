/**
 * Cocoon-shaped mutations. A legal one-line fragment has no brackets, no script body, and no newline, so it comes back unchanged.
 * @param {string} html
 * @returns {string}
 */
export function applyHostile(html) {
  const expanded = html.replace(/\[\/?([A-Za-z][\w-]*)(?:\s[^\]]*)?\]/g, (_match, name) => (
    `<span data-shortcode="${name}"></span>`
  ));
  const texturized = expanded.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (full, attrs, body) => {
    const next = body.replace(/&&/g, (match, offset) => (
      body.slice(0, offset).includes('<') ? '&#038;&#038;' : match
    ));
    return `<script${attrs}>${next}</script>`;
  });
  if (!texturized.includes('\n')) return texturized;
  return texturized.split(/\n{2,}/).map((block) => `<p>${block.replace(/\n/g, '<br />')}</p>`).join('');
}
