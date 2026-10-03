import { spawnSync } from 'node:child_process';

export const hasPython = spawnSync('python3', ['--version']).status === 0;

const READ_ZIP = String.raw`
import io, json, re, sys, zipfile
import xml.etree.ElementTree as ET

M = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
archive = zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()))
bad = archive.testzip()

def xstring(text):
    return re.sub(r'_x([0-9A-Fa-f]{4})_', lambda m: chr(int(m.group(1), 16)), text)

def si_text(si):
    return xstring(''.join(t.text or '' for t in si.iter(M + 't')))

strings = []
cells = {}
if 'xl/sharedStrings.xml' in archive.namelist():
    strings = [si_text(si) for si in ET.fromstring(archive.read('xl/sharedStrings.xml')).iter(M + 'si')]
    for c in ET.fromstring(archive.read('xl/worksheets/sheet1.xml')).iter(M + 'c'):
        v = c.find(M + 'v')
        cell = {'s': c.get('s'), 't': c.get('t'), 'v': None if v is None else v.text}
        if cell['t'] == 's':
            cell['text'] = strings[int(cell['v'])]
        cells[c.get('r')] = cell
json.dump({
    'bad': bad,
    'entries': [[i.filename, i.compress_type, i.file_size] for i in archive.infolist()],
    'parts': {i.filename: archive.read(i.filename).decode('utf-8') for i in archive.infolist()},
    'strings': strings,
    'cells': cells,
}, sys.stdout)
`;

const READ_CSV = String.raw`
import csv, io, json, sys
text = sys.stdin.buffer.read().decode(sys.argv[1])
json.dump([row or [''] for row in csv.reader(io.StringIO(text, newline=''), delimiter=sys.argv[2])], sys.stdout)
`;

/**
 * @typedef {{ s: string | null, t: string | null, v: string | null, text?: string }} Cell
 * @typedef {{ bad: string | null, entries: [string, number, number][], parts: Record<string, string>, strings: string[], cells: Record<string, Cell> }} Archive
 */

/** @param {Blob} blob @returns {Promise<Archive>} */
export async function readZip(blob) {
  return JSON.parse(python(READ_ZIP, [], Buffer.from(await blob.arrayBuffer())));
}

/**
 * @param {Uint8Array} bytes
 * @param {string} encoding
 * @param {string} delimiter
 * @returns {string[][]}
 */
export function pythonCsv(bytes, encoding, delimiter) {
  return JSON.parse(python(READ_CSV, [encoding, delimiter], bytes));
}

/**
 * @param {Uint8Array} bytes
 * @param {string} encoding
 * @param {string} delimiter
 */
export function sheetRecords(bytes, encoding, delimiter) {
  const records = pythonCsv(bytes, encoding, delimiter);
  while (records.length > 0 && records.at(-1)?.join('') === '' && records.at(-1)?.length === 1) records.pop();
  return records;
}

/** @param {string} script @param {string[]} args @param {Uint8Array} input */
function python(script, args, input) {
  const result = spawnSync('python3', ['-c', script, ...args], { input, maxBuffer: 1 << 28 });
  if (result.status !== 0) throw new Error(result.stderr.toString());
  return result.stdout.toString();
}
