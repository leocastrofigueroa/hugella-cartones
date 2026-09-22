// Real React DOM with an isolated local DOM. No app server or Supabase calls.
// HUGELLA_TEST_DEPS=/tmp/hugella-local-checks/node_modules node scripts/test-payment-correction-ui.mjs
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const testRequire = createRequire(path.join(process.env.HUGELLA_TEST_DEPS || process.cwd(), 'runner.cjs'));
const { JSDOM } = testRequire('jsdom');
const React = require('react');
const { act } = React;
const ts = require('typescript');
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.FormData = dom.window.FormData;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = require('react-dom/client');

function load(file) {
  const compiledModule = { exports: {} };
  const compiled = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(compiled, {
    module: compiledModule, exports: compiledModule.exports, FormData: dom.window.FormData, crypto: globalThis.crypto,
    require: name => name === './admin-types' ? load(new URL('../app/admin/admin-types.ts', import.meta.url)) : require(name),
  });
  return compiledModule.exports;
}
const PaymentHistory = load(new URL('../app/admin/payment-history.tsx', import.meta.url)).default;
const payment = {
  pago_id: '11111111-1111-1111-1111-111111111111', fecha_pago: '2026-09-10', importe: '5000', medio_pago: 'Efectivo',
  observaciones: 'Original', created_at: '2026-09-10T12:00:00Z', estado: 'VALIDO', origen: 'ADMIN',
  cuotas_aplicadas: 1, remanente: 0, motivo_anulacion: null, anulado_at: null, reemplaza_pago_id: null,
};
const calls = [];
let finish;
const onCorrect = (...args) => {
  calls.push(args);
  return new Promise(resolve => { finish = resolve; });
};
const root = createRoot(document.getElementById('root'));
const render = async (payments = [payment], disabled = false) => act(async () => {
  root.render(React.createElement(PaymentHistory, { status: 'success', payments, disabled, error: '', onCorrect, onAnnul: async () => null }));
});
const button = text => [...document.querySelectorAll('button')].find(element => element.textContent === text);
const click = async element => act(async () => element.click());
const submit = () => document.querySelector('[aria-labelledby="correction-title"] form')
  .dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
const field = name => document.querySelector(`[name="${name}"]`);
try {
  await render();
  await click(button('Corregir'));
  assert.equal(field('amount').value, '5000');
  assert.equal(field('date').value, '2026-09-10');
  assert.equal(field('method').value, 'Efectivo');
  assert.equal(field('notes').value, 'Original');
  assert.equal(field('reason').value, '');
  assert.equal(document.querySelectorAll('[name="credito_id"], [name="cliente_id"]').length, 0);
  await act(async () => submit());
  assert.equal(calls.length, 0, 'Reason required');
  field('amount').value = '7500';
  field('date').value = '2026-09-11';
  field('method').value = 'Transferencia';
  field('notes').value = '  Corregido  ';
  field('reason').value = '  Error de carga  ';
  await act(async () => { submit(); submit(); });
  assert.equal(calls.length, 1, 'Synchronous guard prevents double submit');
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0][1])), {
    p_importe: 7500, p_fecha_pago: '2026-09-11', p_medio_pago: 'Transferencia',
    p_observaciones: 'Corregido', p_motivo: 'Error de carga',
  });
  assert.equal(document.querySelector('[aria-labelledby="correction-title"] fieldset').disabled, true);
  await act(async () => finish('Respuesta perdida; reintentá'));
  assert.ok(document.querySelector('[role="dialog"]'));
  await act(async () => submit());
  assert.equal(calls[1][2], calls[0][2], 'Same payload reuses operation UUID');
  await act(async () => finish('Error de validación'));
  field('amount').value = '8000';
  await act(async () => submit());
  assert.notEqual(calls[2][2], calls[1][2], 'Changed payload uses new UUID');
  await act(async () => finish(null));
  assert.equal(document.querySelector('[role="dialog"]'), null, 'Success closes modal');
  const original = { ...payment, estado: 'ANULADO', motivo_anulacion: 'Error de carga', anulado_at: '2026-09-22T12:00:00Z' };
  const replacement = { ...payment, pago_id: '22222222-2222-2222-2222-222222222222', reemplaza_pago_id: payment.pago_id };
  await render([original, replacement]);
  assert.equal([...document.querySelectorAll('button')].filter(element => element.textContent === 'Corregir').length, 1);
  assert.ok(document.body.textContent.includes('Reemplazado por:'));
  assert.ok(document.body.textContent.includes('Reemplaza al pago anterior:'));
  for (const link of document.querySelectorAll('a[href^="#payment-"]')) assert.ok(document.getElementById(link.hash.slice(1)));
  await render([original, replacement], true);
  assert.equal(button('Corregir').disabled, true);
  console.log('PASS: prefilled modal, required reason, fields, double-click prevention, retry UUID, success close, replacement links and valid-only actions.');
} finally {
  await act(async () => root.unmount());
  dom.window.close();
}
