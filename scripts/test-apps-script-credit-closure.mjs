// Executes the real companion Apps Script with local Sheets/RPC mocks.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source = readFileSync(new URL('../CierresCreditos.gs', import.meta.url), 'utf8');
const headers = Array(20).fill('');
headers[0] = 'ID CREDITO'; headers[19] = 'ESTADO';
const credit = code => { const row = Array(20).fill(''); row[0] = code; row[7] = 100; row[8] = 30;
  row[10] = 1200; row[11] = 2; row[13] = 28; row[14] = 2800; row[18] = 26; row[19] = 'ATRASADO (24)'; return row; };
const closures = [
  { credito_id: '1', codigo_credito: 'CR-1', tipo: 'DEVUELTO', fecha: '2026-09-30' },
  { credito_id: '2', codigo_credito: 'CR-2', tipo: 'RETIRADO', fecha: '2026-09-30' },
];
// Fixture destinations only; production cell addresses must be configured.
const config = ['Resumen', 'Dashboard'].flatMap(hoja =>
  ['capital_pendiente', 'ganancia_esperada', 'creditos_activos', 'creditos_atrasados', 'cuotas_pendientes', 'cuotas_atrasadas', 'importe_atrasado']
    .map((indicador, index) => ({ hoja, celda: 'B' + (index + 2), indicador })));
let writes, rpcCalls, sheets, locked, estimateCalls, batches, configuration;
function sheet(name, rows = []) {
  return {
    rows, getMaxRows: () => 100, getLastRow: () => rows.length,
    getDataRange: () => ({ getValues: () => rows.map(row => row.slice()) }),
    getRange(row, col, count = 1, width = 1) {
      const record = (kind, values) => {
        assert.equal(locked, true);
        if (name === 'Mercadería') assert.equal(col, 20, 'Only T may be written in Mercadería');
        assert.ok(['Mercadería', 'Cierres de créditos', 'Resumen', 'Dashboard'].includes(name));
        writes.push({ name, row, col, count, width, kind, values });
      };
      return {
        getValues: () => rows.slice(row - 1, row - 1 + count).map(values => values.slice(col - 1, col - 1 + width)),
        getDisplayValues() { return this.getValues().map(values => values.map(value => String(value ?? ''))); },
        setValues(values) { record('values', values); values.forEach((value, i) => { rows[row - 1 + i] = value.slice(); }); },
        setFormulas(values) { record('formulas', values); },
        setFormula(value) { record('formula', value); },
      };
    }
  };
}
const context = {
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => JSON.stringify(configuration) }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => ({
    getSheetByName(name) { assert.ok(!name.includes('Calendario'), 'Never access financial calendar'); return sheets[name]; },
    insertSheet(name) { return sheets[name] = sheet(name); }
  }), flush() {} },
  conBloqueoRegistroCobros_(action) { locked = true; try { return action(); } finally { locked = false; } },
  obtenerConexionSupabase_: () => ({}),
  llamarRpcSupabase_(_connection, name, args) {
    assert.equal(name, 'obtener_cierres_creditos_sheets', 'Do not use payment RETIRAR RPCs');
    rpcCalls.push(args.p_despues);
    const batch = batches.shift();
    if (batch instanceof Error) throw batch;
    return batch;
  },
  actualizarRecaudacionEstimada() { estimateCalls++; },
};
vm.createContext(context); vm.runInContext(source, context);
function reset() {
  writes = []; rpcCalls = []; locked = false; estimateCalls = 0; configuration = config;
  batches = [[closures[0]], [closures[1]], []];
  sheets = { 'Mercadería': sheet('Mercadería', [headers, credit('CR-1'), credit('CR-2'), credit('CR-3')]),
    Resumen: sheet('Resumen'), Dashboard: sheet('Dashboard'),
    'Calendario Financiero': sheet('Calendario Financiero', [['Obligación', 1234]]) };
}
reset();
const original = JSON.stringify(sheets['Mercadería'].rows);
const calendar = JSON.stringify(sheets['Calendario Financiero'].rows);
context.sincronizarCierresCreditosHaciaSheets();
assert.equal(locked, false);
assert.deepEqual(rpcCalls, [null, '1', '2'], 'Read all pages even when a server cap returns a short page');
assert.equal(estimateCalls, 1);
assert.equal(JSON.stringify(sheets['Mercadería'].rows), original, 'No manual economic cells changed');
assert.equal(JSON.stringify(sheets['Calendario Financiero'].rows), calendar);
assert.equal(sheets['Cierres de créditos'].rows.length, 3);
const states = writes.find(write => write.name === 'Mercadería');
assert.equal(states.kind, 'formulas'); assert.equal(states.width, 1);
assert.match(states.values[0][0], /COUNTIF\('Cierres de créditos'!\$A\$2:\$A;A2\)>0;"CANCELADO"/);
assert.match(states.values[2][0], /IF\(L4>=I4;"CANCELADO"/);
for (const name of ['Resumen', 'Dashboard']) {
  const indicators = writes.filter(write => write.name === name);
  assert.equal(indicators.length, 7);
  assert.match(indicators[0].values, /'Mercadería'!O2:O;/);
  assert.match(indicators[1].values, /'Mercadería'!K2:K;/);
  for (const index of [0, 1, 4, 5, 6]) assert.match(indicators[index].values, /COUNTIF\('Cierres de créditos'!A2:A;'Mercadería'!A2:A\)=0/);
  assert.match(indicators[2].values, /COUNTIF\('Mercadería'!T2:T;"AL DÍA"\)/);
}
const firstWrites = JSON.stringify(writes);
writes = []; batches = [closures, []];
context.sincronizarCierresCreditosHaciaSheets();
assert.equal(JSON.stringify(writes), firstWrites, 'Replaying the snapshot is deterministic');
writes = []; batches = [[closures[0]], []];
assert.throws(() => context.sincronizarCierresCreditosHaciaSheets(), /perdió o cambió/);
assert.equal(writes.length, 0, 'Partial snapshot must not erase a previous closure');
reset(); batches = [[closures[0]], new Error('Network failure')];
assert.throws(() => context.sincronizarCierresCreditosHaciaSheets(), /Network failure/);
assert.equal(writes.length, 0);
reset(); configuration = null;
assert.throws(() => context.sincronizarCierresCreditosHaciaSheets(), /Configurar/);
assert.equal(writes.length, 0);
reset(); configuration = [...config, { hoja: 'Calendario Financiero', celda: 'B2', indicador: 'capital_pendiente' }];
assert.throws(() => context.sincronizarCierresCreditosHaciaSheets(), /inválido/);
assert.equal(writes.length, 0);
reset(); sheets['Mercadería'].rows[2][0] = 'CR-1';
assert.throws(() => context.sincronizarCierresCreditosHaciaSheets(), /duplicado/);
assert.equal(writes.length, 0);
reset(); batches = [[{ ...closures[0], codigo_credito: 'AUSENTE' }], []];
assert.throws(() => context.sincronizarCierresCreditosHaciaSheets(), /ausente/);
assert.equal(writes.length, 0);
console.log('PASS: complete paginated/replayable closure sync, T=CANCELADO formula, economic masks in Resumen/Dashboard, preserved L/N/O/K, required destinations, failure before writes, no calendar access and no payment RETIRAR RPCs.');
