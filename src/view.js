/** Writes the DOM from a Session. Its only state is the identity of the inputs behind the last table it built. */

import { autoNumber, classify, columnName, planSheet } from './core/excel.js';
import { describe, RISK_LABELS, encodingLabel, delimiterLabel, formatCount, formatBytes } from './core/messages.js';

/** @import { Session, Stage } from './core/session.js' */
/** @import { Analysis, Source, OutputFile } from './core/convert.js' */
/** @import { AppError } from './core/messages.js' */
/** @import { RiskCounts, RiskKind, SheetPlan } from './core/excel.js' */
/** @import { EncodingVerdict } from './core/text.js' */

const PREVIEW_ROWS = 100;
/** PREVIEW.fields and PREVIEW.chars in core/convert.js, which stays out of the main bundle. */
const PREVIEW_COLS = 200;
const PREVIEW_CHARS = 1000;

const RISK_KINDS = /** @type {RiskKind[]} */ (Object.keys(RISK_LABELS));
const MODE_TITLE = '自動: 先頭に0が付いていない普通の数値だけを数値として保存します。0001 のような値は文字列のまま残ります。';

/**
 * Elements looked up once at boot, plus objectUrl(), which main.js owns so one object URL lives at a time.
 * @typedef {object} Refs
 * @property {HTMLElement} tool
 * @property {HTMLElement} card
 * @property {HTMLElement} notice
 * @property {HTMLElement} intake
 * @property {HTMLButtonElement} fileTab
 * @property {HTMLButtonElement} pasteTab
 * @property {HTMLElement} filePanel
 * @property {HTMLElement} pastePanel
 * @property {HTMLButtonElement} dropzone
 * @property {HTMLInputElement} fileInput
 * @property {HTMLTextAreaElement} pasteInput
 * @property {HTMLButtonElement} pasteSubmit
 * @property {HTMLElement} result
 * @property {HTMLElement} fileName
 * @property {HTMLElement} stats
 * @property {Record<'encoding' | 'delimiter' | 'rows' | 'cols' | 'size', HTMLElement>} stat
 * @property {HTMLButtonElement} reset
 * @property {HTMLElement} readProgress
 * @property {HTMLElement} readLabel
 * @property {HTMLElement} readPct
 * @property {HTMLElement} readBar
 * @property {HTMLElement} settings
 * @property {HTMLSelectElement} encoding
 * @property {HTMLSelectElement} delimiter
 * @property {HTMLInputElement} header
 * @property {HTMLElement} overview
 * @property {HTMLElement} risk
 * @property {HTMLElement} riskSummary
 * @property {HTMLElement} chips
 * @property {HTMLElement} riskFoot
 * @property {HTMLButtonElement} downloadXlsx
 * @property {HTMLButtonElement} downloadCsv
 * @property {HTMLElement} blocker
 * @property {HTMLElement} writeProgress
 * @property {HTMLElement} writeLabel
 * @property {HTMLElement} writePct
 * @property {HTMLElement} writeBar
 * @property {HTMLButtonElement} writeCancel
 * @property {HTMLElement} saved
 * @property {HTMLElement} savedName
 * @property {HTMLAnchorElement} saveLink
 * @property {HTMLElement} warnings
 * @property {HTMLElement} preview
 * @property {HTMLElement} previewNote
 * @property {HTMLTableElement} table
 * @property {HTMLElement} status
 * @property {(file: OutputFile) => string} objectUrl
 */

/**
 * @template {Element} T
 * @param {ParentNode} root
 * @param {string} selector
 * @param {{ new (): T, prototype: T }} type
 * @returns {T}
 */
function one(root, selector, type) {
  const element = root.querySelector(selector);
  if (!(element instanceof type)) throw new Error(`index.html is missing ${selector}`);
  return element;
}

/**
 * @param {ParentNode} root
 * @param {(file: OutputFile) => string} objectUrl
 * @returns {Refs}
 */
