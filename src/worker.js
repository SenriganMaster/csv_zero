/** The worker shell. Runs the one job it receives and turns unexpected exceptions into AppError values. */

import { analyze, write } from './core/convert.js';

/** @import { JobRequest, ReadEvent, WriteEvent } from './protocol.js' */
/** @import { AppError } from './core/messages.js' */

const scope = /** @type {Worker} */ (/** @type {unknown} */ (self));

/** How the File API reports a file that was edited, moved or deleted after the user chose it. */
const READ_ERRORS = new Set(['NotReadableError', 'NotFoundError']);

scope.addEventListener('message', (event) => void run(/** @type {JobRequest} */ (event.data)), { once: true });

/** @param {JobRequest} request */
async function run(request) {
  /** @param {ReadEvent | WriteEvent} event */
  const post = (event) => scope.postMessage(event);
  const onProgress = percentSteps(post);
  try {
    if (request.type === 'read') {
      const onPreview = (/** @type {import('./core/convert.js').Preview} */ preview) => post({ type: 'preview', preview });
      const result = await analyze(request.source, request.choice, { onPreview, onProgress });
      post(result.ok ? { type: 'done', analysis: result.value } : { type: 'failed', error: result.error });
    } else {
      const { format, source, analysis, options } = request;
      const result = await write(format, source, analysis, options, onProgress);
      post(result.ok ? { type: 'done', file: result.value } : { type: 'failed', error: result.error });
    }
  } catch (error) {
    post({ type: 'failed', error: unexpected(error) });
  }
}

/**
 * A progress hook that posts only when the whole percent goes up.
 * @param {(event: { type: 'progress', ratio: number }) => void} post
 * @returns {(ratio: number) => void}
 */
function percentSteps(post) {
  let posted = -1;
  return (ratio) => {
    const percent = Math.floor(ratio * 100);
    if (percent <= posted) return;
    posted = percent;
    post({ type: 'progress', ratio });
  };
}

/** @param {unknown} error @returns {AppError} */
function unexpected(error) {
  if (error instanceof DOMException && READ_ERRORS.has(error.name)) return { code: 'READ_FAILED' };
  if (error instanceof RangeError) return { code: 'OUT_OF_MEMORY' };
  return { code: 'WORKER_FAILED', detail: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
}
