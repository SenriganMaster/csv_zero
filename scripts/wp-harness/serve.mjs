import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startServer } from '../serve.mjs';
import { renderHarness } from './render.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function invokedDirectly() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (invokedDirectly()) {
  const line = fs.readFileSync(path.join(root, 'dist-wp', 'csv-zero-wp.html'), 'utf8');
  const dir = path.join(root, '.work', 'wp-harness');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), renderHarness(line));
  const port = Number(process.argv[2] ?? 8098);
  startServer(dir, port).then(
    (server) => console.log(server.url),
    (error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    },
  );
}