export function findRefs(root, objectUrl) {
  /** @param {string} id */
  const test = (id) => `[data-testid="${id}"]`;
  /** @param {string} name */
  const ref = (name) => `[data-ref="${name}"]`;
  const stats = one(root, test('stats'), HTMLElement);
  /** @param {string} name */
  const stat = (name) => one(stats, `[data-stat="${name}"]`, HTMLElement);
  return {
    tool: one(root, test('tool'), HTMLElement),
    card: one(root, ref('card'), HTMLElement),
    notice: one(root, test('notice'), HTMLElement),
    intake: one(root, ref('intake'), HTMLElement),
    fileTab: one(root, ref('file-tab'), HTMLButtonElement),
    pasteTab: one(root, test('paste-tab'), HTMLButtonElement),
    filePanel: one(root, '#panel-file', HTMLElement),
    pastePanel: one(root, '#panel-paste', HTMLElement),
    dropzone: one(root, test('dropzone'), HTMLButtonElement),
    fileInput: one(root, test('file-input'), HTMLInputElement),
    pasteInput: one(root, test('paste-input'), HTMLTextAreaElement),
    pasteSubmit: one(root, test('paste-submit'), HTMLButtonElement),
    result: one(root, ref('result'), HTMLElement),
    fileName: one(root, ref('file-name'), HTMLElement),
    stats,
    stat: { encoding: stat('encoding'), delimiter: stat('delimiter'), rows: stat('rows'), cols: stat('cols'), size: stat('size') },
    reset: one(root, test('reset'), HTMLButtonElement),
    readProgress: one(root, ref('read-progress'), HTMLElement),
    readLabel: one(root, ref('read-label'), HTMLElement),
    readPct: one(root, ref('read-pct'), HTMLElement),
    readBar: one(root, ref('read-bar'), HTMLElement),
    settings: one(root, ref('settings'), HTMLElement),
    encoding: one(root, test('encoding'), HTMLSelectElement),
    delimiter: one(root, test('delimiter'), HTMLSelectElement),
    header: one(root, test('header'), HTMLInputElement),
    overview: one(root, ref('overview'), HTMLElement),
    risk: one(root, ref('risk'), HTMLElement),
    riskSummary: one(root, test('risk-summary'), HTMLElement),
    chips: one(root, ref('chips'), HTMLElement),
    riskFoot: one(root, ref('risk-foot'), HTMLElement),
    downloadXlsx: one(root, test('download-xlsx'), HTMLButtonElement),
    downloadCsv: one(root, test('download-csv'), HTMLButtonElement),
    blocker: one(root, ref('blocker'), HTMLElement),
    writeProgress: one(root, ref('write-progress'), HTMLElement),
    writeLabel: one(root, ref('write-label'), HTMLElement),
    writePct: one(root, ref('write-pct'), HTMLElement),
    writeBar: one(root, ref('write-bar'), HTMLElement),
    writeCancel: one(root, ref('write-cancel'), HTMLButtonElement),
    saved: one(root, ref('saved'), HTMLElement),
    savedName: one(root, ref('saved-name'), HTMLElement),
    saveLink: one(root, test('save-link'), HTMLAnchorElement),
    warnings: one(root, test('warnings'), HTMLElement),
    preview: one(root, ref('preview'), HTMLElement),
    previewNote: one(root, ref('preview-note'), HTMLElement),
    table: one(root, test('preview'), HTMLTableElement),
    status: one(root, ref('status'), HTMLElement),
    objectUrl,
  };
}

/**
 * The table on screen: the records and options it was built from, and its per-column elements.
 * @typedef {{ records: string[][], header: boolean, cols: number, modes: HTMLButtonElement[], badges: HTMLElement[], columns: HTMLTableColElement[] }} BuiltTable
 */

/** @type {BuiltTable | null} */
let built = null;
/** @type {readonly number[] | null} */
let shownModes = null;
/** @type {SheetPlan | null} */
let shownPlan = null;
/** @type {{ analysis: Analysis, header: boolean, autoColumns: readonly number[], plan: SheetPlan } | null} */
let planned = null;
/**
 * The source of the last ready stage. A reading stage for the same source is a re-read; a new one takes focus when ready.
 * @type {Source | null}
 */
let readySource = null;
/** @type {Analysis | null} */
let announcedAnalysis = null;
/** @type {'reading' | 'writing' | null} */
let holding = null;

/** @param {Stage} stage */
function transientOf(stage) {
  if (stage.kind === 'reading') return 'reading';
  if (stage.kind === 'ready' && stage.output.kind === 'writing') return 'writing';
  return null;
}

