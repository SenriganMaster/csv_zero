/** A CP932 encoder for fixtures and tests, built by inverting the platform's WHATWG Shift_JIS decoder. */

const decoder = new TextDecoder('shift_jis');
const TRAILS = [...range(0x40, 0x7e), ...range(0x80, 0xfc)];
// WHATWG's encoder skips the NEC-selected IBM rows (ED, EE); their characters also sit in FA-FC, which Windows uses.
const NEC_SELECTED_IBM = new Set([0xed, 0xee]);

/** @type {Map<number, number[]>} */
const bytesFor = new Map();

for (let byte = 0; byte <= 0xff; byte++) learn([byte]);
const leads = [...range(0x81, 0x9f), ...range(0xe0, 0xfc)];
for (const lead of leads.filter((b) => !NEC_SELECTED_IBM.has(b))) for (const trail of TRAILS) learn([lead, trail]);
for (const lead of leads.filter((b) => NEC_SELECTED_IBM.has(b))) for (const trail of TRAILS) learn([lead, trail]);

/**
 * @param {string} text
 * @returns {Uint8Array}
 */
export function encodeShiftJis(text) {
  /** @type {number[]} */
  const out = [];
  for (const char of text) {
    const bytes = bytesFor.get(/** @type {number} */ (char.codePointAt(0)));
    if (!bytes) throw new Error(`not encodable in Shift_JIS: ${JSON.stringify(char)}`);
    out.push(...bytes);
  }
  return Uint8Array.from(out);
}

/** @param {number[]} bytes */
function learn(bytes) {
  const text = decoder.decode(Uint8Array.from(bytes));
  if (text.length !== 1 || text === '\uFFFD') return;
  const code = text.charCodeAt(0);
  if (!bytesFor.has(code)) bytesFor.set(code, bytes);
}

/** @param {number} from @param {number} to */
function* range(from, to) {
  for (let i = from; i <= to; i++) yield i;
}
