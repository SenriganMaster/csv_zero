import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { AUTO_CHOICE, MAX_INPUT_BYTES, canWrite, initialSession, update } from '../../src/core/session.js';

const ENV = { xlsx: true };
const SJIS = { encoding: 'shift_jis', delimiter: ',' };
const FORCED = { encoding: 'utf-8', delimiter: 'auto' };
const NO_RISKS = { formula: 0, leadingZero: 0, exponent: 0, date: 0, numberFormat: 0 };

const source = { kind: 'file', blob: new Blob(['銀行コード,支店コード\r\n0001,001\r\n']), name: 'bank.csv' };
const otherSource = { kind: 'paste', blob: new Blob(['a\tb\n1\t2\n']), name: '貼り付けデータ' };

/** @returns {any} */
function analysisOf(overrides = {}) {
  return {
    settings: SJIS,
    detected: {
      encoding: { encoding: 'shift_jis', bom: false, asciiOnly: false },
      delimiter: { delimiter: ',', singleColumn: false },
    },
    records: [['銀行コード', '支店コード'], ['0001', '001']],
    rows: 2,
    cols: 2,
    columns: [
      { width: 10, risks: { ...NO_RISKS, leadingZero: 1 }, row0: { risk: null } },
      { width: 10, risks: { ...NO_RISKS, leadingZero: 1 }, row0: { risk: null } },
    ],
    overlong: null,
    replaced: null,
    ragged: null,
    unterminatedQuoteRow: null,
    ...overrides,
  };
}

const analysis = analysisOf();
const file = { blob: new Blob(['PK']), name: 'bank_text.xlsx' };
const preview = { settings: SJIS, detected: analysis.detected, records: analysis.records };

/** @returns {any} */
function empty(notice = null, header = true) {
  return { env: ENV, header, stage: { kind: 'empty', notice } };
}
/** @returns {any} */
function reading(extra = {}) {
  return { env: ENV, header: true, stage: { kind: 'reading', source, choice: AUTO_CHOICE, preview: null, progress: 0, ...extra } };
}
/** @returns {any} */
function ready(output = { kind: 'idle' }, extra = {}, session = {}) {
  return {
    env: ENV, header: true, ...session,
    stage: { kind: 'ready', source, choice: AUTO_CHOICE, analysis, autoColumns: [], output, ...extra },
  };
}

const writing = { kind: 'writing', format: 'xlsx', progress: 0.25 };
const written = { kind: 'written', format: 'xlsx', file };
const failed = { kind: 'failed', format: 'csv', error: { code: 'WORKER_FAILED', detail: 'boom' } };

describe('initialSession', () => {
  test('starts empty with the header option on', () => {
    assert.deepEqual(initialSession(ENV), { env: ENV, header: true, stage: { kind: 'empty', notice: null } });
  });
});

describe('sourceChosen', () => {
  test('a 0-byte source is EMPTY_FILE before any worker starts', () => {
    const blank = { kind: 'file', blob: new Blob([]), name: 'blank.csv' };
    for (const from of [empty(), reading(), ready(writing)]) {
      const [next, effects] = update(from, { type: 'sourceChosen', source: blank });
      assert.equal(next.stage.kind, 'empty');
      assert.deepEqual(next.stage, { kind: 'empty', notice: { code: 'EMPTY_FILE' } });
      assert.deepEqual(effects, [{ type: 'cancelRead' }, { type: 'cancelWrite' }]);
    }
  });

  test('a source over 200 MiB is FILE_TOO_LARGE with its size', () => {
    const huge = { kind: 'file', blob: { size: MAX_INPUT_BYTES + 1 }, name: 'huge.csv' };
    const [next, effects] = update(ready(), { type: 'sourceChosen', source: huge });
    assert.deepEqual(next.stage, { kind: 'empty', notice: { code: 'FILE_TOO_LARGE', bytes: 209715201 } });
    assert.deepEqual(effects, [{ type: 'cancelRead' }, { type: 'cancelWrite' }]);
  });

  test('exactly 200 MiB is still read', () => {
    const edge = { kind: 'file', blob: { size: MAX_INPUT_BYTES }, name: 'edge.csv' };
    const [next, effects] = update(empty(), { type: 'sourceChosen', source: edge });
    assert.equal(next.stage.kind, 'reading');
    assert.deepEqual(effects, [{ type: 'startRead', source: edge, choice: { encoding: 'auto', delimiter: 'auto' } }]);
  });

  test('from any stage, reads with choice auto and no preview', () => {
    for (const from of [empty({ code: 'EMPTY_FILE' }), reading({ choice: FORCED, preview }), ready(written, { choice: FORCED })]) {
      const [next, effects] = update(from, { type: 'sourceChosen', source: otherSource });
      assert.equal(next.stage.kind, 'reading');
      assert.deepEqual(next.stage, {
        kind: 'reading', source: otherSource, choice: { encoding: 'auto', delimiter: 'auto' }, preview: null, progress: 0,
      });
      assert.deepEqual(effects, [{ type: 'startRead', source: otherSource, choice: { encoding: 'auto', delimiter: 'auto' } }]);
    }
  });

  test('the header preference survives a new file', () => {
    const [next] = update(empty(null, false), { type: 'sourceChosen', source });
    assert.equal(next.header, false);
  });
});

