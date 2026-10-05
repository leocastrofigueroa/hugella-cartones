// Real React DOM components, mocked RPCs only. No network or app server.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const testRequire = createRequire(path.join(process.env.HUGELLA_TEST_DEPS || process.cwd(), 'runner.cjs'));
const { JSDOM } = testRequire('jsdom');
const React = require('react'); const { act } = React; const ts = require('typescript');
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
globalThis.window = dom.window; globalThis.document = dom.window.document;
globalThis.FormData = dom.window.FormData; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = require('react-dom/client');
let rpcHandler = () => ({ data: [], error: null });
const client = { rpc(...args) { const result = Promise.resolve(rpcHandler(...args)); result.abortSignal = () => result; return result; } };
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const loadedModule = { exports: {} };
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  vm.runInNewContext(code, {
    module: loadedModule, exports: loadedModule.exports, FormData: dom.window.FormData, crypto: globalThis.crypto,
    window: dom.window, sessionStorage: dom.window.sessionStorage, AbortSignal, process,
    requestAnimationFrame: callback => setTimeout(callback, 0), cancelAnimationFrame: clearTimeout,
    require(name) {
      if (name === '@/utils/supabase/client' || name === '@supabase/supabase-js') return { createClient: () => client };
      if (name === 'next/navigation') return { useRouter: () => ({ push() {} }) };
      if (name === 'next/image') return { __esModule: true, default: props => React.createElement('img', { ...props, priority: undefined }) };
      if (name === 'next/link') return { __esModule: true, default: props => React.createElement('a', { ...props, prefetch: undefined }) };
      if (name.startsWith('.')) { const base = path.resolve(path.dirname(file), name); return load(base + '.ts'); }
      return require(name);
    },
  });
  cache.set(file, loadedModule.exports); return loadedModule.exports;
}
const Closure = load(fileURLToPath(new URL('../app/admin/credit-closure.tsx', import.meta.url))).default;
const PublicPage = load(fileURLToPath(new URL('../app/page.tsx', import.meta.url))).default;
let root = createRoot(document.getElementById('root'));
const credit = { credito_id: 'credito', codigo_credito: 'CR-1', estado: 'ATRASADO' };
const calls = []; let resolve;
const onClose = (...args) => { calls.push(args); return new Promise(done => { resolve = done; }); };
const field = name => document.querySelector(`[name="${name}"]`);
const submit = () => document.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
try {
  await act(async () => root.render(React.createElement(Closure, { credit, disabled: false, onClose })));
  await act(async () => submit()); assert.equal(calls.length, 0);
  field('motivo').value = '  Devolución voluntaria  '; field('fecha').value = '2026-09-30'; field('confirmacion').checked = true;
  await act(async () => { submit(); submit(); }); assert.equal(calls.length, 1);
  assert.equal(calls[0][0].p_tipo, 'DEVUELTO'); assert.equal(calls[0][0].p_motivo, 'Devolución voluntaria');
  assert.equal(document.querySelector('fieldset').disabled, true);
  await act(async () => resolve('Respuesta perdida'));
  await act(async () => submit()); assert.equal(calls[1][1], calls[0][1], 'Retry keeps operation UUID');
  await act(async () => resolve('Datos inválidos'));
  field('tipo').value = 'RETIRADO';
  await act(async () => submit()); assert.equal(calls[2][0].p_tipo, 'RETIRADO'); assert.notEqual(calls[2][1], calls[0][1]);
  await act(async () => resolve(null));
  rpcHandler = name => { assert.equal(name, 'obtener_cierre_credito_admin'); return { data: [{ fecha: '2026-09-30', motivo: 'Recuperación', observaciones: 'Equipo recibido', actor_id: 'admin-auditable', created_at: '2026-10-01T10:00:00Z' }] }; };
  await act(async () => root.render(React.createElement(Closure, { credit: { ...credit, estado: 'RETIRADO' }, disabled: false, onClose })));
  assert.equal(document.querySelector('form'), null);
  assert.match(document.body.textContent, /admin-auditable/);
  assert.match(document.body.textContent, /Equipo recibido/);
  await act(async () => root.unmount()); root = createRoot(document.getElementById('root'));
  const active = { access_token: '00000000-0000-0000-0000-000000000001', codigo: 'ACTIVO', producto: 'Equipo activo', estado: 'AL DIA' };
  const closed = { ...active, access_token: '00000000-0000-0000-0000-000000000002', codigo: 'CERRADO' };
  window.sessionStorage.setItem('hugella.client-credits', JSON.stringify({ createdAt: Date.now(), credits: [active, closed] }));
  rpcHandler = (name, args) => { assert.equal(name, 'get_carton_publico'); return { data: args.p_token === active.access_token ? {} : null }; };
  await act(async () => root.render(React.createElement(PublicPage)));
  assert.match(document.body.textContent, /ACTIVO/); assert.doesNotMatch(document.body.textContent, /CERRADO/);
  rpcHandler = () => ({ data: null });
  await act(async () => window.dispatchEvent(new window.Event('focus')));
  assert.doesNotMatch(document.body.textContent, /Equipo activo/);
  assert.match(document.body.textContent, /no tenés créditos activos disponibles/);
  console.log('PASS: both closure types, explicit confirmation/reason, double-submit prevention, retry UUID, audit display, cached closed public credit removed, active sibling kept and empty-state message.');
} finally { await act(async () => root.unmount()); dom.window.close(); }
