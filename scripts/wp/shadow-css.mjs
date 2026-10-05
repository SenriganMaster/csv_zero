import * as csstree from 'css-tree';
import { INNER_CLASS } from './fragment-contract.mjs';

const ROOT_PX = 16;

/**
 * @param {string} css
 * @param {import('./tool-markup.mjs').ToolSurface} surface
 * @returns {string}
 */
export function projectShadowCss(css, surface) {
  const ast = csstree.parse(css);
  const font = declarationOn(ast, ':root', '--font');
  const text = declarationOn(ast, ':root', '--text');
  const lineHeight = declarationOn(ast, 'body', 'line-height');
  const fontSize = declarationOn(ast, 'body', 'font-size');
  if (!font || !text || !lineHeight || !fontSize) {
    throw new Error('styles.css is missing --font, --text, or the body font');
  }
  filterList(ast.children, surface);
  convertRem(ast);
  decorateHost(ast, { font, text, lineHeight });
  decorateInnerRoot(ast, { font, text, lineHeight });
  stripOverriddenViewport(ast);
  assertClean(ast, surface, css);
  return csstree.generate(ast);
}

/**
 * @param {import('css-tree').CssNode} ast
 * @param {string} selector
 * @param {string} property
 */
function declarationOn(ast, selector, property) {
  let value = '';
  csstree.walk(ast, (node) => {
    if (node.type !== 'Rule' || csstree.generate(node.prelude) !== selector) return;
    node.block.children.forEach((decl) => {
      if (decl.type === 'Declaration' && decl.property === property) value = csstree.generate(decl.value);
    });
  });
  return value;
}

/**
 * @param {import('css-tree').List<import('css-tree').CssNode>} list
 * @param {import('./tool-markup.mjs').ToolSurface} surface
 */
function filterList(list, surface) {
  /** @type {import('css-tree').CssNode[]} */
  const kept = [];
  list.forEach((node) => {
    if (keepNode(node, surface)) kept.push(node);
  });
  list.clear();
  for (const node of kept) list.appendData(node);
}

/**
 * @param {import('css-tree').CssNode} node
 * @param {import('./tool-markup.mjs').ToolSurface} surface
 */
function keepNode(node, surface) {
  if (node.type === 'Rule') {
    node.prelude.children.forEach((selector) => {
      if (selector.type === 'Selector') rewriteSelector(selector);
    });
    /** @type {import('css-tree').CssNode[]} */
    const selectors = [];
    node.prelude.children.forEach((selector) => {
      if (selector.type === 'Selector' && keepSelector(selector, surface)) selectors.push(selector);
    });
    node.prelude.children.clear();
    for (const selector of selectors) node.prelude.children.appendData(selector);
    return selectors.length > 0;
  }
  if (node.type === 'Atrule') return keepAtrule(node, surface);
  return false;
}

/**
 * @param {import('css-tree').Atrule} node
 * @param {import('./tool-markup.mjs').ToolSurface} surface
 */
function keepAtrule(node, surface) {
  const prelude = node.prelude ? csstree.generate(node.prelude).trim() : '';
  if (node.name !== 'media') throw new Error(`unsupported at-rule @${node.name}`);
  if (prelude.includes('prefers-color-scheme')) return false;
  if (!node.block) throw new Error(`@media ${prelude} has no block`);
  filterList(node.block.children, surface);
  if (node.block.children.isEmpty) return false;
  if (prelude.includes('prefers-reduced-motion') || prelude.includes('pointer')) return true;
  if (/^\((?:min-width|max-width|width)\s*:[^)]+\)$/.test(prelude)) {
    const parsed = csstree.parse(`@container csv-zero ${prelude}{}`);
    const atrule = parsed.children.first;
    if (atrule?.type !== 'Atrule' || !atrule.prelude) throw new Error(`failed to build container ${prelude}`);
    node.name = 'container';
    node.prelude = atrule.prelude;
    return true;
  }
  throw new Error(`unsupported media ${prelude}`);
}

/** @param {import('css-tree').Selector} selector */
function rewriteSelector(selector) {
  const nodes = selector.children.toArray();
  if (nodes.length >= 2 && isEmbedType(nodes[0]) && isEmbedAttr(nodes[1])) {
    let rest = nodes.slice(2);
    if (rest[0] && rest[0].type === 'Combinator') rest = rest.slice(1);
    selector.children.clear();
    if (rest.length === 0) {
      selector.children.appendData({ type: 'PseudoClassSelector', loc: null, name: 'host', children: null });
    } else {
      for (const node of rest) selector.children.appendData(node);
    }
  }
  selector.children.forEach((node) => {
    if (node.type === 'PseudoClassSelector' && node.name === 'root') node.name = 'host';
  });
}

