import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { analyze, write } from '../../src/core/convert.js';
import { CONVERTIBLE, fileSource, fixture } from '../helpers/fixtures.js';
import { hasPython, pythonCsv } from '../helpers/python.js';

const hasSoffice = spawnSync('soffice', ['--version']).status === 0;
const SKIP = !hasSoffice ? 'soffice is missing' : !hasPython ? 'python3 is missing' : false;
const SCRATCH = fileURLToPath(new URL('../../.work/core/', import.meta.url));
const MODES = /** @type {const} */ (['text', 'auto']);

/** @param {string[][]} records */
function asSheet(records) {
  const rows = records.map((record) => {
    const row = record.map((field) => field.replaceAll('\r\n', '\n'));
    while (row.at(-1) === '') row.pop();
    return row;
  });
  while (rows.at(-1)?.length === 0) rows.pop();
  return rows;
}

describe('LibreOffice reads every cell back as the source text', { skip: SKIP }, () => {
  /** A directory per run, profile included: a second soffice on a shared profile hands its files to the first and exits. */
  let run = '';

  before(
    async () => {
      fs.mkdirSync(SCRATCH, { recursive: true });
      run = fs.mkdtempSync(path.join(SCRATCH, 'lo-'));
      /** @type {string[]} */
      const files = [];
      for (const [name] of CONVERTIBLE) {
        const source = fileSource(name);
        const read = await analyze(source, { encoding: 'auto', delimiter: 'auto' }, { onPreview() {}, onProgress() {} });
        assert.ok(read.ok, name);
        for (const mode of MODES) {
          const autoColumns = mode === 'auto' ? Array.from({ length: read.value.cols }, (_, col) => col) : [];
          const out = await write('xlsx', source, read.value, { header: true, autoColumns }, () => {});
          assert.ok(out.ok, name);
          const file = path.join(run, `${name}.${mode}.xlsx`);
          fs.writeFileSync(file, new Uint8Array(await out.value.blob.arrayBuffer()));
          files.push(file);
        }
      }
      const soffice = spawnSync(
        'soffice',
        [
          '--headless',
          `-env:UserInstallation=${pathToFileURL(path.join(run, 'profile')).href}`,
          '--convert-to',
          'csv:Text - txt - csv (StarCalc):44,34,76',
          '--outdir',
          run,
          ...files,
        ],
        { timeout: 120_000 },
      );
      assert.equal(soffice.status, 0, String(soffice.stderr));
    },
    { timeout: 150_000 },
  );

  after(() => fs.rmSync(run, { recursive: true, force: true }));

  for (const [name, codec, delimiter] of CONVERTIBLE) {
    for (const mode of MODES) {
      test(`${name}, ${mode}`, () => {
        const back = pythonCsv(fs.readFileSync(path.join(run, `${name}.${mode}.csv`)), 'utf-8', ',');
        assert.deepEqual(asSheet(back), asSheet(pythonCsv(fixture(name), codec, delimiter)));
      });
    }
  }
});
