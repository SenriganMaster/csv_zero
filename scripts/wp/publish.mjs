import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { sealFragment, writeSealed } from './fragment.mjs';
import { projectShadowCss } from './shadow-css.mjs';
import { readToolMarkup } from './tool-markup.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * @param {string} repoRoot
 * @param {string} outDir
 */
export async function publishWordPress(repoRoot, outDir) {
  if (path.resolve(outDir) === path.resolve(repoRoot, 'deploy')) {
    throw new Error('build:wp refuses to write deploy/');
  }
  const indexHtml = fs.readFileSync(path.join(repoRoot, 'src', 'index.html'), 'utf8');
  const viewSource = fs.readFileSync(path.join(repoRoot, 'src', 'view.js'), 'utf8');
  const cssPath = path.join(repoRoot, 'src', 'styles.css');
  const draftPath = path.join(repoRoot, 'docs', 'wp', 'PAGE-DRAFT.md');
  if (!fs.existsSync(draftPath)) throw new Error('build:wp failed: docs/wp/PAGE-DRAFT.md is missing');
  const markup = readToolMarkup(indexHtml, viewSource);
  const bundledCss = await esbuild.build({
    absWorkingDir: repoRoot,
    entryPoints: [cssPath],
    bundle: true,
    minify: false,
    charset: 'utf8',
    legalComments: 'none',
    write: false,
  });
  const projected = projectShadowCss(bundledCss.outputFiles[0].text, markup.surface);
  const minCss = await esbuild.transform(projected, { loader: 'css', minify: true, charset: 'utf8', legalComments: 'none' });
  const worker = await esbuild.build({
    absWorkingDir: repoRoot,
    entryPoints: [path.join(repoRoot, 'src', 'worker.js')],
    bundle: true,
    format: 'iife',
    minify: true,
    charset: 'utf8',
    legalComments: 'none',
    target: 'es2020',
    write: false,
  });
  const program = await esbuild.build({
    absWorkingDir: repoRoot,
    entryPoints: [path.join(repoRoot, 'src', 'wp', 'main.js')],
    bundle: true,
    format: 'iife',
    minify: true,
    charset: 'ascii',
    legalComments: 'none',
    target: 'es2020',
    write: false,
    define: {
      __WORKER_SOURCE__: JSON.stringify(worker.outputFiles[0].text),
      __TOOL_MARKUP__: JSON.stringify(markup.html),
      __SHADOW_CSS__: JSON.stringify(minCss.code),
    },
  });
  const js = program.outputFiles[0].text;
  if ([...js].some((char) => (char.codePointAt(0) ?? 0) > 127)) {
    throw new Error('build:wp failed: WordPress bundle is not ASCII');
  }
  const sealed = sealFragment({ fallback: markup.fallback, program: js });
  writeSealed(outDir, sealed, fs.readFileSync(draftPath));
  return { fragmentBytes: sealed.fragmentBytes, decodedBytes: sealed.decodedBytes };
}

function invokedDirectly() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (invokedDirectly()) {
  if (process.argv.length > 2) {
    console.error(`build:wp failed: unknown argument ${process.argv[2]}`);
    process.exit(1);
  }
  publishWordPress(root, path.join(root, 'dist-wp')).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
