import { mount } from '../app.js';
import { HOST_ID } from '../../scripts/wp/fragment-contract.mjs';

const current = document.currentScript;
if (!(current instanceof HTMLScriptElement)) throw new Error('csv-zero wp boot has no currentScript');
const script = current;

let started = false;

function start() {
  if (started) return;
  started = true;
  const found = document.getElementById(HOST_ID);
  const host = found ?? document.createElement('div');
  if (!found) {
    host.id = HOST_ID;
    if (script.parentNode) script.parentNode.insertBefore(host, script);
    else document.body.append(host);
  }
  if (host.shadowRoot) return;
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = __SHADOW_CSS__;
  const template = document.createElement('template');
  template.innerHTML = __TOOL_MARKUP__;
  shadow.append(style, template.content);
  mount({ kind: 'shadow', shadow });
}

const waitForParse = document.readyState === 'loading' || (script.defer && document.readyState !== 'complete');
if (waitForParse) document.addEventListener('DOMContentLoaded', start, { once: true });
else start();
