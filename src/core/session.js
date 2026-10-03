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
  return { env, header: true, stage: { kind: 'empty', notice: null } };
}

/**
 * Transition table: design.md, Q8. A message that does not apply to the current stage returns the session unchanged.
 * @param {Session} session
 * @param {Msg} msg
 * @returns {[Session, Effect[]]}
 */
export function update(session, msg) {
  const { stage } = session;
  switch (msg.type) {
    case 'sourceChosen':
      return chooseSource(session, msg.source);
    case 'choiceChanged': {
      if (stage.kind === 'empty') return [session, []];
      const preview = stage.kind === 'reading' ? stage.preview : stage.analysis;
      const { source } = stage;
      return [
        { ...session, stage: { kind: 'reading', source, choice: msg.choice, preview, progress: 0 } },
        [{ type: 'startRead', source, choice: msg.choice }],
      ];
    }
    case 'readEvent':
      return stage.kind === 'reading' ? [{ ...session, stage: afterReadEvent(stage, msg.event) }, []] : [session, []];
    case 'headerToggled': {
      const header = !session.header;
      if (stage.kind !== 'ready') return [{ ...session, header }, []];
      return [{ ...session, header, stage: { ...stage, output: { kind: 'idle' } } }, stopWriting(stage.output)];
    }
    case 'columnModeToggled': {
      if (stage.kind !== 'ready') return [session, []];
      const autoColumns = stage.autoColumns.includes(msg.col)
        ? stage.autoColumns.filter((col) => col !== msg.col)
        : [...stage.autoColumns, msg.col].sort((a, b) => a - b);
      return [{ ...session, stage: { ...stage, autoColumns, output: { kind: 'idle' } } }, stopWriting(stage.output)];
    }
    case 'writeRequested': {
      if (stage.kind !== 'ready' || !canWrite(session, msg.format)) return [session, []];
      const { format } = msg;
      const options = { header: session.header, autoColumns: stage.autoColumns };
      return [
        { ...session, stage: { ...stage, output: { kind: 'writing', format, progress: 0 } } },
        [{ type: 'startWrite', format, source: stage.source, analysis: stage.analysis, options }],
      ];
    }
    case 'writeEvent': {
      if (stage.kind !== 'ready' || stage.output.kind !== 'writing') return [session, []];
      const { format } = stage.output;
      const { event } = msg;
      if (event.type === 'progress') {
        return [{ ...session, stage: { ...stage, output: { kind: 'writing', format, progress: event.ratio } } }, []];
      }
      if (event.type === 'done') {
        return [
          { ...session, stage: { ...stage, output: { kind: 'written', format, file: event.file } } },
          [{ type: 'download', file: event.file }],
        ];
      }
      return [{ ...session, stage: { ...stage, output: { kind: 'failed', format, error: event.error } } }, []];
    }
    case 'writeCancelled':
      if (stage.kind !== 'ready' || stage.output.kind !== 'writing') return [session, []];
      return [{ ...session, stage: { ...stage, output: { kind: 'idle' } } }, [{ type: 'cancelWrite' }]];
    case 'redownloadRequested':
      if (stage.kind !== 'ready' || stage.output.kind !== 'written') return [session, []];
      return [session, [{ type: 'download', file: stage.output.file }]];
    case 'reset':
      return [{ ...session, stage: { kind: 'empty', notice: null } }, [{ type: 'cancelRead' }, { type: 'cancelWrite' }]];
    default: {
      /** @type {never} */
      const unhandled = msg;
      void unhandled;
      return [session, []];
    }
  }
}

/** csv: always, once ready. xlsx: env.xlsx and planSheet(...).blockers is empty. @param {Session} session @param {Format} format @returns {boolean} */
export function canWrite(session, format) {
  const { stage } = session;
  if (stage.kind !== 'ready') return false;
  if (format === 'csv') return true;
  if (!session.env.xlsx) return false;
  return planSheet(stage.analysis, { header: session.header, autoColumns: stage.autoColumns }).blockers.length === 0;
}

/** @param {Session} session @param {Source} source @returns {[Session, Effect[]]} */
function chooseSource(session, source) {
  const { size } = source.blob;
  if (size === 0 || size > MAX_INPUT_BYTES) {
    /** @type {AppError} */
    const notice = size === 0 ? { code: 'EMPTY_FILE' } : { code: 'FILE_TOO_LARGE', bytes: size };
    return [{ ...session, stage: { kind: 'empty', notice } }, [{ type: 'cancelRead' }, { type: 'cancelWrite' }]];
  }
  return [
    { ...session, stage: { kind: 'reading', source, choice: AUTO_CHOICE, preview: null, progress: 0 } },
    [{ type: 'startRead', source, choice: AUTO_CHOICE }],
  ];
}

/** @param {Extract<Stage, { kind: 'reading' }>} stage @param {ReadEvent} event @returns {Stage} */
function afterReadEvent(stage, event) {
  switch (event.type) {
    case 'progress':
      return { ...stage, progress: event.ratio };
    case 'preview':
      return { ...stage, preview: event.preview };
    case 'done':
      return {
        kind: 'ready', source: stage.source, choice: stage.choice, analysis: event.analysis, autoColumns: [], output: { kind: 'idle' },
      };
    case 'failed':
      return { kind: 'empty', notice: event.error };
  }
}

/** @param {Output} output @returns {Effect[]} */
function stopWriting(output) {
  return output.kind === 'writing' ? [{ type: 'cancelWrite' }] : [];
}
