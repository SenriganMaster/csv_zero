import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { describe, test } from 'node:test';
import { finalizeHtml } from '../../scripts/html.mjs';

function sha256Source(source) {
  return `'sha256-${crypto.createHash('sha256').update(source, 'utf8').digest('base64')}'`;
}

const styles = './assets/styles-NR4VLM7X.css';
const main = './assets/main-Z7MFRTTQ.js';

describe('finalizeHtml', () => {
  test('hashes classic inline scripts and leaves JSON-LD alone', () => {
    const inline = 'window.__embed=1';
    const typed = 'void 0';
    const jsonLd = '{"@type":"WebApplication"}';
    const inlineHash = sha256Source(inline);
    const typedHash = sha256Source(typed);
    const jsonHash = sha256Source(jsonLd);
    assert.equal(inlineHash, "'sha256-rE+7F3dIy1PmiETW2NtS/PGEVU2PiqcIDZtxgeNJqvg='");
    assert.equal(typedHash, "'sha256-yyjq/GGlTvm0YhdkNx72uPxcwaIXqWZBYZftmpA6pYU='");
    assert.equal(jsonHash, "'sha256-c3GInYhG99jHWxxeaaUPCqK5Iv91HsSKaCBoRyvcAcU='");

    const input = [
      '<!DOCTYPE html>',
      '<html lang="ja">',
      '<head>',
      `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' {{script-hashes}}; style-src 'self'">`,
      '<link rel="stylesheet" href="{{styles}}">',
      `<script>${inline}</script>`,
      `<script type="text/javascript">${typed}</script>`,
      `<script type="application/ld+json">${jsonLd}</script>`,
      '<script type="module">import.meta</script>',
      '</head>',
      '<body>',
      '<script defer src="{{main}}"></script>',
      '</body>',
      '</html>',
    ].join('\n');

    const output = finalizeHtml(input, { styles, main });
    assert.equal(output, [
      '<!DOCTYPE html>',
      '<html lang="ja">',
      '<head>',
      '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\' \'sha256-rE+7F3dIy1PmiETW2NtS/PGEVU2PiqcIDZtxgeNJqvg=\' \'sha256-yyjq/GGlTvm0YhdkNx72uPxcwaIXqWZBYZftmpA6pYU=\'; style-src \'self\'">',
      '<link rel="stylesheet" href="./assets/styles-NR4VLM7X.css">',
      '<script>window.__embed=1</script>',
      '<script type="text/javascript">void 0</script>',
      '<script type="application/ld+json">{"@type":"WebApplication"}</script>',
      '<script type="module">import.meta</script>',
      '</head>',
      '<body>',
      '<script defer src="./assets/main-Z7MFRTTQ.js"></script>',
      '</body>',
      '</html>',
    ].join('\n'));
    assert.equal(output.includes(jsonHash), false);
    assert.equal(output.includes("'sha256-VT0DIRibI9ul82cOpL21Utzg67GjIB47CU4/BM8Ip/4='"), false);
  });

  test('drops an unused script-hash placeholder and the extra space', () => {
    assert.equal(
      finalizeHtml(
        '<link href="{{styles}}"><meta content="script-src \'self\' {{script-hashes}};"><script src="{{main}}"></script>',
        { styles, main },
      ),
      `<link href="${styles}"><meta content="script-src 'self';"><script src="${main}"></script>`,
    );
    assert.equal(
      finalizeHtml(
        '<meta content="script-src \'self\' {{script-hashes}} \'wasm-unsafe-eval\'">',
        { styles, main },
      ),
      '<meta content="script-src \'self\' \'wasm-unsafe-eval\'">',
    );
  });

  test('inline script without placeholder throws', () => {
    assert.throws(
      () => finalizeHtml('<script>window.__embed=1</script>', { styles, main }),
      { message: 'build failed: inline script(s) present but {{script-hashes}} is missing from index.html' },
    );
  });

  test('leftover placeholder throws', () => {
    assert.throws(
      () => finalizeHtml('<p>{{x}}</p>', { styles, main }),
      { message: 'build failed: unresolved placeholder(s) in index.html: {{x}}' },
    );
  });
});
