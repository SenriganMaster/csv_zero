const scope = /** @type {Worker} */ (/** @type {unknown} */ (self));

scope.addEventListener('message', (event) => {
  if (event.data?.type === 'ping') {
    scope.postMessage({ type: 'pong' });
  }
});
