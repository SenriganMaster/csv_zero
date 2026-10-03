import fs from 'node:fs';
import path from 'node:path';
import { run } from 'node:test';
import { spec, tap } from 'node:test/reporters';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const unitDir = path.join(root, 'test', 'unit');

// Node 24 does not walk a directory.
const TEST_FILE_RE = /^(?:test(?:[.-].+)?|.+[._-]test)\.(?:c|m)?js$/;

function testFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...testFiles(full));
    else if (TEST_FILE_RE.test(entry.name)) files.push(full);
  }
  return files;
}

const files = testFiles(unitDir).sort();
const reporter = process.stdout.isTTY ? spec : tap;
const stream = run({ files, isolation: 'process' });
stream.on('test:fail', () => {
  process.exitCode = 1;
});
stream.compose(reporter).pipe(process.stdout);
