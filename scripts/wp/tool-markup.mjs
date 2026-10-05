/**
 * @typedef {Readonly<{
 *   classes: ReadonlySet<string>,
 *   ids: ReadonlySet<string>,
 *   tags: ReadonlySet<string>,
 * }>} ToolSurface
 * @typedef {Readonly<{ html: string, fallback: string, surface: ToolSurface }>} ToolMarkup
 */

/**
 * @param {string} indexHtml
 * @param {string} viewSource
 * @returns {ToolMarkup}
 */
export function readToolMarkup(indexHtml, viewSource) {
  const slices = [];
  const openRe = /<section\b[^>]*>/gi;
  let open;
  while ((open = openRe.exec(indexHtml))) {
    const tag = open[0];
    if (!/\bclass="tool"/.test(tag) || !/\bdata-testid="tool"/.test(tag)) continue;
    const start = open.index;
    const tagRe = /<\/?section\b[^>]*>/gi;
    tagRe.lastIndex = start + tag.length;
    let depth = 1;
    let end = -1;
    let next;
    while ((next = tagRe.exec(indexHtml))) {
      depth += next[0].startsWith('</') ? -1 : 1;
      if (depth === 0) {
        end = tagRe.lastIndex;
        break;
      }
    }
    if (end < 0) throw new Error('tool section is not closed');
    slices.push(indexHtml.slice(start, end));
  }
  if (slices.length !== 1) throw new Error(`expected one tool section, got ${slices.length}`);
  let html = slices[0];
  if (html.includes("class='") || html.includes("id='")) {
    throw new Error('tool markup uses single-quoted class or id');
  }
  const credits = html.match(/<p\b[^>]*\bclass="embed-credit"[^>]*>[\s\S]*?<\/p>/g) ?? [];
  if (credits.length !== 1) throw new Error(`expected one embed-credit, got ${credits.length}`);
  html = html.replace(credits[0], '');
  const noscripts = [...html.matchAll(/<noscript\b[^>]*>([\s\S]*?)<\/noscript>/gi)];
  if (noscripts.length !== 1) throw new Error(`expected one noscript, got ${noscripts.length}`);
  const fallback = (noscripts[0][1] ?? '').replace(/<[^>]+>/g, '').trim();
  if (fallback.length === 0) throw new Error('tool noscript is empty');
  html = html.replace(noscripts[0][0], '');

  /** @type {Set<string>} */
  const classes = new Set();
  /** @type {Set<string>} */
  const ids = new Set();
  /** @type {Set<string>} */
  const tags = new Set();
  collectHtml(html, classes, ids, tags);
  collectView(viewSource, classes, tags);
  return { html, fallback, surface: { classes, ids, tags } };
}

/**
 * @param {string} html
 * @param {Set<string>} classes
 * @param {Set<string>} ids
 * @param {Set<string>} tags
 */
function collectHtml(html, classes, ids, tags) {
  const tagRe = /<([a-zA-Z][\w-]*)\b[^>]*>/g;
  let match;
  while ((match = tagRe.exec(html))) {
    const tag = match[1].toLowerCase();
    if (tag !== 'html' && tag !== 'body') tags.add(tag);
    const chunk = match[0];
    const classMatch = chunk.match(/\bclass="([^"]*)"/);
    if (classMatch) {
      for (const name of classMatch[1].split(/\s+/)) if (name) classes.add(name);
    }
    const idMatch = chunk.match(/\bid="([^"]*)"/);
    if (idMatch?.[1]) ids.add(idMatch[1]);
  }
}

/**
 * @param {string} source
 * @param {Set<string>} classes
 * @param {Set<string>} tags
 */
function collectView(source, classes, tags) {
  for (const raw of source.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('*') || line.startsWith('//') || line.startsWith('/*')) continue;
    if (/\.className\s*=/.test(raw)) {
      const ternary = raw.match(/\.className\s*=\s*[^?]+\?\s*'([^']*)'\s*:\s*'([^']*)'/);
      const literal = raw.match(/\.className\s*=\s*'([^']*)'/);
      const sink = /\.className\s*=\s*className\s*;?\s*$/.test(line);
      if (ternary) {
        addClasses(classes, ternary[1]);
        addClasses(classes, ternary[2]);
      } else if (literal && !raw.includes('?')) {
        addClasses(classes, literal[1]);
      } else if (!sink) {
        throw new Error(`unparsed className line: ${line}`);
      }
    }
    if (/\.classList\.(?:add|remove|toggle)\(/.test(raw)) {
      const named = raw.match(/\.classList\.(?:add|remove|toggle)\(\s*'([^']+)'/);
      if (!named) throw new Error(`unparsed classList line: ${line}`);
      addClasses(classes, named[1]);
    }
    if (/\bspan\(/.test(raw) && !/function span\(/.test(raw) && !/span\(\s*'/.test(raw)) {
      throw new Error(`unparsed span line: ${line}`);
    }
    for (const match of raw.matchAll(/span\(\s*'([^']+)'/g)) addClasses(classes, match[1]);
    for (const match of raw.matchAll(/createElement\(\s*'([^']+)'/g)) tags.add(match[1].toLowerCase());
  }
}

/** @param {Set<string>} classes @param {string} value */
function addClasses(classes, value) {
  for (const name of value.split(/\s+/)) if (name) classes.add(name);
}