/**
 * Reading and writing keep the card at least as tall as the state they started from, so the page below,
 * or the page embedding this one, does not jump while they run.
 * @param {HTMLElement} card
 * @param {'reading' | 'writing' | null} next
 */
function holdHeight(card, next) {
  if (next === holding) return;
  if (next === null) card.style.removeProperty('min-height');
  else if (holding === null) card.style.setProperty('min-height', `${card.getBoundingClientRect().height}px`);
  card.classList.toggle('is-held', next !== null);
  holding = next;
}

/**
 * Cells use textContent, never markup, because file content is untrusted. classify() tints risky data cells.
 * Each column header shows its letter, its header text, its risk count, and the 文字列 / 自動 toggle.
 * @param {Session} session
 * @param {Refs} refs
 */
export function render(session, refs) {
  const { stage } = session;
  holdHeight(refs.card, transientOf(stage));
  refs.tool.dataset.phase = stage.kind;
  if (stage.kind === 'ready') refs.tool.dataset.output = stage.output.kind;
  else delete refs.tool.dataset.output;

  renderNotice(refs, noticeOf(stage));
  refs.intake.hidden = stage.kind !== 'empty';
  refs.result.hidden = stage.kind === 'empty';

  if (stage.kind === 'empty') {
    if (built) refs.table.replaceChildren();
    built = null;
    shownModes = null;
    shownPlan = null;
    planned = null;
    readySource = null;
    announcedAnalysis = null;
    announce(refs, '');
    return;
  }

  const reading = stage.kind === 'reading';
  const shown = stage.kind === 'ready' ? stage.analysis : stage.preview;
  const reread = reading && stage.source === readySource;
  setText(refs.fileName, stage.source.name);
  setText(refs.reset, reading ? 'キャンセル' : '別のファイルにする');
  refs.result.classList.toggle('is-reading', reading);
  refs.result.classList.toggle('is-pending', reading && shown === null);

  refs.readProgress.hidden = !reading;
  if (stage.kind === 'reading') {
    setText(refs.readLabel, reread ? '読み直しています' : '読み込んでいます');
    setProgress(refs.readBar, refs.readPct, stage.progress);
    announce(refs, reread ? '読み直しています' : `${stage.source.name}を読み込んでいます`);
    refs.downloadXlsx.disabled = true;
    refs.downloadCsv.disabled = true;
  }

  refs.settings.hidden = shown === null;
  refs.encoding.value = stage.choice.encoding;
  refs.delimiter.value = stage.choice.delimiter;
  refs.encoding.disabled = stage.source.kind === 'paste';
  refs.encoding.title = stage.source.kind === 'paste' ? '貼り付けたテキストは文字コードを選ぶ必要がありません' : '';
  refs.header.checked = session.header;

  const showFacts = stage.kind === 'ready' || reread;
  refs.stats.hidden = !showFacts;
  refs.overview.hidden = !showFacts;
  refs.previewNote.hidden = !showFacts;
  if (!showFacts) refs.warnings.hidden = true;

  refs.preview.hidden = shown === null;
  if (shown !== null) {
    const cols = stage.kind === 'ready'
      ? Math.min(stage.analysis.cols, PREVIEW_COLS)
      : built?.records === shown.records ? built.cols : widest(shown.records);
    if (!built || built.records !== shown.records || built.header !== session.header || built.cols !== cols) {
      built = buildTable(refs.table, shown.records, session.header, cols);
      shownModes = null;
      shownPlan = null;
    }
  }

  if (stage.kind !== 'ready') return;

  const plan = planFor(stage.analysis, session.header, stage.autoColumns);
  if (shownPlan !== plan) {
    shownPlan = plan;
    renderStats(refs, stage.analysis, stage.source);
    renderRisk(refs, plan);
    renderWarnings(refs, plan.warnings);
    renderColumnRisks(plan);
    renderPreviewNote(refs, stage.analysis, session.header);
  }
  if (shownModes !== stage.autoColumns) {
    shownModes = stage.autoColumns;
    renderModes(refs.table, stage.autoColumns);
  }
  renderOutput(refs, session, stage, plan);

  if (announcedAnalysis !== stage.analysis) {
    announcedAnalysis = stage.analysis;
    announce(refs, `読み込みが終わりました。${formatCount(stage.analysis.rows)}行、${formatCount(stage.analysis.cols)}列です。${refs.riskSummary.textContent}`);
  }
  if (stage.source !== readySource) {
    readySource = stage.source;
    (refs.downloadXlsx.disabled ? refs.downloadCsv : refs.downloadXlsx).focus();
  }
}

