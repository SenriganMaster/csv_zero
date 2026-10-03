import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileSource } from '../helpers/fixtures.js';
import { XLSX_TYPE } from '../../src/core/xlsx.js';

const AUTO = { encoding: 'auto', delimiter: 'auto' };
const TEXT_ONLY = { header: true, autoColumns: [] };
let spawned = 0;

/**
 * One job the way main.js runs it: a fresh worker module gets one request. Resolves with every event posted
 * up to and just after the terminal one.
 * @param {object} request
 * @returns {Promise<any[]>}
 */
async function runJob(request) {
  const scope = new EventTarget();
  /** @type {any[]} */
  const events = [];
  const finished = new Promise((resolve) => {
    Object.assign(scope, {
      /** @param {any} event */
      postMessage(event) {
        events.push(event);
        if (event.type === 'done' || event.type === 'failed') resolve(undefined);
      },
    });
  });
  Object.assign(globalThis, { self: scope });
  await import(`../../src/worker.js?worker=${++spawned}`);
  scope.dispatchEvent(new MessageEvent('message', { data: request }));
  await finished;
  await new Promise(setImmediate);
  return events;
}

/** @param {Blob} blob @param {string} name */
const blobSource = (blob, name) => ({ kind: 'file', blob, name });

describe('read job', () => {
  test('posts progress, one preview, then done', async () => {
    const events = await runJob({ type: 'read', source: fileSource('sjis-bank.csv'), choice: AUTO });
    assert.deepEqual(
      events.map((event) => event.type),
      ['progress', 'preview', 'done'],
    );
    const [progress, preview, done] = events;
    assert.equal(progress.ratio, 1);
    assert.deepEqual(preview.preview.settings, { encoding: 'shift_jis', delimiter: ',' });
    assert.deepEqual(preview.preview.records[0], [
      '金融機関コード', '金融機関名', '支店コード', '支店名', '預金種目', '口座番号',
      '受取人名', '郵便番号', '電話番号', '振込日', '金額', '備考',
    ]);
    assert.deepEqual([done.analysis.rows, done.analysis.cols], [31, 12]);
  });

  test('posts progress at most once per whole percent', async () => {
    // 150 slices of 1 MiB report 150 ratios for 101 whole percents.
    const lines = new Uint8Array(1 << 20).fill(0x0a);
    const blob = new Blob(Array.from({ length: 150 }, () => lines));
    const events = await runJob({ type: 'read', source: blobSource(blob, 'lines.csv'), choice: { encoding: 'utf-8', delimiter: ',' } });
    assert.deepEqual(
      events.slice(0, -1).map((event) => event.type === 'progress' && Math.floor(event.ratio * 100)),
      Array.from({ length: 101 }, (_, percent) => percent),
    );
    assert.deepEqual(events.at(-1), { type: 'failed', error: { code: 'EMPTY_FILE' } });
  });

  test('forwards a failed analysis', async () => {
    const blob = new Blob([Uint8Array.of(0x50, 0x4b, 0x03, 0x04)]);
    assert.deepEqual(await runJob({ type: 'read', source: blobSource(blob, 'book.csv'), choice: AUTO }), [
      { type: 'failed', error: { code: 'NOT_CSV_XLSX' } },
    ]);
  });
});

describe('write job', () => {
  test('posts progress, then done with the file', async () => {
    const source = fileSource('sjis-bank.csv');
    const { analysis } = (await runJob({ type: 'read', source, choice: AUTO })).at(-1);
    /** @type {[string, string, string][]} */
    const outputs = [];
    for (const format of ['xlsx', 'csv']) {
      const events = await runJob({ type: 'write', format, source, analysis, options: TEXT_ONLY });
      assert.deepEqual(
        events.map((event) => (event.type === 'progress' ? event.ratio : event.type)),
        [1, 'done'],
      );
      const { file } = events[1];
      outputs.push([format, file.name, file.blob.type]);
    }
    assert.deepEqual(outputs, [
      ['xlsx', 'sjis-bank_text.xlsx', XLSX_TYPE],
      ['csv', 'sjis-bank_utf8bom.csv', 'text/csv'],
    ]);
  });

  test('forwards a blocker without reading', async () => {
    const source = blobSource(new Blob([`a,${'x'.repeat(32_768)}\r\n`]), 'long.csv');
    const { analysis } = (await runJob({ type: 'read', source, choice: AUTO })).at(-1);
    assert.deepEqual(await runJob({ type: 'write', format: 'xlsx', source, analysis, options: TEXT_ONLY }), [
      { type: 'failed', error: { code: 'CELL_TOO_LONG', count: 1, row: 0, col: 1 } },
    ]);
  });
});

describe('unexpected exceptions', () => {
  test('a file that grew after it was chosen is READ_FAILED', async () => {
    const path = new URL('../../.work/core/worker-edited.csv', import.meta.url);
    fs.mkdirSync(new URL('.', path), { recursive: true });
    fs.writeFileSync(path, 'a,b\r\n');
    const blob = await fs.openAsBlob(path);
    fs.appendFileSync(path, '1,2\r\n');
    try {
      assert.deepEqual(await runJob({ type: 'read', source: blobSource(blob, 'edited.csv'), choice: AUTO }), [
        { type: 'failed', error: { code: 'READ_FAILED' } },
      ]);
    } finally {
      fs.rmSync(path);
    }
  });

  test('map to AppError values', async () => {
    /** Stands in for failures no real file can be made to cause. @param {unknown} error */
    const failing = (error) => ({ size: 1, slice: () => ({ arrayBuffer: () => Promise.reject(error) }) });
    /** @type {[unknown, object][]} */
    const cases = [
      [new DOMException('A requested file or directory could not be found.', 'NotFoundError'), { code: 'READ_FAILED' }],
      [new RangeError('Array buffer allocation failed'), { code: 'OUT_OF_MEMORY' }],
      [new DOMException('The operation was aborted.', 'AbortError'), { code: 'WORKER_FAILED', detail: 'AbortError: The operation was aborted.' }],
      [new TypeError('boom'), { code: 'WORKER_FAILED', detail: 'TypeError: boom' }],
      ['boom', { code: 'WORKER_FAILED', detail: 'boom' }],
    ];
    for (const [error, expected] of cases) {
      const source = { kind: 'file', blob: failing(error), name: 'x.csv' };
      assert.deepEqual(await runJob({ type: 'read', source, choice: AUTO }), [{ type: 'failed', error: expected }]);
    }
  });
});
