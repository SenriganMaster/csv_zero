import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { deflateEntry, zipBlob } from '../../src/core/zip.js';
import { hasPython, readZip } from '../helpers/python.js';

const utf8 = (/** @type {string} */ text) => new TextEncoder().encode(text);
const NO_PYTHON = hasPython ? false : 'python3 is missing';

/** @param {Uint8Array[]} parts */
const concat = (parts) => Buffer.concat(parts);

/** A gzip stream with every optional header field set, delivered one byte per chunk. */
class FlaggedGzip {
  constructor() {
    /** @type {Uint8Array[]} */
    const input = [];
    const { readable, writable } = new TransformStream({
      transform: (chunk) => void input.push(chunk),
      flush(controller) {
        const data = concat(input);
        const fextraFhcrcFnameFcomment = 4 | 2 | 8 | 16;
        const header = [0x1f, 0x8b, 8, fextraFhcrcFnameFcomment, 0, 0, 0, 0, 0, 3, 3, 0, 0xaa, 0xbb, 0xcc, ...utf8('a.txt\0hi\0'), 0x12, 0x34];
        const trailer = Buffer.alloc(8);
        trailer.writeUInt32LE(zlib.crc32(data), 0);
        trailer.writeUInt32LE(data.length, 4);
        for (const byte of [...header, ...zlib.deflateRawSync(data), ...trailer]) controller.enqueue(Uint8Array.of(byte));
      },
    });
    this.readable = readable;
    this.writable = writable;
  }
}

describe('deflateEntry', () => {
  test('streams chunks into raw deflate with the CRC-32 and size of the input', async () => {
    const chunks = Array.from({ length: 300 }, (_, i) => utf8(`${String(i).padStart(4, '0')},髙橋,0600000\r\n`));
    async function* source() {
      yield* chunks;
    }
    const entry = await deflateEntry('xl/worksheets/sheet1.xml', source());
    const data = concat(chunks);
    assert.equal(entry.name, 'xl/worksheets/sheet1.xml');
    assert.equal(entry.size, data.length);
    assert.equal(entry.crc, zlib.crc32(data));
    assert.equal(entry.compressedSize, concat(entry.data).length);
    assert.deepEqual(zlib.inflateRawSync(concat(entry.data)), data);
  });

  test('an empty entry', async () => {
    const entry = await deflateEntry('empty.txt', []);
    assert.deepEqual([entry.size, entry.crc], [0, 0]);
    assert.equal(zlib.inflateRawSync(concat(entry.data)).length, 0);
  });

  test('skips FEXTRA, FNAME, FCOMMENT and FHCRC, and finds the trailer across chunks', async () => {
    const native = globalThis.CompressionStream;
    globalThis.CompressionStream = /** @type {typeof CompressionStream} */ (/** @type {unknown} */ (FlaggedGzip));
    try {
      const data = utf8('0001,0600000,=SUM(A1)\r\n'.repeat(20));
      const entry = await deflateEntry('a.txt', [data]);
      assert.deepEqual(concat(entry.data), zlib.deflateRawSync(data));
      assert.deepEqual([entry.crc, entry.size], [zlib.crc32(data), data.length]);
    } finally {
      globalThis.CompressionStream = native;
    }
  });
});

describe('zipBlob', () => {
  /** @param {string} name @param {string} text */
  const entryOf = (name, text) => deflateEntry(name, [utf8(text)]);

  test('Python reads every entry back with valid CRCs', { skip: NO_PYTHON }, async () => {
    const entries = [await entryOf('[Content_Types].xml', '<Types/>'), await entryOf('xl/a.xml', '髙橋 ①\r\n'.repeat(500))];
    const zip = zipBlob(entries, 'application/zip');
    assert.ok(zip.ok);
    const archive = await readZip(zip.value);
    assert.equal(archive.bad, null);
    assert.deepEqual(archive.entries, [
      ['[Content_Types].xml', 8, 8],
      ['xl/a.xml', 8, utf8('髙橋 ①\r\n').length * 500],
    ]);
    assert.equal(archive.parts['xl/a.xml'], '髙橋 ①\r\n'.repeat(500));
    assert.equal(zip.value.type, 'application/zip');
  });

  test('equal inputs give equal bytes, with the DOS time fixed at 1980-01-01 00:00', async () => {
    const write = async () => {
      const zip = zipBlob([await entryOf('a.txt', 'same')], 'application/zip');
      assert.ok(zip.ok);
      return new Uint8Array(await zip.value.arrayBuffer());
    };
    const first = await write();
    assert.deepEqual(first, await write());
    assert.deepEqual([...first.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
    assert.deepEqual([...first.subarray(10, 14)], [0x00, 0x00, 0x21, 0x00]);
  });

  /** @param {Partial<import('../../src/core/zip.js').ZipEntry>} fields */
  const fake = (fields) => ({ name: 'x', data: [], crc: 0, size: 0, compressedSize: 0, ...fields });
  /** @type {[string, import('../../src/core/zip.js').ZipEntry[]][]} */
  const tooLarge = [
    ['a size of 2^32', [fake({ size: 2 ** 32 })]],
    ['a size of 2^32 - 1, which reads as a Zip64 marker', [fake({ size: 2 ** 32 - 1 })]],
    ['a compressed size of 2^32', [fake({ compressedSize: 2 ** 32 })]],
    ['a local header at 2^32', [fake({ compressedSize: 2 ** 32 - 31 }), fake({})]],
    ['a central directory that ends past 2^32', [fake({ compressedSize: 2 ** 32 - 60 })]],
  ];
  for (const [label, entries] of tooLarge) {
    test(`OUTPUT_TOO_LARGE for ${label}`, () => {
      assert.deepEqual(zipBlob(entries, 'application/zip'), { ok: false, error: { code: 'OUTPUT_TOO_LARGE' } });
    });
  }
});
