import { initialSession, update } from './core/session.js';
import { findRefs, render, selectTab, showDrag } from './view.js';

/** @import { Session, Msg, Effect } from './core/session.js' */
/** @import { Format, OutputFile, Source } from './core/convert.js' */
/** @import { Encoding } from './core/text.js' */
/** @import { Delimiter } from './core/csv.js' */
/** @import { JobRequest, ReadRequest, WriteRequest, EventFor } from './protocol.js' */
/** @import { Refs } from './view.js' */

const workerUrl = Promise.resolve(URL.createObjectURL(new Blob([__WORKER_SOURCE__], { type: 'text/javascript' })));

/**
 * @template {JobRequest} R
 * @param {Promise<string>} workerUrl
 * @param {R} request
 * @param {(event: EventFor<R>) => void} onEvent
 * @returns {{ cancel(): void }}
 */
function runJob(workerUrl, request, onEvent) {
  let live = true;
  /** @type {Worker | null} */
  let worker = null;
  const stop = () => {
    live = false;
    worker?.terminate();
  };
  /** @param {string} detail */
  const fail = (detail) => {
    if (!live) return;
    stop();
    console.error(detail);
    onEvent(/** @type {EventFor<R>} */ ({ type: 'failed', error: { code: 'WORKER_FAILED', detail } }));
  };
  void workerUrl.then((url) => {
    if (!live) return;
    try {
      worker = new Worker(url);
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
      return;
    }
    worker.addEventListener('message', (message) => {
      if (!live) return;
      const event = /** @type {EventFor<R>} */ (message.data);
      if (event.type === 'done' || event.type === 'failed') stop();
      onEvent(event);
    });
    worker.addEventListener('error', (error) => {
      error.preventDefault();
      fail(error.message || 'worker error');
    });
    worker.addEventListener('messageerror', () => fail('messageerror'));
    worker.postMessage(request);
  });
  return { cancel: stop };
}

/** @type {{ file: OutputFile, url: string } | null} */
let liveUrl = null;

/** @param {OutputFile} file @returns {string} */
function objectUrl(file) {
  if (liveUrl?.file !== file) {
    if (liveUrl) URL.revokeObjectURL(liveUrl.url);
    liveUrl = { file, url: URL.createObjectURL(file.blob) };
  }
  return liveUrl.url;
}

/** @param {Session} session */
function releaseUrl(session) {
  const { stage } = session;
  const kept = stage.kind === 'ready' && stage.output.kind === 'written' ? stage.output.file : null;
  if (liveUrl && liveUrl.file !== kept) {
    URL.revokeObjectURL(liveUrl.url);
    liveUrl = null;
  }
}

/** @param {OutputFile} file */
function download(file) {
  const link = document.createElement('a');
  link.href = objectUrl(file);
  link.download = file.name;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
}

/**
 * @param {Session} initial
 * @param {Refs} refs
 * @param {Promise<string>} workerUrl
 */
function createStore(initial, refs, workerUrl) {
  let session = initial;
  /** @type {{ cancel(): void } | null} */
  let read = null;
  /** @type {{ cancel(): void } | null} */
  let write = null;

  /** @param {Effect} effect */
  const run = (effect) => {
    switch (effect.type) {
      case 'startRead': {
        read?.cancel();
        write?.cancel();
        write = null;
        /** @type {ReadRequest} */
        const request = { type: 'read', source: effect.source, choice: effect.choice };
        read = runJob(workerUrl, request, (event) => dispatch({ type: 'readEvent', event }));
        break;
      }
      case 'startWrite': {
        write?.cancel();
        /** @type {WriteRequest} */
        const request = { type: 'write', format: effect.format, source: effect.source, analysis: effect.analysis, options: effect.options };
        write = runJob(workerUrl, request, (event) => dispatch({ type: 'writeEvent', event }));
        break;
      }
      case 'cancelRead':
        read?.cancel();
        read = null;
        break;
      case 'cancelWrite':
        write?.cancel();
        write = null;
        break;
      case 'download':
        download(effect.file);
        break;
      default: {
        /** @type {never} */
        const unhandled = effect;
        void unhandled;
      }
    }
  };

  /** @param {Msg} msg */
  const dispatch = (msg) => {
    const [next, effects] = update(session, msg);
    session = next;
    for (const effect of effects) run(effect);
    render(session, refs);
    releaseUrl(session);
  };

  return { dispatch, current: () => session };
}

/**
 * @param {Refs} refs
 * @param {ReturnType<typeof createStore>} store
 */
