import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { startServer } from '../../scripts/serve.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const srcDir = path.join(repo, 'src');

describe('startServer', () => {
  /** @type {Awaited<ReturnType<typeof startServer>>} */
  let server;

  before(async () => {
    server = await startServer(srcDir, 0);
  });

  after(async () => {
    await server.close();
  });

  test('GET / returns src/index.html as text/html', async () => {
    const res = await fetch(server.url);
    const body = await res.text();
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(body, fs.readFileSync(path.join(srcDir, 'index.html'), 'utf8'));
  });

  test('GET /main.js returns text/javascript', async () => {
    const res = await fetch(new URL('main.js', server.url));
    const body = await res.text();
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'text/javascript; charset=utf-8');
    assert.equal(body, fs.readFileSync(path.join(srcDir, 'main.js'), 'utf8'));
  });

  test('GET /nope returns 404', async () => {
    const res = await fetch(new URL('nope', server.url));
    const body = await res.text();
    assert.equal(res.status, 404);
    assert.equal(body, '');
  });

  test('GET /..%2f..%2fpackage.json does not return package.json', async () => {
    const res = await fetch(`${server.url}..%2f..%2fpackage.json`);
    const body = await res.text();
    const pkg = fs.readFileSync(path.join(repo, 'package.json'), 'utf8');
    assert.equal(res.status === 403 || res.status === 404, true);
    assert.notEqual(body, pkg);
    assert.equal(body.includes('"name": "csv-zero"'), false);
  });
});
