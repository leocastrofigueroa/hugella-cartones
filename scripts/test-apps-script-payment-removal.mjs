// Executes Supabase.gs with local mocks only. No Apps Script or remote calls.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('../Supabase.gs', import.meta.url), 'utf8');

function createSheet(ids) {
  const rows = [
    ['Fecha', 'ID Crédito', 'Cliente', 'Mercadería', 'Importe cobrado',
      'Cuotas equivalentes', 'Medios de pago', 'Observaciones', 'ID PAGO'],
    ...ids.map(id => [
      'FECHA', 'CREDITO', 'CLIENTE_FORMULA', 'MERCADERIA_FORMULA', 7600,
      'CUOTAS_FORMULA', 'EFECTIVO', 'OBSERVACION', id
    ])
  ];

  const columnName = column => {
    let name = '';
    for (let value = column; value > 0; value = Math.floor((value - 1) / 26)) {
      name = String.fromCharCode(65 + ((value - 1) % 26)) + name;
    }
    return name;
  };

  return {
    rows,
    getLastColumn: () => rows[0].length,
    getLastRow: () => rows.length,
    getRange(row, column, rowCount = 1, columnCount = 1) {
      return {
        getValues: () => rows.slice(row - 1, row - 1 + rowCount)
          .map(values => values.slice(column - 1, column - 1 + columnCount)),
        getDisplayValues: () => rows.slice(row - 1, row - 1 + rowCount)
          .map(values => values.slice(column - 1, column - 1 + columnCount).map(String)),
        getA1Notation: () => columnName(column) + row
      };
    },
    getRangeList(addresses) {
      return {
        clearContent() {
          addresses.forEach(address => {
            const match = /^([A-Z]+)(\d+)$/.exec(address);
            const column = [...match[1]].reduce((total, character) =>
              total * 26 + character.charCodeAt(0) - 64, 0);
            rows[Number(match[2]) - 1][column - 1] = '';
          });
        }
      };
    }
  };
}

const rpcCalls = [];
let recalculations = 0;
let flushes = 0;
const context = {
  console,
  Logger: { log() {} },
  SpreadsheetApp: { flush() { flushes++; } },
  LockService: {
    getScriptLock() {
      return { waitLock() {}, releaseLock() {} };
    }
  }
};
vm.createContext(context);
vm.runInContext(source, context);
context.llamarRpcSupabase_ = (_connection, name, payload) => {
  rpcCalls.push({ name, payload });
  return name === 'preparar_retiro_pago_sheets' ? '2026-09-20T12:00:00Z' : null;
};
context.recalcularCuotasPagasMercaderia = () => { recalculations++; };

const connection = { url: 'local', headers: {} };
const event = (id, prepared = null) => ({
  evento_id: `evento-${id}`,
  tipo: 'RETIRAR',
  pago_id: `pago-${id}`,
  id_pago_sheets: id,
  intentos: 1,
  reserva_token: `token-${id}`,
  retiro_preparado_at: prepared
});

// Exactly one row: prepare first, clear A/B/E/G/H/I, preserve C/D/F, recalc and confirm.
let sheet = createSheet(['PG-000123']);
let columns = context.obtenerColumnasRetiro_(sheet);
let result = context.procesarEventoRetirar_(connection, sheet, columns, event('PG-000123'));
assert.equal(result, 'CONFIRMADO');
assert.deepEqual(sheet.rows[1], [
  '', '', 'CLIENTE_FORMULA', 'MERCADERIA_FORMULA', '',
  'CUOTAS_FORMULA', '', '', ''
]);
assert.deepEqual(rpcCalls.map(call => call.name), [
  'preparar_retiro_pago_sheets',
  'finalizar_evento_pago_sheets'
]);
assert.equal(rpcCalls[1].payload.p_resultado, 'CONFIRMAR');
assert.equal(recalculations, 1);
assert.equal(flushes, 2);

// Duplicate exact IDs are blocked before any cell changes.
rpcCalls.length = 0;
sheet = createSheet(['ADM-ABCDEF123456', 'ADM-ABCDEF123456']);
const duplicateBefore = JSON.stringify(sheet.rows);
columns = context.obtenerColumnasRetiro_(sheet);
result = context.procesarEventoRetirar_(
  connection,
  sheet,
  columns,
  event('ADM-ABCDEF123456')
);
assert.equal(result, 'BLOQUEADO');
assert.equal(JSON.stringify(sheet.rows), duplicateBefore);
assert.equal(rpcCalls.length, 1);
assert.equal(rpcCalls[0].payload.p_resultado, 'BLOQUEAR');
assert.match(rpcCalls[0].payload.p_detalle, /Filas: 2, 3/);

// Initial absence is blocked; a durable prepared absence is recalculated and confirmed.
rpcCalls.length = 0;
recalculations = 0;
sheet = createSheet([]);
columns = context.obtenerColumnasRetiro_(sheet);
result = context.procesarEventoRetirar_(connection, sheet, columns, event('PG-AUSENTE'));
assert.equal(result, 'BLOQUEADO');
assert.equal(rpcCalls[0].payload.p_resultado, 'BLOQUEAR');
assert.equal(recalculations, 0);

rpcCalls.length = 0;
flushes = 0;
result = context.procesarEventoRetirar_(
  connection,
  sheet,
  columns,
  event('PG-AUSENTE', '2026-09-20T12:00:00Z')
);
assert.equal(result, 'CONFIRMADO');
assert.equal(rpcCalls[0].payload.p_resultado, 'CONFIRMAR');
assert.equal(recalculations, 1);
assert.equal(flushes, 2);

// Matching is exact and case-sensitive; a structural change fails before clearing formulas.
sheet = createSheet(['pg-000123']);
columns = context.obtenerColumnasRetiro_(sheet);
assert.equal(context.buscarFilasPorIdPago_(sheet, columns.idPago, 'PG-000123').length, 0);
sheet.rows[0][8] = 'OTRA COLUMNA';
assert.throws(() => context.obtenerColumnasRetiro_(sheet), /Faltan columnas manuales/);

// The shared lock is always released, including when the protected action fails.
let released = 0;
context.LockService.getScriptLock = () => ({
  waitLock(milliseconds) { assert.equal(milliseconds, 30000); },
  releaseLock() { released++; }
});
assert.throws(() => context.conBloqueoRegistroCobros_(() => {
  throw new Error('fallo local');
}), /fallo local/);
assert.equal(released, 1);

// Existing entry points that write Registro de cobros use the same lock helper.
for (const name of [
  'sincronizarTodosLosCreditosASupabase',
  'migrarIdsPagosExistentes',
  'sincronizarPagosAdminHaciaSheets',
  'procesarEventosRetirarSheets'
]) {
  assert.match(context[name].toString(), /conBloqueoRegistroCobros_/);
}
assert.match(
  context.sincronizarTodosLosCreditosASupabase.toString(),
  /procesarEventosRetirarSheets_\(\)/
);

console.log('PASS: exact RETIRAR lookup, duplicate/absent handling, durable retry, A/B/E/G/H/I-only clearing, C/D/F preservation, recalculation, confirmation and shared ScriptLock.');