describe('choiceChanged', () => {
  test('from reading, keeps the preview it has and restarts the read', () => {
    const [next, effects] = update(reading({ preview, progress: 0.5 }), { type: 'choiceChanged', choice: FORCED });
    assert.equal(next.stage.kind, 'reading');
    assert.deepEqual(next.stage, { kind: 'reading', source, choice: FORCED, preview, progress: 0 });
    assert.equal(next.stage.preview, preview);
    assert.deepEqual(effects, [{ type: 'startRead', source, choice: FORCED }]);
  });

  test('from ready, keeps the previous analysis as the dimmed preview', () => {
    const [next, effects] = update(ready(written, { autoColumns: [1] }), { type: 'choiceChanged', choice: FORCED });
    assert.equal(next.stage.kind, 'reading');
    assert.equal(next.stage.preview, analysis);
    assert.equal(next.stage.choice, FORCED);
    assert.equal(next.stage.progress, 0);
    assert.deepEqual(effects, [{ type: 'startRead', source, choice: FORCED }]);
  });

  test('from empty, does nothing', () => {
    const from = empty();
    const [next, effects] = update(from, { type: 'choiceChanged', choice: FORCED });
    assert.equal(next, from);
    assert.deepEqual(effects, []);
  });
});

describe('readEvent', () => {
  test('progress updates the reading stage', () => {
    const [next, effects] = update(reading(), { type: 'readEvent', event: { type: 'progress', ratio: 0.42 } });
    assert.equal(next.stage.kind, 'reading');
    assert.equal(next.stage.progress, 0.42);
    assert.deepEqual(effects, []);
  });

  test('preview replaces the previous preview', () => {
    const fresh = { ...preview, records: [['a']] };
    const [next, effects] = update(reading({ preview }), { type: 'readEvent', event: { type: 'preview', preview: fresh } });
    assert.equal(next.stage.kind, 'reading');
    assert.equal(next.stage.preview, fresh);
    assert.deepEqual(effects, []);
  });

  test('done is ready with no autoColumns and output idle', () => {
    const [next, effects] = update(reading({ choice: FORCED, progress: 1 }), { type: 'readEvent', event: { type: 'done', analysis } });
    assert.equal(next.stage.kind, 'ready');
    assert.deepEqual(next.stage, { kind: 'ready', source, choice: FORCED, analysis, autoColumns: [], output: { kind: 'idle' } });
    assert.deepEqual(effects, []);
  });

  test('failed is empty with the error as notice', () => {
    const error = { code: 'NOT_CSV_XLSX' };
    const [next, effects] = update(reading({ preview }), { type: 'readEvent', event: { type: 'failed', error } });
    assert.equal(next.stage.kind, 'empty');
    assert.deepEqual(next.stage, { kind: 'empty', notice: { code: 'NOT_CSV_XLSX' } });
    assert.deepEqual(effects, []);
  });

  test('outside reading, is ignored', () => {
    for (const from of [empty(), ready()]) {
      const [next, effects] = update(from, { type: 'readEvent', event: { type: 'done', analysis } });
      assert.equal(next, from);
      assert.deepEqual(effects, []);
    }
  });
});

