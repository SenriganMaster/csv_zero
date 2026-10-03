const current = document.currentScript;
if (!(current instanceof HTMLScriptElement)) {
  throw new Error('main bundle must be a classic script');
}

const worker = new Worker(new URL(__WORKER_FILE__, current.src));
worker.addEventListener('message', (event) => {
  if (event.data?.type === 'pong') {
    document.body.dataset.workerReady = '1';
  }
});
worker.postMessage({ type: 'ping' });