/** Shows one input method and hides the other. The choice is not part of the session. @param {Refs} refs @param {'file' | 'paste'} tab */
export function selectTab(refs, tab) {
  const paste = tab === 'paste';
  refs.fileTab.setAttribute('aria-selected', String(!paste));
  refs.pasteTab.setAttribute('aria-selected', String(paste));
  refs.fileTab.tabIndex = paste ? -1 : 0;
  refs.pasteTab.tabIndex = paste ? 0 : -1;
  refs.filePanel.hidden = paste;
  refs.pastePanel.hidden = !paste;
}

/** The drop highlight while a file is dragged over the tool. @param {Refs} refs @param {boolean} on */
export function showDrag(refs, on) {
  if (on) refs.tool.dataset.drag = '1';
  else delete refs.tool.dataset.drag;
}

/** @param {Stage} stage @returns {AppError | null} */
function noticeOf(stage) {
  if (stage.kind === 'empty') return stage.notice;
  if (stage.kind === 'ready' && stage.output.kind === 'failed') return stage.output.error;
  return null;
}

/** @param {Refs} refs @param {AppError | null} error */
function renderNotice(refs, error) {
  refs.notice.hidden = error === null;
  setText(refs.notice, error === null ? '' : describe(error));
}

/** @param {Analysis} analysis @param {boolean} header @param {readonly number[]} autoColumns @returns {SheetPlan} */
function planFor(analysis, header, autoColumns) {
  if (!planned || planned.analysis !== analysis || planned.header !== header || planned.autoColumns !== autoColumns) {
    planned = { analysis, header, autoColumns, plan: planSheet(analysis, { header, autoColumns }) };
  }
  return planned.plan;
}

/** @param {Refs} refs @param {Analysis} analysis @param {Source} source */
function renderStats(refs, analysis, source) {
  const { encoding, delimiter } = analysis.settings;
  /** @type {EncodingVerdict} */
  const verdict = analysis.detected.encoding.encoding === encoding
    ? analysis.detected.encoding
    : { encoding, bom: false, asciiOnly: false };
  setText(refs.stat.encoding, encodingLabel(verdict));
  setText(refs.stat.delimiter, delimiterLabel(delimiter));
  setText(refs.stat.rows, formatCount(analysis.rows));
  setText(refs.stat.cols, formatCount(analysis.cols));
  setText(refs.stat.size, formatBytes(source.blob.size));
}

/** @param {Refs} refs @param {SheetPlan} plan */
function renderRisk(refs, plan) {
  const kinds = RISK_KINDS.filter((kind) => plan.risks[kind] > 0)
    .sort((a, b) => plan.risks[b] - plan.risks[a]);
  const safe = kinds.length === 0;
  refs.risk.classList.toggle('is-safe', safe);
  if (safe) {
    setText(refs.riskSummary, 'Excelで直接開いても崩れる値は見つかりませんでした');
  } else {
    const count = document.createElement('strong');
    count.textContent = `${formatCount(plan.riskTotal)}件`;
    refs.riskSummary.replaceChildren('Excelで直接開くと崩れる値: ', count);
  }
  refs.riskFoot.hidden = safe;
  refs.chips.hidden = safe;
  refs.chips.replaceChildren(...kinds.map((kind) => {
    const { short, label, example } = RISK_LABELS[kind];
    const chip = document.createElement('li');
    chip.className = 'chip';
    chip.append(
      span('chip-short', short),
      span('chip-count', `${formatCount(plan.risks[kind])}件`),
      span('chip-label', label),
      span('chip-example', example),
    );
    return chip;
  }));
}

/** @param {Refs} refs @param {AppError[]} warnings */
function renderWarnings(refs, warnings) {
  refs.warnings.hidden = warnings.length === 0;
  refs.warnings.replaceChildren(...warnings.map((warning) => {
    const item = document.createElement('li');
    item.className = warning.code === 'SINGLE_COLUMN' ? 'warning is-info' : 'warning';
    item.textContent = describe(warning);
    return item;
  }));
}

