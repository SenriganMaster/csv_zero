/** The page's state machine. update() is pure: it returns the next session and the effects main.js runs. */

import { planSheet } from './excel.js';

/** @import { Source, ParseChoice, Preview, Analysis, Format, OutputFile } from './convert.js' */
/** @import { AppError } from './messages.js' */
/** @import { SheetOptions } from './excel.js' */
/** @import { ReadEvent, WriteEvent } from '../protocol.js' */

/** @typedef {{ xlsx: boolean }} Env  Probed once at boot: CompressionStream exists. */

/**
 * @typedef {(
 *   | { kind: 'idle' }
 *   | { kind: 'writing', format: Format, progress: number }
 *   | { kind: 'written', format: Format, file: OutputFile }
 *   | { kind: 'failed', format: Format, error: AppError }
 * )} Output
 */
/**
 * `reading.preview` starts as the previous analysis when only the choice changed. The view dims it until replaced.
 * @typedef {(
 *   | { kind: 'empty', notice: AppError | null }
 *   | { kind: 'reading', source: Source, choice: ParseChoice, preview: Preview | null, progress: number }
 *   | { kind: 'ready', source: Source, choice: ParseChoice, analysis: Analysis, autoColumns: readonly number[], output: Output }
 * )} Stage
 */
/** @typedef {{ env: Env, header: boolean, stage: Stage }} Session  `header` is a preference that survives new files. */

/**
 * @typedef {(
 *   | { type: 'sourceChosen', source: Source }
 *   | { type: 'choiceChanged', choice: ParseChoice }
 *   | { type: 'headerToggled' }
 *   | { type: 'columnModeToggled', col: number }
 *   | { type: 'writeRequested', format: Format }
 *   | { type: 'writeCancelled' }
 *   | { type: 'redownloadRequested' }
 *   | { type: 'reset' }
 *   | { type: 'readEvent', event: ReadEvent }
 *   | { type: 'writeEvent', event: WriteEvent }
 * )} Msg
 */
/**
 * main.js runs these. startRead first cancels any read and any write. startWrite first cancels any write.
 * @typedef {(
 *   | { type: 'startRead', source: Source, choice: ParseChoice }
 *   | { type: 'startWrite', format: Format, source: Source, analysis: Analysis, options: SheetOptions }
 *   | { type: 'cancelRead' }
 *   | { type: 'cancelWrite' }
 *   | { type: 'download', file: OutputFile }
 * )} Effect
 */

export const MAX_INPUT_BYTES = 200 * 1024 * 1024;

/** @type {ParseChoice} */
export const AUTO_CHOICE = Object.freeze({ encoding: 'auto', delimiter: 'auto' });

/** Returns { env, header: true, stage: { kind: 'empty', notice: null } }. @param {Env} env @returns {Session} */
export function initialSession(env) {
  throw new Error('not implemented');
}

/**
 * Transition table: design.md, Q8. A message that does not apply to the current stage returns the session unchanged.
 * @param {Session} session
 * @param {Msg} msg
 * @returns {[Session, Effect[]]}
 */
export function update(session, msg) {
  // TODO switch (msg.type) with a `never` default.
  // TODO sourceChosen checks blob.size against 0 and MAX_INPUT_BYTES before any worker starts.
  // TODO headerToggled and columnModeToggled reset `output` to idle, adding cancelWrite while writing.
  throw new Error('not implemented');
}

/** csv: always, once ready. xlsx: env.xlsx and planSheet(...).blockers is empty. @param {Session} session @param {Format} format @returns {boolean} */
export function canWrite(session, format) {
  throw new Error('not implemented');
}
