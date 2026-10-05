import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const skip = new Set(['node_modules', 'deploy', 'dist-wp', '.work', '.git']);

/** @param {string} dir @param {string[]} out */
function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

describe('WordPress build fence', () => {
  test('the page build cannot see the fragment, and only the sealer writes it', () => {
    const build = fs.readFileSync(path.join(root, 'scripts', 'build.mjs'), 'utf8');
    assert.match(build, /charset: 'utf8'/);
    assert.match(build, /unknown argument/);
    assert.equal(build.includes('ascii'), false);
    assert.equal(build.includes('scripts/wp'), false);
    assert.equal(build.includes('dist-wp'), false);

    const boot = fs.readFileSync(path.join(root, 'src', 'wp', 'main.js'), 'utf8');
    assert.equal(boot.includes('setupEmbed'), false);
    assert.equal(boot.includes("kind: 'page'"), false);
    assert.match(boot, /kind: 'shadow'/);

    for (const name of ['src/main.js', 'src/app.js']) {
      const source = fs.readFileSync(path.join(root, name), 'utf8');
      assert.equal(source.includes('__TOOL_MARKUP__'), false, name);
      assert.equal(source.includes('__SHADOW_CSS__'), false, name);
      assert.equal(source.includes('attachShadow'), false, name);
    }

    const writers = walk(root, []).filter((file) => {
      const text = fs.readFileSync(file, 'utf8');
      return /writeFileSync\([\s\S]*?csv-zero-wp\.html/.test(text);
    });
    assert.deepEqual(writers.map((file) => path.relative(root, file).split(path.sep).join('/')), ['scripts/wp/fragment.mjs']);
  });
});