/** @param {Refs} refs @param {Analysis} analysis @param {boolean} header */
function renderPreviewNote(refs, analysis, header) {
  const dataRows = Math.max(0, analysis.rows - (header ? 1 : 0));
  const shownRows = Math.min(PREVIEW_ROWS, Math.max(0, analysis.records.length - (header ? 1 : 0)), dataRows);
  const parts = [shownRows < dataRows
    ? `先頭の${formatCount(shownRows)}行を表示（データは全${formatCount(dataRows)}行）`
    : `データ${formatCount(dataRows)}行をすべて表示`];
  if (analysis.cols > PREVIEW_COLS) parts.push(`先頭の${formatCount(PREVIEW_COLS)}列まで（全${formatCount(analysis.cols)}列）`);
  setText(refs.previewNote, parts.join('・'));
}

/**
 * @param {Refs} refs
 * @param {Session} session
 * @param {Extract<Stage, { kind: 'ready' }>} stage
 * @param {SheetPlan} plan
 */
function renderOutput(refs, session, stage, plan) {
  const { output } = stage;
  /** @type {AppError[]} */
  const blockers = session.env.xlsx ? plan.blockers : [{ code: 'XLSX_UNSUPPORTED' }, ...plan.blockers];
  const writing = output.kind === 'writing';
  refs.downloadXlsx.disabled = writing || blockers.length > 0;
  refs.downloadCsv.disabled = writing;
  refs.blocker.hidden = blockers.length === 0;
  setText(refs.blocker, blockers.map(describe).join('\n'));

  refs.writeProgress.hidden = !writing;
  if (output.kind === 'writing') {
    setText(refs.writeLabel, output.format === 'xlsx' ? 'Excel用ファイルを作成しています' : 'CSVを作成しています');
    setProgress(refs.writeBar, refs.writePct, output.progress);
    announce(refs, output.format === 'xlsx' ? 'Excel用ファイルを作成しています' : 'CSVを作成しています');
  }

  refs.saved.hidden = output.kind !== 'written';
  if (output.kind === 'written') {
    setText(refs.savedName, `${output.file.name} を作成しました`);
    const url = refs.objectUrl(output.file);
    if (refs.saveLink.href !== url) refs.saveLink.href = url;
    refs.saveLink.download = output.file.name;
    announce(refs, `${output.file.name} を作成しました`);
  } else if (refs.saveLink.hasAttribute('href')) {
    refs.saveLink.removeAttribute('href');
  }
}

/**
 * @param {HTMLTableElement} table
 * @param {string[][]} records
 * @param {boolean} header
 * @param {number} cols
 * @returns {BuiltTable}
 */