describe('headerToggled', () => {
  test('in empty and reading, flips the preference only', () => {
    for (const from of [empty(), reading({ preview })]) {
      const [next, effects] = update(from, { type: 'headerToggled' });
      assert.equal(next.stage.kind, from.stage.kind);
      assert.equal(next.header, false);
      assert.equal(next.stage, from.stage);
      assert.deepEqual(effects, []);
    }
  });

  test('in ready, flips the preference and returns the output to idle', () => {
    for (const output of [{ kind: 'idle' }, written, failed]) {
      const [next, effects] = update(ready(output, { autoColumns: [0] }), { type: 'headerToggled' });
      assert.equal(next.stage.kind, 'ready');
      assert.equal(next.header, false);
      assert.deepEqual(next.stage.output, { kind: 'idle' });
      assert.deepEqual(next.stage.autoColumns, [0]);
      assert.deepEqual(effects, []);
    }
  });

  test('while writing, also cancels the write', () => {
    const [next, effects] = update(ready(writing), { type: 'headerToggled' });
    assert.equal(next.stage.kind, 'ready');
    assert.deepEqual(next.stage.output, { kind: 'idle' });
    assert.deepEqual(effects, [{ type: 'cancelWrite' }]);
  });
});

describe('columnModeToggled', () => {
  test('adds and removes a column, keeping the list sorted', () => {
    let session = ready();
    const steps = [[3, [3]], [1, [1, 3]], [3, [1]], [1, []]];
    for (const [col, expected] of steps) {
      const [next, effects] = update(session, { type: 'columnModeToggled', col });
      assert.equal(next.stage.kind, 'ready');
      assert.deepEqual(next.stage.autoColumns, expected);
      assert.deepEqual(effects, []);
      session = next;
    }
  });

  test('returns the output to idle, cancelling a write in progress', () => {
    const [afterWritten, none] = update(ready(written), { type: 'columnModeToggled', col: 0 });
    assert.deepEqual(afterWritten.stage.output, { kind: 'idle' });
    assert.deepEqual(none, []);
    const [afterWriting, effects] = update(ready(writing), { type: 'columnModeToggled', col: 0 });
    assert.equal(afterWriting.stage.kind, 'ready');
    assert.deepEqual(afterWriting.stage.output, { kind: 'idle' });
    assert.deepEqual(afterWriting.stage.autoColumns, [0]);
    assert.deepEqual(effects, [{ type: 'cancelWrite' }]);
  });

  test('outside ready, is ignored', () => {
    for (const from of [empty(), reading({ preview })]) {
      const [next, effects] = update(from, { type: 'columnModeToggled', col: 0 });
      assert.equal(next, from);
      assert.deepEqual(effects, []);
    }
  });
});

describe('writeEvent', () => {
  test('progress updates the writing output', () => {
    const [next, effects] = update(ready(writing), { type: 'writeEvent', event: { type: 'progress', ratio: 0.5 } });
    assert.equal(next.stage.kind, 'ready');
    assert.deepEqual(next.stage.output, { kind: 'writing', format: 'xlsx', progress: 0.5 });
    assert.deepEqual(effects, []);
  });

  test('done is written and downloads the file', () => {
    const [next, effects] = update(ready(writing), { type: 'writeEvent', event: { type: 'done', file } });
    assert.equal(next.stage.kind, 'ready');
    assert.deepEqual(next.stage.output, { kind: 'written', format: 'xlsx', file });
    assert.deepEqual(effects, [{ type: 'download', file }]);
  });

  test('failed keeps the format and the error', () => {
    const error = { code: 'OUTPUT_TOO_LARGE' };
    const [next, effects] = update(ready({ kind: 'writing', format: 'csv', progress: 0.9 }), {
      type: 'writeEvent', event: { type: 'failed', error },
    });
    assert.equal(next.stage.kind, 'ready');
    assert.deepEqual(next.stage.output, { kind: 'failed', format: 'csv', error: { code: 'OUTPUT_TOO_LARGE' } });
    assert.deepEqual(effects, []);
  });

  test('when not writing, is ignored', () => {
    for (const from of [empty(), reading(), ready(), ready(written)]) {
      const [next, effects] = update(from, { type: 'writeEvent', event: { type: 'done', file } });
      assert.equal(next, from);
      assert.deepEqual(effects, []);
    }
  });
});

describe('writeCancelled', () => {
  test('while writing, returns to idle and cancels the write', () => {
    const [next, effects] = update(ready(writing), { type: 'writeCancelled' });
    assert.equal(next.stage.kind, 'ready');
    assert.deepEqual(next.stage.output, { kind: 'idle' });
    assert.deepEqual(effects, [{ type: 'cancelWrite' }]);
  });

  test('when not writing, is ignored', () => {
    for (const from of [empty(), reading(), ready(), ready(written)]) {
      const [next, effects] = update(from, { type: 'writeCancelled' });
      assert.equal(next, from);
      assert.deepEqual(effects, []);
    }
  });
});

