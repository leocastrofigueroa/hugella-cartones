// Vista real bajo JSDOM; sin red, backend, servidor Next ni datos reales.
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const React = require('react'), { act } = React, ts = require('typescript');
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = require('react-dom/client');
const root = createRoot(document.getElementById('root'));
let detail;
const cache = new Map();
function load(file) {
  file = path.resolve(file);
  if (cache.has(file)) return cache.get(file);
  const mod = { exports: {} };
  vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
    esModuleInterop: true, target: ts.ScriptTarget.ES2020,
  } }).outputText, {
    module: mod, exports: mod.exports, console,
    fetch: async () => Response.json({ result: detail }),
    require(name) {
      if (name === 'next/link') return { __esModule: true, default: props => React.createElement('a', props) };
      if (name === './receipt-files' || name === './annul-purchase') return { __esModule: true, default: () => null };
      if (name.startsWith('.')) {
        const base = path.resolve(path.dirname(file), name);
        return load(base + (existsSync(base + '.ts') ? '.ts' : '.tsx'));
      }
      return require(name);
    },
  });
  cache.set(file, mod.exports);
  return mod.exports;
}
const View = load('app/admin/compras/purchases-view.tsx').default;
const base = { id: 'fixture', tipo: 'MERCADERIA', fecha: '2026-09-01', moneda: 'ARS',
  proveedor: { nombre: 'Proveedor fixture' }, created_at: '2026-10-14T12:00:00Z',
  total: 1234.56, comprobante: null, observaciones: null, cantidad_items: 1,
};
async function mount(data) {
  detail = data;
  await act(async () => root.render(null));
  await act(async () => root.render(React.createElement(View, { id: 'fixture' })));
  return document.body.textContent;
}
let checks = 0;
function check(label, condition) { assert.ok(condition, label); checks++; console.log('PASS:', label); }
const historical = await mount({ ...base, fuente: 'GOOGLE_SHEETS_COMPRAS', id_origen: 'HG-0007',
  items: [{ id: 'item', posicion: 1, descripcion: 'Compra heredada', modalidad: 'TOTAL_HISTORICO',
    cantidad: null, costo_unitario: null, total: 1234.56 }],
});
check('HG y origen explícitos', historical.includes('ID histórico: HG-0007') && historical.includes('Origen: Google Sheets'));
check('cantidad desconocida explícita', historical.includes('Cantidad: No registrada en la fuente histórica'));
check('costo desconocido explícito', historical.includes('Costo unitario: No registrado en la fuente histórica'));
check('total histórico real', historical.includes('Total histórico:') && historical.includes('1.234,56'));
check('resumen no afirma unidad', historical.includes('Resumen histórico') && !historical.includes('Cantidad: 0') && !historical.includes('Cantidad: 1') && !historical.includes('Costo unitario: 0'));
const normal = await mount({ ...base, fuente: null, id_origen: null,
  items: [{ id: 'item', posicion: 1, descripcion: 'Compra normal', modalidad: 'DETALLADO',
    cantidad: 2, costo_unitario: 617.28, total: 1234.56 }],
});
check('normal conserva cantidad/costo', normal.includes('Cantidad: 2') && normal.includes('Costo unitario: 617,28 ARS'));
check('normal conserva ítems/total', normal.includes('Ítems') && normal.includes('Total:') && normal.includes('TOTAL GENERAL:'));
check('normal sin etiquetas históricas', !normal.includes('históric') && !normal.includes('Google Sheets') && !normal.includes('No registrad'));
const documentary = await mount({ ...base, total: 0, fuente: 'GOOGLE_SHEETS_COMPRAS', id_origen: 'HG-0043',
  items: [{ id: 'item', posicion: 1, descripcion: 'Imán vehiculos', modalidad: 'TOTAL_HISTORICO', cantidad: null, costo_unitario: null, total: 0 }],
  evidencia_historica: { tarjeta_original: 'Visa L', tarjeta_canonica: 'Visa Leo Santander', cuotas_fuente: 1,
    valor_cuota_historico: 0, pagadas_historicas: 0, pendientes_historicas: 1, saldo_historico: 0,
    estado_original: '🟢 Activa', cierre_original: '2026-10-22', vencimiento_original: '2026-11-02',
    tratamiento: 'FINANCIACION_HISTORICA_SIN_IMPORTE_OPERATIVO' },
});
check('HG-0043 origen y total cero preservados', documentary.includes('HG-0043') && documentary.includes('Total histórico:') && documentary.includes('0,00'));
check('Visa Leo y cuota cero explícitas', documentary.includes('Visa Leo Santander (Visa L)') && documentary.includes('Cuotas de la fuente: 1') && documentary.includes('Valor cuota:'));
check('pendiente documental separado de deuda', documentary.includes('Pagadas según la fuente: 0') && documentary.includes('Pendientes documentales: 1') && documentary.includes('sin deuda monetaria operativa'));
check('no inventa pago ni anulación', !documentary.includes('ANULADA') && !documentary.includes('pagada') && !documentary.includes('sin financiación'));
const financed = await mount({ ...base, fuente: 'GOOGLE_SHEETS_COMPRAS', id_origen: 'HG-0004',
  items: [{ id: 'item', posicion: 1, descripcion: 'Histórica', modalidad: 'TOTAL_HISTORICO', cantidad: null, costo_unitario: null, total: 1234.56 }],
  evidencia_historica: { tarjeta_original: 'Visa F', tarjeta_canonica: 'Visa Facu Santander', cuotas_fuente: 3,
    valor_cuota_historico: 411.52, pagadas_historicas: 1, pendientes_historicas: 2, saldo_historico: 823.04,
    estado_original: '🟢 Activa', cierre_original: '2026-07-23', vencimiento_original: '2026-08-03',
    tratamiento: 'FINANCIACION_HISTORICA_OPERATIVA' },
});
check('histórica operativa distinguida con estrategia explícita', financed.includes('Financiación histórica operativa') && financed.includes('Distribución histórica:') && !financed.includes('Pendientes documentales'));
await act(async () => root.unmount());
console.log(`PASS: ${checks} checks; offline only`);
