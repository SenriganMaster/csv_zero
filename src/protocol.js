/** Messages between main.js and worker.js. Types only. A worker receives exactly one request and runs one job. */

/** @import { Source, ParseChoice, Preview, Analysis, Format, OutputFile } from './core/convert.js' */
/** @import { SheetOptions } from './core/excel.js' */
/** @import { AppError } from './core/messages.js' */

/** @typedef {{ type: 'read', source: Source, choice: ParseChoice }} ReadRequest */
/** @typedef {{ type: 'write', format: Format, source: Source, analysis: Analysis, options: SheetOptions }} WriteRequest */
/** @typedef {ReadRequest | WriteRequest} JobRequest */

/**
 * Read job: progress events and at most one preview, in any order, then exactly one done or failed.
 * @typedef {(
 *   | { type: 'progress', ratio: number }
 *   | { type: 'preview', preview: Preview }
 *   | { type: 'done', analysis: Analysis }
 *   | { type: 'failed', error: AppError }
 * )} ReadEvent
 */
/**
 * Write job: progress events, then exactly one done or failed.
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