describe('redownloadRequested', () => {
  test('when written, downloads the same file again', () => {
    const from = ready(written);
    const [next, effects] = update(from, { type: 'redownloadRequested' });
    assert.equal(next, from);
    assert.equal(next.stage.kind, 'ready');
    assert.deepEqual(effects, [{ type: 'download', file }]);
  });

  test('when nothing is written, is ignored', () => {
    for (const from of [empty(), reading(), ready(), ready(writing), ready(failed)]) {
      const [next, effects] = update(from, { type: 'redownloadRequested' });
      assert.equal(next, from);
      assert.deepEqual(effects, []);
    }
  });
});

describe('reset', () => {
  test('from any stage, is empty without notice and cancels both jobs', () => {
    for (const from of [empty({ code: 'EMPTY_FILE' }), reading({ preview }), ready(writing)]) {
      const [next, effects] = update({ ...from, header: false }, { type: 'reset' });
      assert.equal(next.stage.kind, 'empty');
      assert.deepEqual(next, { env: ENV, header: false, stage: { kind: 'empty', notice: null } });
      assert.deepEqual(effects, [{ type: 'cancelRead' }, { type: 'cancelWrite' }]);
    }
  });
});

// These go through planSheet in core/excel.js.
describe('writeRequested and canWrite', () => {
  test('ready and writable: writing, with the current options', () => {
    const from = ready({ kind: 'idle' }, { autoColumns: [1] }, { header: false });
    const [next, effects] = update(from, { type: 'writeRequested', format: 'xlsx' });
    assert.equal(next.stage.kind, 'ready');
    assert.deepEqual(next.stage.output, { kind: 'writing', format: 'xlsx', progress: 0 });
    assert.deepEqual(effects, [{
      type: 'startWrite', format: 'xlsx', source, analysis, options: { header: false, autoColumns: [1] },
    }]);
  });

  test('also from written and failed outputs', () => {
    for (const output of [written, failed]) {
      const [next, effects] = update(ready(output), { type: 'writeRequested', format: 'csv' });
      assert.deepEqual(next.stage.output, { kind: 'writing', format: 'csv', progress: 0 });
      assert.deepEqual(effects, [{ type: 'startWrite', format: 'csv', source, analysis, options: { header: true, autoColumns: [] } }]);
    }
  });

  test('xlsx without CompressionStream: blocked, csv still writes', () => {
    const from = { ...ready(), env: { xlsx: false } };
    assert.equal(canWrite(from, 'xlsx'), false);
    assert.equal(canWrite(from, 'csv'), true);
    const [next, effects] = update(from, { type: 'writeRequested', format: 'xlsx' });
    assert.equal(next, from);
    assert.deepEqual(effects, []);
  });

  test('xlsx with a planSheet blocker: blocked, csv still writes', () => {
    const blocked = ready({ kind: 'idle' }, { analysis: analysisOf({ overlong: { count: 1, row: 1, col: 0 } }) });
    assert.equal(canWrite(blocked, 'xlsx'), false);
    assert.equal(canWrite(blocked, 'csv'), true);
    const [next, effects] = update(blocked, { type: 'writeRequested', format: 'xlsx' });
    assert.equal(next, blocked);
    assert.deepEqual(effects, []);
    const [writingCsv, csvEffects] = update(blocked, { type: 'writeRequested', format: 'csv' });
    assert.deepEqual(writingCsv.stage.output, { kind: 'writing', format: 'csv', progress: 0 });
    assert.equal(csvEffects.length, 1);
  });

  test('too many rows blocks xlsx', () => {
    const tall = ready({ kind: 'idle' }, { analysis: analysisOf({ rows: 1_048_577 }) });
    assert.equal(canWrite(tall, 'xlsx'), false);
  });

  test('canWrite is true for both formats on a clean ready stage, false before ready', () => {
    assert.equal(canWrite(ready(), 'xlsx'), true);
    assert.equal(canWrite(ready(), 'csv'), true);
    for (const from of [empty(), reading({ preview })]) {
      assert.equal(canWrite(from, 'xlsx'), false);
      assert.equal(canWrite(from, 'csv'), false);
      const [next, effects] = update(from, { type: 'writeRequested', format: 'csv' });
      assert.equal(next, from);
      assert.deepEqual(effects, []);
    }
  });
});
