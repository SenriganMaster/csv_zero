import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyHostile } from './hostile.mjs';

const templatePath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.html');

/**
 * @param {string} fragmentLine
 * @param {string} [templateHtml]
 * @returns {string}
 */
export function renderHarness(fragmentLine, templateHtml = fs.readFileSync(templatePath, 'utf8')) {
  const marker = '<!-- csv-zero:fragment -->';
  if (!templateHtml.includes(marker)) throw new Error('harness template is missing the fragment marker');
  return templateHtml.replace(marker, applyHostile(fragmentLine));
}
