import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { finalizeHtml } from './html.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const jsBuild = {
  bundle: true,
  format: 'iife',
  minify: true,
  charset: 'utf8',
  legalComments: 'none',
  target: 'es2020',
  absWorkingDir: root,
  metafile: true,
};

async function bundleJs(entry, entryNames, outdir, define) {
  const result = await esbuild.build({
    ...jsBuild,
    entryPoints: [entry],
    entryNames,
    outdir,
    define,
  });
  const outputs = Object.keys(result.metafile.outputs);
  if (outputs.length !== 1) {
    throw new Error(`expected one output for ${entry}, got ${outputs.join(', ') || 'none'}`);
  }
  return outputs[0];
}

function copyInto(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isSymbolicLink()) {
      fs.symlinkSync(fs.readlinkSync(from), to);
    } else if (entry.isDirectory()) {
      copyInto(from, to);
    } else {
      fs.copyFileSync(from, to);
    }
  }
}

function filesIn(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesIn(full));
    else out.push(full);
  }
  return out;
}

function outputDir(argv) {
  let out = 'deploy';
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--out') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) {
        throw new Error('build failed: --out requires a directory');
      }
      out = value;
      i += 1;
      continue;
    }
    throw new Error(`build failed: unknown argument ${arg}`);
  }
  const deployDir = path.resolve(root, out);
  const rel = path.relative(root, deployDir);
  // "." would resolve to the repo root and delete it.
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('build failed: --out must be a directory inside the repo');
  }
  return deployDir;
}

async function main() {
  const deployDir = outputDir(process.argv);
  const assetsDir = path.relative(root, path.join(deployDir, 'assets')).split(path.sep).join('/');
  fs.rmSync(deployDir, { recursive: true, force: true });
  fs.mkdirSync(deployDir, { recursive: true });

  const workerOut = await bundleJs('src/worker.js', 'worker-[hash]', assetsDir);
  const workerBase = path.basename(workerOut);
  // The page resolves the worker against the bundle URL, so the hash file's basename is enough.
  const mainOut = await bundleJs('src/main.js', 'main-[hash]', assetsDir, {
    __WORKER_FILE__: JSON.stringify(workerBase),
  });
  const cssResult = await esbuild.build({
    absWorkingDir: root,
    entryPoints: ['src/styles.css'],
    bundle: true,
    minify: true,
    charset: 'utf8',
    legalComments: 'none',
    metafile: true,
    outdir: assetsDir,
    entryNames: 'styles-[hash]',
  });
  const cssOutputs = Object.keys(cssResult.metafile.outputs);
  if (cssOutputs.length !== 1) {
    throw new Error(`expected one css output, got ${cssOutputs.join(', ') || 'none'}`);
  }
  const cssBase = path.basename(cssOutputs[0]);
  const mainBase = path.basename(mainOut);

  const html = finalizeHtml(fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8'), {
    styles: `./assets/${cssBase}`,
    main: `./assets/${mainBase}`,
  });
  fs.writeFileSync(path.join(deployDir, 'index.html'), html);

  const publicDir = path.join(root, 'public');
  if (fs.existsSync(publicDir)) copyInto(publicDir, deployDir);

  for (const file of filesIn(deployDir).sort()) {
    const kb = (fs.statSync(file).size / 1024).toFixed(1);
    const rel = path.relative(root, file).split(path.sep).join('/');
    console.log(`${rel} ${kb} KB`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
