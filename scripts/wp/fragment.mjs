import fs from 'node:fs';
import path from 'node:path';
import { auditFragment } from './audit.mjs';
import { assembleFragmentLine } from './fragment-contract.mjs';

const token = Symbol('sealed-wp');

/**
 * @typedef {Readonly<{ rule: string, detail: string }>} FragmentViolation
 * @typedef {{
 *   line: string,
 *   block: string,
 *   decoded: string,
 *   fragmentBytes: number,
 *   decodedBytes: number,
 * }} SealedWp
 */

export class AuditError extends Error {
  /** @param {readonly FragmentViolation[]} violations */
  constructor(violations) {
    super(violations.map((item) => `${item.rule}: ${item.detail}`).join('; '));
    this.name = 'AuditError';
    this.violations = violations;
  }
}

/**
 * @param {{ fallback: string, program: string }} input
 * @returns {SealedWp}
 */
export function sealFragment(input) {
  if (![...input.program].every((char) => (char.codePointAt(0) ?? 0) <= 127)) {
    throw new AuditError([{ rule: 'ascii', detail: 'program is not ASCII' }]);
  }
  const base64 = Buffer.from(input.program, 'utf8').toString('base64');
  const line = assembleFragmentLine(input.fallback, base64);
  const violations = auditFragment(line);
  if (violations.length > 0) throw new AuditError(violations);
  const decoded = Buffer.from(base64, 'base64').toString('utf8');
  const block = `<!-- wp:html -->\n${line}\n<!-- /wp:html -->`;
  const sealed = {
    line,
    block,
    decoded,
    fragmentBytes: Buffer.byteLength(line),
    decodedBytes: Buffer.byteLength(decoded),
  };
  Object.defineProperty(sealed, token, { value: true });
  return sealed;
}

/**
 * @param {string} dir
 * @param {SealedWp} sealed
 * @param {Buffer} draft
 */
export function writeSealed(dir, sealed, draft) {
  if (!sealed || /** @type {Record<symbol, unknown>} */ (/** @type {unknown} */ (sealed))[token] !== true) {
    throw new Error('writeSealed refuses an unaudited fragment');
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'csv-zero-wp.html'), sealed.line);
  fs.writeFileSync(path.join(dir, 'csv-zero-wp.block.html'), sealed.block);
  fs.writeFileSync(path.join(dir, 'PAGE-DRAFT.md'), draft);
  for (const name of ['csv-zero-wp.html', 'csv-zero-wp.block.html', 'PAGE-DRAFT.md']) {
    const file = path.join(dir, name);
    const kb = (fs.statSync(file).size / 1024).toFixed(1);
    console.log(`${path.relative(process.cwd(), file).split(path.sep).join('/')} ${kb} KB`);
  }
  console.log(`dist-wp/csv-zero-wp.js ${(sealed.decodedBytes / 1024).toFixed(1)} KB`);
}
