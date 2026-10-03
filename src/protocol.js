/** @import { Source, ParseChoice, Preview, Analysis, Format, OutputFile } from './core/convert.js' */
/** @import { SheetOptions } from './core/excel.js' */
/** @import { AppError } from './core/messages.js' */

/** @typedef {{ type: 'read', source: Source, choice: ParseChoice }} ReadRequest */
/** @typedef {{ type: 'write', format: Format, source: Source, analysis: Analysis, options: SheetOptions }} WriteRequest */
/** @typedef {ReadRequest | WriteRequest} JobRequest */

/**
 * @typedef {(
 *   | { type: 'progress', ratio: number }
 *   | { type: 'preview', preview: Preview }
 *   | { type: 'done', analysis: Analysis }
 *   | { type: 'failed', error: AppError }
 * )} ReadEvent
 */
/**
 * @typedef {(
 *   | { type: 'progress', ratio: number }
 *   | { type: 'done', file: OutputFile }
 *   | { type: 'failed', error: AppError }
 * )} WriteEvent
 */
/**
 * @template {JobRequest} R
 * @typedef {R extends ReadRequest ? ReadEvent : WriteEvent} EventFor
 */

export {};
