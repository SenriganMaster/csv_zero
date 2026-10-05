import { mount } from '../app.js';
import { HOST_ID, INNER_CLASS } from '../../scripts/wp/fragment-contract.mjs';

const current = document.currentScript;
const script = current instanceof HTMLScriptElement ? current : null;

let started = false;

function start() {
  if (started) return;
  started = true;
  const found = document.getElementById(HOST_ID);
  const host = found ?? document.createElement('div');
  if (!found) {
    host.id = HOST_ID;
    const parent = script?.parentNode;
    if (parent) parent.insertBefore(host, script);
    else document.body.append(host);
  }
  if (host.shadowRoot) return;
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = __SHADOW_CSS__;
  const inner = document.createElement('div');
  inner.className = INNER_CLASS;
  const template = document.createElement('template');
  template.innerHTML = __TOOL_MARKUP__;
  inner.append(template.content);
  shadow.append(style, inner);
  mount({ kind: 'shadow', shadow });
}

const deferred = script !== null && script.defer && document.readyState !== 'complete';
if (document.readyState === 'loading' || deferred) document.addEventListener('DOMContentLoaded', start, { once: true });
else start();