/** @param {import('css-tree').CssNode | undefined} node */
function isEmbedType(node) {
  return node?.type === 'TypeSelector' && node.name === 'html';
}

/** @param {import('css-tree').CssNode | undefined} node */
function isEmbedAttr(node) {
  return node?.type === 'AttributeSelector'
    && node.name.type === 'Identifier'
    && node.name.name === 'data-embed'
    && node.matcher === '='
    && node.value?.type === 'String'
    && node.value.value === '1';
}

/**
 * @param {import('css-tree').Selector} selector
 * @param {import('./tool-markup.mjs').ToolSurface} surface
 */
function keepSelector(selector, surface) {
  let keep = true;
  const visit = (/** @type {import('css-tree').CssNode} */ node) => {
    if (node.type === 'ClassSelector' && !surface.classes.has(node.name)) keep = false;
    if (node.type === 'IdSelector' && !surface.ids.has(node.name)) keep = false;
    if (node.type === 'TypeSelector' && node.name !== '*' && !surface.tags.has(node.name)) keep = false;
    if (node.type === 'PseudoClassSelector' && node.children) {
      node.children.forEach((child) => {
        if (child.type === 'SelectorList') child.children.forEach((inner) => {
          if (inner.type === 'Selector') visitSelector(inner);
        });
      });
    }
  };
  const visitSelector = (/** @type {import('css-tree').Selector} */ inner) => {
    inner.children.forEach(visit);
  };
  visitSelector(selector);
  return keep;
}

/** @param {import('css-tree').CssNode} ast */
function convertRem(ast) {
  csstree.walk(ast, (node) => {
    if (node.type !== 'Dimension' || node.unit !== 'rem') return;
    const px = Number(node.value) * ROOT_PX;
    if (!Number.isFinite(px)) throw new Error(`bad rem value ${node.value}`);
    node.unit = 'px';
    node.value = formatPx(px);
  });
}

/** @param {number} px */
function formatPx(px) {
  const rounded = Math.round(px);
  if (Math.abs(px - rounded) < 1e-6) return String(rounded);
  return px.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}

/**
 * @param {import('css-tree').CssNode} ast
 * @param {{ font: string, text: string, lineHeight: string }} tokens
 */
function decorateHost(ast, tokens) {
  /** @type {import('css-tree').Rule | null} */
  let host = null;
  csstree.walk(ast, (node) => {
    if (node.type !== 'Rule' || csstree.generate(node.prelude) !== ':host') return;
    node.block.children.forEach((decl) => {
      if (decl.type === 'Declaration' && decl.property === '--font') host = node;
    });
  });
  if (!host) throw new Error('shadow css has no :host token rule');
  /** @type {import('css-tree').ListItem<import('css-tree').CssNode>[]} */
  const dropScheme = [];
  host.block.children.forEach((decl, item) => {
    if (decl.type === 'Declaration' && decl.property === 'color-scheme') dropScheme.push(item);
  });
  for (const item of dropScheme) host.block.children.remove(item);
  const extra = csstree.parse(`:host{all:initial;display:block;box-sizing:border-box;container-type:inline-size;container-name:csv-zero;color-scheme:light;font-family:${tokens.font};color:${tokens.text};line-height:${tokens.lineHeight};font-size:16px}`).children.first;
  if (extra?.type !== 'Rule') throw new Error('failed to build :host prelude');
  const decls = extra.block.children.toArray();
  for (let index = decls.length - 1; index >= 0; index -= 1) {
    host.block.children.prependData(csstree.clone(decls[index]));
  }
}

/**
 * A theme rule that names the host beats :host, and the used value then
 * inherits into the shadow tree. This element is only addressable from the
 * shadow sheet, so the page cannot put those properties back.
 * @param {import('css-tree').CssNode} ast
 * @param {{ font: string, text: string, lineHeight: string }} tokens
 */
