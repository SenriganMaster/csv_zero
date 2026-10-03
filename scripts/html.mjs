import crypto from 'node:crypto';

// HTML treats a missing or empty type as a classic script. These are the
// JavaScript MIME essences from the HTML spec. application/ld+json is not one.
const JS_MIME = new Set([
  'application/ecmascript',
  'application/javascript',
  'application/x-ecmascript',
  'application/x-javascript',
  'text/ecmascript',
  'text/javascript',
  'text/javascript1.0',
  'text/javascript1.1',
  'text/javascript1.2',
  'text/javascript1.3',
  'text/javascript1.4',
  'text/javascript1.5',
  'text/jscript',
  'text/livescript',
  'text/x-ecmascript',
  'text/x-javascript',
]);

const SCRIPT_RE = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;

function isClassicInline(attrs) {
  if (/(?:^|\s)src\s*=/i.test(attrs)) return false;
  const typeMatch = attrs.match(/(?:^|\s)type\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i);
  if (!typeMatch) return true;
  const raw = (typeMatch[1] ?? typeMatch[2] ?? typeMatch[3] ?? '').trim();
  if (raw === '') return true;
  const essence = raw.split(';')[0].trim().toLowerCase();
  return JS_MIME.has(essence);
}

function cspHash(source) {
  const digest = crypto.createHash('sha256').update(source, 'utf8').digest('base64');
  return `'sha256-${digest}'`;
}

function classicInlineHashes(html) {
  const hashes = [];
  for (const match of html.matchAll(SCRIPT_RE)) {
    if (isClassicInline(match[1])) hashes.push(cspHash(match[2]));
  }
  return hashes;
}

function applyScriptHashes(html, hashes) {
  const token = '{{script-hashes}}';
  if (!html.includes(token)) return html;
  if (hashes.length > 0) return html.replaceAll(token, hashes.join(' '));
  // The token sits between tokens that already have their own spaces.
  return html.replace(/ ?\{\{script-hashes\}\} ?/g, (match) => (
    match.startsWith(' ') && match.endsWith(' ') ? ' ' : ''
  ));
}

export function finalizeHtml(html, { styles, main }) {
  let out = html.replaceAll('{{styles}}', styles).replaceAll('{{main}}', main);
  const hashes = classicInlineHashes(out);
  if (hashes.length > 0 && !out.includes('{{script-hashes}}')) {
    throw new Error('build failed: inline script(s) present but {{script-hashes}} is missing from index.html');
  }
  out = applyScriptHashes(out, hashes);
  const leftover = out.match(/\{\{[^}]*\}\}/g);
  if (leftover) {
    throw new Error(`build failed: unresolved placeholder(s) in index.html: ${leftover.join(', ')}`);
  }
  return out;
}
