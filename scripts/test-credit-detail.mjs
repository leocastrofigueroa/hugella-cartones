// Render the actual component locally; no network, browser server or RPC mocks.
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { JSDOM } = require('jsdom');
const ts = require('typescript');
function load(file) {
  const loadedModule = { exports: {} };
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  vm.runInNewContext(code, { module: loadedModule, exports: loadedModule.exports, require(name) {
    if (!name.startsWith('.')) return require(name);
    const base = path.resolve(path.dirname(file), name);
    return load(base + (existsSync(base + '.tsx') ? '.tsx' : '.ts'));
  } });
  return loadedModule.exports;
}
const CreditDetail = load(path.resolve('app/admin/credit-detail.tsx')).default;
const credit = { credito_id: '1', nombre_cliente: 'Cliente', codigo_credito: 'CR-1', producto: 'Producto',
  importe_cuota: 100, cantidad_cuotas: 30, cuotas_pagadas: 10, cuotas_pendientes: 20 };
for (const [estado, diferencia_cuotas, label, value] of [
  ['ATRASADO', -7, 'Cuotas atrasadas', '7'],
  ['ADELANTADO', 3, 'Cuotas adelantadas', '3'],
  ['AL DIA', 0, 'Estado de cuotas', 'AL DÍA'],
  ['CANCELADO', 8], ['DEVUELTO', -7], ['RETIRADO', 3],
  ['ATRASADO', undefined],
]) {
  const dom = new JSDOM(renderToStaticMarkup(React.createElement(CreditDetail, { credit: { ...credit, estado, diferencia_cuotas } })));
  const document = dom.window.document;
  const labels = [...document.querySelectorAll('dt')];
  const block = labels.find(item => ['Cuotas atrasadas', 'Cuotas adelantadas', 'Estado de cuotas'].includes(item.textContent));
  if (label) {
    assert.equal(block?.textContent, label);
    assert.equal(block.nextElementSibling.textContent, value);
    assert.ok(block.parentElement.classList.contains('col-start-2'), 'Same grid column as paid installments');
    assert.equal(block.parentElement.previousElementSibling.querySelector('dt').textContent, 'Cuotas pendientes de cobro');
    assert.equal(block.parentElement.previousElementSibling.classList.contains('col-span-2'), false, 'Pending installments occupy the left cell');
    assert.deepEqual(labels.slice(2).map(item => item.textContent), ['Cuotas totales', 'Cuotas pagadas', 'Cuotas pendientes de cobro', label]);
  } else {
    assert.equal(block, undefined, 'Closed states and old RPC responses show no misleading number');
    assert.ok(labels.find(item => item.textContent === 'Cuotas pendientes de cobro').parentElement.classList.contains('col-span-2'));
  }
  assert.equal(labels.find(item => item.textContent === 'Cuotas pagadas').nextElementSibling.textContent, '10');
  dom.window.close();
}
console.log('PASS: CreditDetail renders backend difference for ATRASADO/ADELANTADO, AL DÍA without number, hides block for CANCELADO/DEVUELTO/RETIRADO and missing data, 2x2 installment layout with pending installments beside status.');
