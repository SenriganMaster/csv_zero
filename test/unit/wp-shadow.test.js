import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { projectShadowCss } from '../../scripts/wp/shadow-css.mjs';
import { readToolMarkup } from '../../scripts/wp/tool-markup.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('WordPress shadow sheet', () => {
  test('the tool section and the real stylesheet project without page rules', () => {
    const markup = readToolMarkup(
      fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8'),
      fs.readFileSync(path.join(root, 'src', 'view.js'), 'utf8'),
    );
    assert.equal(markup.fallback, 'このツールを使うには、ブラウザのJavaScriptを有効にしてください。');
    assert.equal(markup.html.includes('embed-credit'), false);
    assert.equal(markup.html.includes('class="tool"'), true);
    const css = projectShadowCss(fs.readFileSync(path.join(root, 'src', 'styles.css'), 'utf8'), markup.surface);
    assert.match(css, /:host\{all:initial/);
    assert.match(css, /container-name:csv-zero/);
    assert.match(css, /@container csv-zero \(min-width:900px\)/);
    assert.match(css, /@media \(pointer:coarse\)/);
    assert.match(css, /prefers-reduced-motion:reduce/);
    assert.match(css, /box-shadow:none/);
    assert.match(css, /max-height:440px/);
    assert.equal(css.includes('data-embed'), false);
    assert.equal(css.includes(':root'), false);
    assert.equal(css.includes('64vh'), false);
    assert.equal(/\drem/.test(css), false);
    assert.equal(css.includes('.hero'), false);
    assert.equal(css.includes('.site-header'), false);
  });
});