function decorateInnerRoot(ast, tokens) {
  const parsed = csstree.parse(
    `.${INNER_CLASS}{all:initial;display:block;box-sizing:border-box;overflow-wrap:normal;word-break:normal;line-break:auto;letter-spacing:normal;word-spacing:normal;text-align:start;text-indent:0;text-transform:none;white-space:normal;font-style:normal;font-weight:normal;font-variant:normal;text-shadow:none;visibility:visible;cursor:auto;direction:ltr;writing-mode:horizontal-tb;-webkit-text-size-adjust:100%;text-size-adjust:100%;color-scheme:light;font-family:${tokens.font};color:${tokens.text};line-height:${tokens.lineHeight};font-size:16px}`,
  );
  const rule = parsed.children.first;
  if (rule?.type !== 'Rule' || ast.type !== 'StyleSheet') throw new Error('failed to build inner root');
  ast.children.appendData(rule);
}

/** @param {import('css-tree').CssNode} ast */
function stripOverriddenViewport(ast) {
  const rules = collectRules(ast);
  for (let index = 0; index < rules.length; index += 1) {
    const selector = csstree.generate(rules[index].prelude);
    /** @type {import('css-tree').ListItem<import('css-tree').CssNode>[]} */
    const remove = [];
    rules[index].block.children.forEach((decl, item) => {
      if (decl.type !== 'Declaration' || !valueHasViewport(decl.value)) return;
      const later = rules.slice(index + 1).some((rule) => (
        csstree.generate(rule.prelude) === selector && hasProperty(rule, decl.property)
      ));
      if (later) remove.push(item);
    });
    for (const item of remove) rules[index].block.children.remove(item);
  }
  pruneEmpty(ast.children);
}

/** @param {import('css-tree').CssNode} ast */
function collectRules(ast) {
  /** @type {import('css-tree').Rule[]} */
  const rules = [];
  const walk = (/** @type {import('css-tree').List<import('css-tree').CssNode>} */ list) => {
    list.forEach((node) => {
      if (node.type === 'Rule') rules.push(node);
      if (node.type === 'Atrule' && node.block) walk(node.block.children);
    });
  };
  if (ast.type === 'StyleSheet') walk(ast.children);
  return rules;
}

/** @param {import('css-tree').CssNode} value */
function valueHasViewport(value) {
  let found = false;
  csstree.walk(value, (node) => {
    if (node.type === 'Dimension' && (node.unit === 'vh' || node.unit === 'vw')) found = true;
  });
  return found;
}

/** @param {import('css-tree').Rule} rule @param {string} property */
function hasProperty(rule, property) {
  let found = false;
  rule.block.children.forEach((decl) => {
    if (decl.type === 'Declaration' && decl.property === property) found = true;
  });
  return found;
}

/** @param {import('css-tree').List<import('css-tree').CssNode>} list */
function pruneEmpty(list) {
  /** @type {import('css-tree').CssNode[]} */
  const kept = [];
  list.forEach((node) => {
    if (node.type === 'Rule' && node.block.children.isEmpty) return;
    if (node.type === 'Atrule' && node.block) {
      pruneEmpty(node.block.children);
      if (node.block.children.isEmpty) return;
    }
    kept.push(node);
  });
  list.clear();
  for (const node of kept) list.appendData(node);
}

/**
 * @param {import('css-tree').CssNode} ast
 * @param {import('./tool-markup.mjs').ToolSurface} surface
 * @param {string} source
 */
function assertClean(ast, surface, source) {
  const inputClasses = new Set();
  csstree.walk(csstree.parse(source), (node) => {
    if (node.type === 'ClassSelector') inputClasses.add(node.name);
  });
  const outputClasses = new Set();
  csstree.walk(ast, (node) => {
    if (node.type === 'ClassSelector') outputClasses.add(node.name);
    if (node.type === 'TypeSelector' && (node.name === 'html' || node.name === 'body')) {
      throw new Error(`shadow css still has ${node.name}`);
    }
    if (node.type === 'PseudoClassSelector' && node.name === 'root') throw new Error('shadow css still has :root');
    if (node.type === 'AttributeSelector' && node.name.type === 'Identifier' && node.name.name === 'data-embed') {
      throw new Error('shadow css still has data-embed');
    }
    if (node.type === 'Dimension' && (node.unit === 'rem' || node.unit === 'vh' || node.unit === 'vw')) {
      throw new Error(`shadow css still has ${node.value}${node.unit}`);
    }
  });
  for (const name of surface.classes) {
    if (inputClasses.has(name) && !outputClasses.has(name)) throw new Error(`shadow css dropped .${name}`);
  }
}