function buildTable(table, records, header, cols) {
  const colgroup = document.createElement('colgroup');
  colgroup.append(document.createElement('col'));
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  const corner = document.createElement('th');
  corner.className = 'corner';
  corner.scope = 'col';
  corner.append(span('sr-only', '行番号'));
  headRow.append(corner);

  const names = header ? records[0] ?? [] : [];
  /** @type {HTMLButtonElement[]} */
  const modes = [];
  /** @type {HTMLElement[]} */
  const badges = [];
  /** @type {HTMLTableColElement[]} */
  const columns = [];
  for (let col = 0; col < cols; col++) {
    const letter = columnName(col);
    const column = document.createElement('col');
    colgroup.append(column);
    columns.push(column);

    const th = document.createElement('th');
    th.scope = 'col';
    const top = document.createElement('div');
    top.className = 'col-top';
    const badge = span('col-risk', '');
    badge.hidden = true;
    const mode = document.createElement('button');
    mode.type = 'button';
    mode.className = 'mode';
    mode.dataset.testid = `col-mode-${col}`;
    mode.dataset.col = String(col);
    mode.setAttribute('aria-pressed', 'false');
    mode.setAttribute('aria-label', `${letter}列を自動にする`);
    mode.title = MODE_TITLE;
    mode.append(span('mode-text', '文字列'), span('mode-auto', '自動'));
    top.append(span('col-letter', letter), badge, mode);
    th.append(top);
    if (header) {
      const name = names[col] ?? '';
      const nameEl = span('col-name', name);
      if (name.length > 16) nameEl.title = name;
      th.append(nameEl);
    }
    headRow.append(th);
    modes.push(mode);
    badges.push(badge);
  }
  thead.append(headRow);

  const tbody = document.createElement('tbody');
  const first = header ? 1 : 0;
  const last = Math.min(records.length, first + PREVIEW_ROWS);
  for (let row = first; row < last; row++) {
    const tr = document.createElement('tr');
    const rowHead = document.createElement('th');
    rowHead.scope = 'row';
    rowHead.textContent = String(row + 1);
    tr.append(rowHead);
    const record = records[row];
    for (let col = 0; col < cols; col++) {
      const td = document.createElement('td');
      const text = record[col];
      if (text) {
        const cut = text.length > PREVIEW_CHARS;
        td.textContent = cut ? text.slice(0, PREVIEW_CHARS) : text;
        const kind = classify(text);
        const notes = [];
        if (kind !== null) {
          td.classList.add('is-risk');
          notes.push(`Excelで直接開くと: ${RISK_LABELS[kind].label}`);
        }
        if (cut) {
          td.classList.add('is-cut');
          notes.push(`長い値のため、先頭の${formatCount(PREVIEW_CHARS)}文字だけを表示しています`);
        }
        if (notes.length > 0) td.title = notes.join('\n');
      }
      tr.append(td);
    }
    tbody.append(tr);
  }
  if (last <= first) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.className = 'grid-empty';
    td.colSpan = cols + 1;
    td.textContent = '見出しの行だけで、データの行はありません。';
    tr.append(td);
    tbody.append(tr);
  }
  table.replaceChildren(colgroup, thead, tbody);
  return { records, header, cols, modes, badges, columns };
}

/** Marks 自動 columns, and right-aligns the cells that would be saved as numbers. @param {HTMLTableElement} table @param {readonly number[]} autoColumns */
function renderModes(table, autoColumns) {
  if (!built) return;
  const auto = new Set(autoColumns);
  const rows = table.tBodies[0]?.rows ?? [];
  for (let col = 0; col < built.modes.length; col++) {
    const on = auto.has(col);
    const mode = built.modes[col];
    if (mode.getAttribute('aria-pressed') === String(on)) continue;
    mode.setAttribute('aria-pressed', String(on));
    built.columns[col].classList.toggle('is-auto', on);
    mode.closest('th')?.classList.toggle('is-auto', on);
    for (const row of rows) {
      const cell = row.cells[col + 1];
      if (cell) cell.classList.toggle('num', on && autoNumber(cell.textContent ?? '') !== null);
    }
  }
}

/** @param {SheetPlan} plan */
function renderColumnRisks(plan) {
  if (!built) return;
  for (let col = 0; col < built.badges.length; col++) {
    const risks = plan.columns[col]?.risks;
    const count = risks ? total(risks) : 0;
    const badge = built.badges[col];
    badge.hidden = count === 0;
    badge.textContent = formatCount(count);
    badge.title = `Excelで直接開くと崩れる値: ${formatCount(count)}件`;
  }
}

/** @param {RiskCounts} risks @returns {number} */
function total(risks) {
  let sum = 0;
  for (const kind of RISK_KINDS) sum += risks[kind];
  return sum;
}

/** @param {string[][]} records @returns {number} */
function widest(records) {
  let cols = 0;
  for (const record of records) cols = Math.max(cols, record.length);
  return Math.min(cols, PREVIEW_COLS);
}

/** @param {HTMLElement} bar @param {HTMLElement} label @param {number} ratio */
function setProgress(bar, label, ratio) {
  const clamped = Math.min(1, Math.max(0, ratio));
  const percent = Math.floor(clamped * 100);
  bar.style.setProperty('--progress', String(clamped));
  bar.setAttribute('aria-valuenow', String(percent));
  setText(label, `${percent}%`);
}

/** @param {Refs} refs @param {string} text */
function announce(refs, text) {
  setText(refs.status, text);
}

/** @param {HTMLElement} element @param {string} text */
function setText(element, text) {
  if (element.textContent !== text) element.textContent = text;
}

/** @param {string} className @param {string} text @returns {HTMLSpanElement} */
function span(className, text) {
  const element = document.createElement('span');
  element.className = className;
  element.textContent = text;
  return element;
}
