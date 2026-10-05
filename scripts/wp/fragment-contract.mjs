export const HOST_ID = 'csv-zero-app';

/**
 * @param {string} fallback
 * @param {string} base64
 * @returns {string}
 */
export function assembleFragmentLine(fallback, base64) {
  return `<div id="${HOST_ID}">${fallback}</div><script src="data:text/javascript;base64,${base64}"></script>`;
}
