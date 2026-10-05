import { assembleFragmentLine, HOST_ID } from './fragment-contract.mjs';

/** One list. Browser code does not import this module. */
export const BANNED_SUBSTRINGS = [
  'eval(',
  'new Function',
  'Function(',
  'document.write',
  'document.cookie',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'fetch(',
  'XMLHttpRequest',
  'sendBeacon',
  'WebSocket',
];

/**
 * @typedef {Readonly<{ rule: string, detail: string }>} FragmentViolation
 */

const LINE_RE = new RegExp(
  `^<div id="${HOST_ID}">([^<]*)</div><script src="data:text/javascript;base64,([A-Za-z0-9+/=]+)"></script>$`,
);

/**
 * @param {string} line
 * @returns {readonly FragmentViolation[]}
 */
export function auditFragment(line) {
  /** @type {FragmentViolation[]} */
  const violations = [];
  /** @param {string} rule @param {string} detail */
  const add = (rule, detail) => {
    if (!violations.some((item) => item.rule === rule && item.detail === detail)) {
      violations.push({ rule, detail });
    }
  };

  if (line.includes('\n') || line.includes('\r')) add('newline', 'fragment contains a newline');
  if (line.includes('&')) add('ampersand', '&');
  if (line.includes('[') || line.includes(']')) add('brackets', '[]');
  for (const char of line) {
    const code = char.codePointAt(0) ?? 0;
    if (code > 0xffff) add('non-bmp', `U+${code.toString(16).toUpperCase()}`);
  }
  if (/\p{Extended_Pictographic}/u.test(line)) add('emoji', 'emoji');
  if (line.includes('<!--')) add('comment', '<!--');
  if (/<style\b/i.test(line)) add('style-tag', 'style');
  if (/on\w+=/i.test(line)) add('event-handler', 'on*=');

  const scripts = line.match(/<script\b/gi) ?? [];
  if (scripts.length !== 1) add('script-count', String(scripts.length));

  const matched = LINE_RE.exec(line);
  if (!matched) {
    add('script-shape', 'expected one data-url script and a plain fallback');
    return violations;
  }
  const fallback = matched[1] ?? '';
  const base64 = matched[2] ?? '';
  if (fallback.length === 0) add('script-shape', 'empty fallback');
  if (!/^[A-Za-z0-9+/=]+$/.test(base64)) add('base64-alphabet', 'alphabet');

  let decoded = '';
  try {
    decoded = Buffer.from(base64, 'base64').toString('utf8');
  } catch (error) {
    add('base64-roundtrip', error instanceof Error ? error.message : 'decode');
    return violations;
  }
  if (Buffer.from(decoded, 'utf8').toString('base64') !== base64) add('base64-roundtrip', 'roundtrip');
  if ([...decoded].some((char) => (char.codePointAt(0) ?? 0) > 127)) add('ascii', 'decoded script is not ASCII');
  for (const token of BANNED_SUBSTRINGS) {
    if (decoded.includes(token)) add('banned', token);
  }
  return violations;
}

export { assembleFragmentLine, HOST_ID };
