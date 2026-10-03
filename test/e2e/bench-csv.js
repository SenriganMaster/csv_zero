import fs from 'node:fs';
import path from 'node:path';

const NAMES = ['山田太郎', '佐藤花子', '鈴木一郎', '高橋美咲', '伊藤健太', '渡辺由美', '中村翔太', '小林さくら'];
const DEPTS = ['営業部', '経理部', '開発部', '総務部'];
const HEADER = 'コード,支店,氏名,日付,金額,電話,注文番号,部署,備考,区分\r\n';
const LINE_BYTES = 103;

/** @param {number} index */
export function benchLine(index) {
  const code = String(index % 10000).padStart(4, '0');
  const branch = String(index % 1000).padStart(3, '0');
  const name = NAMES[index % NAMES.length];
  const date = `2024/${(index % 12) + 1}/${(index % 27) + 2}`;
  const yen = 1000 + (index % 900000);
  const amount = `${Math.floor(yen / 1000)},${String(yen % 1000).padStart(3, '0')}`;
  const phone = `090${String(index % 100000000).padStart(8, '0')}`;
  const order = `1${String(index).padStart(15, '0')}`;
  const dept = DEPTS[index % DEPTS.length];
  const note = `備考${String(index % 100000).padStart(5, '0')}`;
  const body = [code, branch, name, date, amount, phone, order, dept, note, '済'].join(',');
  const size = Buffer.byteLength(body);
  if (size > LINE_BYTES) throw new Error(`bench line is ${size} bytes`);
  return body + 'x'.repeat(LINE_BYTES - size);
}

/**
 * @param {string} file
 * @param {number} dataRows
 * @returns {{ path: string, bytes: number, rows: number }}
 */
export function writeBenchCsv(file, dataRows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const handle = fs.openSync(file, 'w');
  let bytes = 0;
  /** @param {string} text */
  const write = (text) => {
    bytes += Buffer.byteLength(text);
    fs.writeSync(handle, text);
  };
  try {
    write(HEADER);
    /** @type {string[]} */
    const lines = [];
    for (let index = 0; index < dataRows; index++) {
      lines.push(benchLine(index));
      if (lines.length === 4000) {
        write(`${lines.join('\r\n')}\r\n`);
        lines.length = 0;
      }
    }
    if (lines.length > 0) write(`${lines.join('\r\n')}\r\n`);
  } finally {
    fs.closeSync(handle);
  }
  return { path: file, bytes, rows: dataRows + 1 };
}
