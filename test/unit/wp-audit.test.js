import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { auditFragment } from '../../scripts/wp/audit.mjs';
import { AuditError, sealFragment, writeSealed } from '../../scripts/wp/fragment.mjs';
import { assembleFragmentLine } from '../../scripts/wp/fragment-contract.mjs';

const program = 'void 0';

function lineFor(fallback = 'enable javascript', source = program) {
  return assembleFragmentLine(fallback, Buffer.from(source, 'utf8').toString('base64'));
}

describe('auditFragment', () => {
  test('accepts one data-url line and rejects the gutenberg wrapper', () => {
    const line = lineFor();
    assert.deepEqual(auditFragment(line), []);
    const block = `<!-- wp:html -->\n${line}\n<!-- /wp:html -->`;
    const rules = auditFragment(block).map((item) => item.rule);
    assert.ok(rules.includes('comment'));
    assert.ok(rules.includes('newline'));
  });

  test('rejects brackets, ampersands, newlines, emoji, and non-BMP text', () => {
    assert.ok(auditFragment(lineFor('see [toc]')).some((item) => item.rule === 'brackets'));
    assert.ok(auditFragment(lineFor('a & b')).some((item) => item.rule === 'ampersand'));
    assert.ok(auditFragment(`${lineFor()}\n`).some((item) => item.rule === 'newline'));
    assert.ok(auditFragment(lineFor('ok 😀')).some((item) => item.rule === 'emoji'));
    assert.ok(auditFragment(lineFor('ok \u{10000}')).some((item) => item.rule === 'non-bmp'));
  });

  test('rejects a second script, an inline body, a style tag, and an event handler', () => {
    const line = lineFor();
    assert.ok(auditFragment(`${line}<script></script>`).some((item) => item.rule === 'script-count'));
    assert.ok(auditFragment(line.replace('></script>', '>void 0</script>')).some((item) => item.rule === 'script-shape'));
    assert.ok(auditFragment(`${line}<style></style>`).some((item) => item.rule === 'style-tag'));
    assert.ok(auditFragment(line.replace('<div ', '<div onclick=alert(1) ')).some((item) => item.rule === 'event-handler'));
  });

  test('rejects non-ASCII programs, a bad alphabet, and banned calls', () => {
    assert.throws(() => sealFragment({ fallback: 'enable javascript', program: 'var s = "あ"' }), AuditError);
    const badAlphabet = lineFor().replace(/[A-Za-z]/, '+');
    assert.ok(auditFragment(`${badAlphabet.slice(0, -1)}?`).some((item) => item.rule === 'script-shape' || item.rule === 'base64-alphabet'));
    for (const source of ['eval(x)', 'new Function("x")', 'Function("x")', 'document.write("")', 'document.cookie', 'localStorage', 'sessionStorage', 'indexedDB', 'fetch("/")', 'XMLHttpRequest', 'sendBeacon', 'WebSocket']) {
      assert.ok(auditFragment(lineFor('enable javascript', source)).some((item) => item.rule === 'banned'), source);
    }
  });

  test('sealFragment round-trips and writeSealed rejects a plain object', () => {
    const sealed = sealFragment({ fallback: 'enable javascript', program });
    assert.equal(sealed.decoded, program);
    assert.equal(sealed.line.includes('\n'), false);
    assert.throws(() => writeSealed(new URL('../../.work/wp-seal-should-not-write', import.meta.url).pathname, /** @type {typeof sealed} */ ({ ...sealed }), Buffer.from('')));
  });
});