function bindEvents(refs, store) {
  const { dispatch } = store;
  /** @param {Source} source */
  const choose = (source) => dispatch({ type: 'sourceChosen', source });
  /** @param {File} file */
  const chooseFile = (file) => choose({ kind: 'file', blob: file, name: file.name });

  refs.dropzone.addEventListener('click', () => refs.fileInput.click());
  refs.fileInput.addEventListener('change', () => {
    const file = refs.fileInput.files?.[0];
    refs.fileInput.value = '';
    if (file) chooseFile(file);
  });

  /** @param {DragEvent} event */
  const carriesFiles = (event) => event.dataTransfer?.types.includes('Files') ?? false;
  let depth = 0;
  refs.tool.addEventListener('dragenter', (event) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    depth += 1;
    showDrag(refs, true);
  });
  refs.tool.addEventListener('dragover', (event) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  });
  refs.tool.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (depth === 0) showDrag(refs, false);
  });
  refs.tool.addEventListener('drop', (event) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    depth = 0;
    showDrag(refs, false);
    const file = event.dataTransfer?.files[0];
    if (file) chooseFile(file);
  });
  // A file dropped beside the tool would otherwise replace the page.
  for (const type of /** @type {const} */ (['dragover', 'drop'])) {
    window.addEventListener(type, (event) => {
      if (carriesFiles(event)) event.preventDefault();
    });
  }

  refs.fileTab.addEventListener('click', () => selectTab(refs, 'file'));
  refs.pasteTab.addEventListener('click', () => selectTab(refs, 'paste'));
  for (const tab of [refs.fileTab, refs.pasteTab]) {
    tab.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? refs.fileTab : event.key === 'End' ? refs.pasteTab : tab === refs.fileTab ? refs.pasteTab : refs.fileTab;
      selectTab(refs, next === refs.pasteTab ? 'paste' : 'file');
      next.focus();
    });
  }

  const syncPaste = () => {
    refs.pasteSubmit.disabled = refs.pasteInput.value.length === 0;
  };
  const submitPaste = () => {
    const text = refs.pasteInput.value;
    if (text.length === 0) return;
    choose({ kind: 'paste', blob: new Blob([text], { type: 'text/plain' }), name: '貼り付けデータ' });
  };
  refs.pasteInput.addEventListener('input', syncPaste);
  refs.pasteInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      submitPaste();
    }
  });
  refs.pasteSubmit.addEventListener('click', submitPaste);
  syncPaste();

  const changeChoice = () => dispatch({
    type: 'choiceChanged',
    choice: {
      encoding: /** @type {Encoding | 'auto'} */ (refs.encoding.value),
      delimiter: /** @type {Delimiter | 'auto'} */ (refs.delimiter.value),
    },
  });
  refs.encoding.addEventListener('change', changeChoice);
  refs.delimiter.addEventListener('change', changeChoice);
  refs.header.addEventListener('change', () => dispatch({ type: 'headerToggled' }));

  refs.table.addEventListener('click', (event) => {
    const toggle = event.target instanceof Element ? event.target.closest('button[data-col]') : null;
    if (toggle instanceof HTMLButtonElement) dispatch({ type: 'columnModeToggled', col: Number(toggle.dataset.col) });
  });

  /** @param {Format} format */
  const requestWrite = (format) => {
    const { stage } = store.current();
    const same = stage.kind === 'ready' && stage.output.kind === 'written' && stage.output.format === format;
    dispatch(same ? { type: 'redownloadRequested' } : { type: 'writeRequested', format });
  };
  refs.downloadXlsx.addEventListener('click', () => requestWrite('xlsx'));
  refs.downloadCsv.addEventListener('click', () => requestWrite('csv'));
  refs.writeCancel.addEventListener('click', () => dispatch({ type: 'writeCancelled' }));
  refs.reset.addEventListener('click', () => {
    dispatch({ type: 'reset' });
    (refs.pastePanel.hidden ? refs.dropzone : refs.pasteInput).focus();
  });
}

/**
 * ?embed=1 sets data-embed on <html> before first paint. Inside a frame, a ResizeObserver posts
 * { type: 'csv-zero:height', height } to the parent whenever the rounded-up height of <html> changes.
 * targetOrigin is '*' because the payload is one number.
 */
function setupEmbed() {
  const root = document.documentElement;
  if (root.dataset.embed !== '1' || window.parent === window) return;
  let sent = 0;
  new ResizeObserver(() => {
    const height = Math.ceil(root.getBoundingClientRect().height);
    if (height === sent) return;
    sent = height;
    window.parent.postMessage({ type: 'csv-zero:height', height }, '*');
  }).observe(root);
}

function setupCopy() {
  const button = document.querySelector('[data-testid="copy-embed"]');
  const code = document.querySelector('[data-ref="embed-code"]');
  const label = document.querySelector('[data-ref="copy-label"]');
  if (!(button instanceof HTMLButtonElement) || !(code instanceof HTMLElement) || !(label instanceof HTMLElement)) return;
  const idle = label.textContent ?? '';
  let timer = 0;
  button.addEventListener('click', async () => {
    let copied = false;
    try {
      await navigator.clipboard.writeText(code.textContent ?? '');
      copied = true;
    } catch {
      const range = document.createRange();
      range.selectNodeContents(code);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    button.dataset.state = copied ? 'copied' : 'selected';
    label.textContent = copied ? 'コピーしました' : '選択しました。Ctrl+Cでコピーできます';
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      delete button.dataset.state;
      label.textContent = idle;
    }, 2400);
  });
}

const refs = findRefs(document, objectUrl);
const store = createStore(initialSession({ xlsx: typeof CompressionStream === 'function' }), refs, workerUrl);
bindEvents(refs, store);
render(store.current(), refs);
setupEmbed();
setupCopy();
