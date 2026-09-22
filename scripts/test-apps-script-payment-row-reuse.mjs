// Runs the real ADMIN publisher with local sheet/network mocks only.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('../Supabase.gs', import.meta.url), 'utf8');
const headers = ['Fecha', 'ID Crédito', 'Cliente', 'Mercadería', 'Importe cobrado',
  'Cuotas equivalentes', 'Medios de pago', 'Observaciones', 'ID PAGO'];
const manual = [0, 1, 4, 6, 7, 8];
const empty = () => ['', '', 'CLIENTE_ARRAY', 'PRODUCTO_ARRAY', '', 'CUOTAS_ARRAY', '', '', ''];
const full = id => ['FECHA', 'CR-1', 'CLIENTE_ARRAY', 'PRODUCTO_ARRAY', 100, 'CUOTAS_ARRAY', 'Efectivo', '', id];
const payment = n => ({ pago_id: `${String(n).padStart(8, '0')}-1234-0000-0000-000000000000`,
  fecha_pago: '2026-09-22', codigo_credito: 'CR-1', importe: 100, medio_pago: 'Transferencia', observaciones: 'Nuevo' });
const sheetId = p => 'ADM-' + p.pago_id.replaceAll('-', '').slice(0, 12).toUpperCase();

function run(initial, payments, { formulaCells = [], changeBeforeWrite = false } = {}) {
  const rows = [headers.slice(), ...initial.map(row => row.slice())];
  const formulas = rows.map(() => Array(9).fill(''));
  for (let row = 1; row < rows.length; row++) for (const col of [2, 3, 5]) formulas[row][col] = '=ARRAYFORMULA(...)';
  for (const [row, col] of formulaCells) formulas[row - 1][col - 1] = '=""';
  const originalDerived = rows.slice(1).map((row, i) => [2, 3, 5].map(col => [row[col], formulas[i + 1][col]]));
  const writes = [], marked = [];
  let inserted = 0, locked = false, releases = 0, error;
  const sheet = {
    getMaxRows: () => rows.length,
    getLastColumn: () => 9,
    getDataRange: () => ({ getValues: () => rows.map(row => row.slice()) }),
    insertRowAfter(row) {
      assert.equal(locked, true);
      assert.equal(row, rows.length);
      rows.push(Array(9).fill('')); formulas.push(Array(9).fill('')); inserted++;
    },
    getRange(row, col, count = 1, width = 1) {
      if (changeBeforeWrite && row >= 2 && col === 1 && count === 1 && width === 9) {
        rows[row - 1][7] = 'Carga manual concurrente';
      }
      const read = data => data.slice(row - 1, row - 1 + count).map(values => values.slice(col - 1, col - 1 + width));
      return {
        getValues: () => read(rows), getFormulas: () => read(formulas),
        setValue(value) {
          assert.equal(locked, true);
          assert.ok(manual.includes(col - 1), 'Never write C, D or F');
          rows[row - 1][col - 1] = value;
          writes.push([row, col]);
        }
      };
    }
  };
  const context = {
    Logger: { log() {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'local-fixture' }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: name => {
      assert.equal(name, 'Registro de cobros'); return sheet;
    } }), flush() {} },
    LockService: { getScriptLock: () => ({ waitLock() { assert.equal(locked, false); locked = true; },
      releaseLock() { locked = false; releases++; } }) }
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  context.fetchConReintentos = (url, options) => {
    assert.equal(locked, true);
    let result;
    if (url.includes('/auth/')) result = { access_token: 'local-token' };
    else if (url.endsWith('/obtener_pagos_admin_pendientes_sheets')) result = payments;
    else if (url.endsWith('/marcar_pago_sincronizado_sheets')) { marked.push(JSON.parse(options.payload).p_pago_id); result = null; }
    else throw new Error('Unexpected request: ' + url);
    return { getResponseCode: () => 200, getContentText: () => JSON.stringify(result) };
  };
  context.actualizarTodosLosCreditosDesdeCobros = () => {};
  try { context.sincronizarPagosAdminHaciaSheets(); } catch (failure) { error = failure; }
  assert.equal(releases, 1);
  assert.equal(locked, false);
  assert.deepEqual(rows.slice(1, initial.length + 1).map((row, i) => [2, 3, 5].map(col => [row[col], formulas[i + 1][col]])), originalDerived);
  return { rows, formulas, writes, marked, inserted, error };
}

// Reuse the first valid interior hole, ignoring C/D/F array results.
let result = run([full('PG-1'), empty(), full('PG-2'), empty()], [payment(1), payment(2)]);
assert.ifError(result.error);
assert.equal(result.rows[2][8], sheetId(payment(1)));
assert.equal(result.rows[4][8], sheetId(payment(2)));
assert.equal(result.inserted, 0);
assert.deepEqual(result.marked, [payment(1).pago_id, payment(2).pago_id]);
assert.deepEqual([...new Set(result.writes.map(([row]) => row))], [3, 5]);

// Any manual content, including zero/false/whitespace, prevents reuse.
for (const col of manual) for (const value of ['Dato parcial', 0, false, ' ']) {
  const partial = empty(); partial[col] = value;
  result = run([partial, empty()], [payment(1)]);
  assert.ifError(result.error);
  assert.deepEqual(result.rows[1], partial);
  assert.equal(result.rows[2][8], sheetId(payment(1)));
}
// A manual formula returning an empty string also prevents reuse.
for (const col of manual) {
  result = run([empty(), empty()], [payment(1)], { formulaCells: [[2, col + 1]] });
  assert.ifError(result.error);
  assert.equal(result.rows[1][8], '');
  assert.equal(result.formulas[1][col], '=""');
  assert.equal(result.rows[2][8], sheetId(payment(1)));
}

// No holes: append after a partial record with no date, not after the last A value.
const partial = empty(); partial[8] = 'PG-PARTIAL';
result = run([full('PG-1'), partial], [payment(1), payment(2)]);
assert.ifError(result.error);
assert.equal(result.inserted, 2);
assert.equal(result.rows[2][8], 'PG-PARTIAL');
assert.equal(result.rows[3][8], sheetId(payment(1)));
assert.equal(result.rows[4][8], sheetId(payment(2)));
// Formula-only last manual row counts as occupied too.
result = run([empty()], [payment(1)], { formulaCells: [[2, 8]] });
assert.ifError(result.error);
assert.equal(result.inserted, 1);
assert.equal(result.rows[2][8], sheetId(payment(1)));
// Header-only sheet and unused trailing rows both work.
result = run([], [payment(1)]);
assert.ifError(result.error);
assert.equal(result.rows[1][8], sheetId(payment(1)));
result = run([full('PG-1'), empty()], [payment(1)]);
assert.ifError(result.error);
assert.equal(result.inserted, 0);
assert.equal(result.rows[2][8], sheetId(payment(1)));

// Recheck rejects a candidate changed since the scan, without writing/marking.
result = run([empty(), full('PG-1')], [payment(1)], { changeBeforeWrite: true });
assert.match(result.error?.message ?? '', /dejó de estar libre/);
assert.equal(result.writes.length, 0);
assert.equal(result.marked.length, 0);
// Existing IDs and repeated items in a batch retain publisher deduplication.
result = run([full(sheetId(payment(1))), empty()], [payment(1), payment(2), payment(2)]);
assert.ifError(result.error);
assert.equal(result.writes.length, 6);
assert.equal(result.rows[2][8], sheetId(payment(2)));
console.log('PASS: first free row, all six manual columns, blank-result formulas, preserved C/D/F, distinct batch rows, safe append, immediate recheck, ID deduplication and ScriptLock.');
