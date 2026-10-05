import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { applyHostile } from '../../scripts/wp-harness/hostile.mjs';
import { assembleFragmentLine } from '../../scripts/wp/fragment-contract.mjs';

describe('hostile WordPress filters', () => {
  test('expands shortcodes, texturizes script bodies, and autop-inserts paragraphs', () => {
    assert.match(applyHostile('before [toc] after'), /data-shortcode="toc"/);
    assert.match(applyHostile('see [ad title="x"] now'), /data-shortcode="ad"/);
    const script = '<script>if (a < b && c) {}</script>';
    assert.match(applyHostile(script), /&#038;&#038;/);
    assert.equal(applyHostile('a\n\nb'), '<p>a</p><p>b</p>');
  });

  test('a one-line data-url fragment is unchanged', () => {
    const line = assembleFragmentLine('enable javascript', Buffer.from('void 0', 'utf8').toString('base64'));
    assert.equal(applyHostile(line), line);
  });
});
