// Offline: real React DOM and actual route handlers, session/RPC/network mocked.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const React = require('react'); const { act } = React;
const ts = require('typescript'); const { JSDOM } = require('jsdom');
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
globalThis.window = dom.window; globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = require('react-dom/client');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const fixture = { id: id(2), nombre: 'Cliente ficticio', dni: '12345678', telefono: null, domicilio: null, ubicacion: 'Referencia fixture' };
const input = { p_operacion_id: id(1), p_dni: '12345678', p_cliente_nuevo: true, p_cliente_id_esperado: null, p_nombre: 'Cliente ficticio', p_telefono: null, p_domicilio: null, p_producto: 'Producto fixture', p_fecha_inicio: '2026-10-08', p_cantidad_cuotas: 10, p_importe_cuota: '123.45', p_inversion: '500', p_ubicacion: null };
const row = p => ({ operacion_id: p.p_operacion_id, cliente_id: p.p_cliente_id_esperado || id(2), credito_id: id(3), codigo: 'CR-0048', cliente_creado: p.p_cliente_nuevo, ya_procesada: false, access_token: id(4) });
let claims = { data: { claims: { sub: id(9) } } }; let rpc = () => ({ data: [], error: null });
let fetchHandler; let uuid = 100;
const cache = new Map();
function load(file) {
  file = path.resolve(file); if (cache.has(file)) return cache.get(file);
  const loadedModule = { exports: {} };
  vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, {
    module: loadedModule, exports: loadedModule.exports, Request, Response, URL, window: dom.window,
    crypto: { randomUUID: () => id(++uuid) }, fetch: (...args) => fetchHandler(...args),
    require(name) {
      if (name === '@/utils/supabase/server') return { createClient: async () => ({ auth: { getClaims: async () => claims }, rpc: async (...args) => rpc(...args) }) };
      if (name === '@/app/admin/admin-types') return load('app/admin/admin-types.ts');
      if (name === 'next/link') return { __esModule: true, default: props => React.createElement('a', props) };
      if (name.endsWith('.module.css')) return { __esModule: true, default: { creditConfirmation: 'creditConfirmation' } };
      if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name) + '.ts');
      return require(name);
    },
  }); cache.set(file, loadedModule.exports); return loadedModule.exports;
}
const types = load('app/admin/admin-types.ts');
const lookup = load('app/api/admin/clientes/buscar/route.ts').POST;
const create = load('app/api/admin/creditos/route.ts').POST;
const Form = load('app/admin/nuevo-credito/new-credit-form.tsx').default;
let checks = 0;
function check(name, action) { action(); checks++; console.log(`PASS: ${name}`); }
async function request(handler, body, origin = 'http://localhost') {
  const res = await handler(new Request('http://localhost/api/admin/test', { method: 'POST', headers: { 'Content-Type': 'application/json', origin }, body: JSON.stringify(body) }));
  assert.equal(res.headers.get('Cache-Control'), 'private, no-store'); return { status: res.status, body: await res.json() };
}
rpc = () => ({ data: [fixture], error: null });
let response = await request(lookup, { dni: '12.345 678' }); check('existing normalized lookup', () => assert.deepEqual(response.body.client, fixture));
rpc = () => ({ data: [], error: null }); response = await request(lookup, { dni: fixture.dni }); check('nonexistent lookup', () => assert.equal(response.body.client, null));
for (const data of [[fixture, fixture], [{ id: 'invalid' }], null]) { rpc = () => ({ data, error: null }); response = await request(lookup, { dni: fixture.dni }); check('invalid/ambiguous lookup fails', () => assert.equal(response.status, 502)); }
claims = { data: null }; response = await request(create, input); check('missing session', () => assert.equal(response.status, 401)); claims = { data: { claims: { sub: id(9) } } };
rpc = () => ({ error: { code: '42501', message: 'private SQL' } }); response = await request(create, input); check('non-admin denied safely', () => { assert.equal(response.status, 403); assert.doesNotMatch(JSON.stringify(response.body), /private SQL/); });
response = await request(create, input, 'http://foreign.example'); check('foreign origin rejected', () => assert.equal(response.status, 403));
for (const patch of [{ p_dni: '123' }, { p_dni: '1234567890' }, { p_nombre: '' }, { p_fecha_inicio: '2026-10-11' }, { p_fecha_inicio: '2026-02-30' }, { p_cantidad_cuotas: 1.5 }, { p_importe_cuota: '1.234' }, { p_importe_cuota: '0' }, { p_importe_cuota: '10000000000' }, { p_inversion: '0' }, { p_inversion: null }, { p_inversion: '1.234' }, { p_ubicacion: ' ' }, { p_codigo: 'CR-9999' }, { origen: 'ADMIN' }, { access_token: id(4) }]) check(`validation ${Object.keys(patch)[0]}`, () => assert.ok(types.validateCreditCreation({ ...input, ...patch })));
rpc = (_, p) => ({ data: [row(p)], error: null }); response = await request(create, input); check('new payload and no token serialization', () => { assert.equal(response.status, 201); assert.equal(Object.hasOwn(response.body.result, 'access_token'), false); });
const existing = { ...input, p_cliente_nuevo: false, p_cliente_id_esperado: fixture.id, p_nombre: null };
response = await request(create, existing); check('existing payload valid', () => assert.equal(response.status, 201));
for (const data of [[], [row(input), row(input)], [{ ...row(input), operacion_id: id(99) }], [{ ...row(input), access_token: null }]]) { rpc = () => ({ data, error: null }); response = await request(create, input); check('invalid confirmation is uncertain', () => assert.equal(response.body.outcome, 'uncertain')); }
const legacy = { ...input }; delete legacy.p_inversion; delete legacy.p_ubicacion;
rpc = (_, p) => { assert.equal(Object.keys(p).length, 11); return { data: [{ ...row(p), ya_procesada: true }], error: null }; };
response = await request(create, legacy); check('old browser confirmed retry remains supported', () => assert.equal(response.status, 200));
rpc = () => ({ error: { code: '22023', message: 'Esta firma solo permite reintentar altas confirmadas; use el alta con inversión' } });
response = await request(create, legacy); check('old new-creation rejection explains refresh without raw SQL', () => { assert.equal(response.status, 409); assert.equal(response.body.outcome, 'rejected'); assert.match(response.body.error, /desactualizada/); });
check('old payload cannot validate as a new UI intention', () => assert.ok(types.validateCreditCreation(legacy)));
check('exact economics and ceiling', () => { assert.equal(types.creditEconomics('123.45', 10, '500').ganancia, '$ 734,50'); assert.equal(types.creditEconomics('123.45', 10, '500').recuperacion, '5'); });
check('exact money total', () => assert.equal(types.creationMoney('123.45', 10), '$ 1.234,50'));
let root = createRoot(document.getElementById('root'));
const query = selector => document.querySelector(selector);
const text = () => document.body.textContent;
async function set(name, value) { await act(async () => { const el = query(`[name="${name}"]`); Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(el, value); el.dispatchEvent(new dom.window.Event('input', { bubbles: true })); }); }
async function submit(form) { await act(async () => query(`#${form}`).dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }))); }
async function mount() { await act(async () => { root.unmount(); }); root = createRoot(query('#root')); await act(async () => root.render(React.createElement(Form))); }
const ok = body => Response.json(body);
async function populate(client = null) {
  fetchHandler = async () => ok({ client }); await set('dni', fixture.dni); await submit('client-search-form');
  if (!client) { await set('nombre', 'Cliente ficticio'); await set('ubicacion', 'Referencia nueva fixture'); }
  await set('producto', 'Producto fixture'); await set('fecha', '2026-10-08'); await set('cuotas', '10'); await set('importe', '123,45'); await set('inversion', '500');
  await submit('credit-data-form'); await act(async () => query('input[type="checkbox"]').click());
}
try {
  await mount(); await populate(fixture); check('confirmation layout scoped and flexible', () => { const label = query('input[type="checkbox"]').parentElement; assert.ok(label.classList.contains('creditConfirmation')); assert.ok(label.querySelector('span').classList.contains('flex-1')); assert.ok(label.querySelector('span').classList.contains('min-w-0')); assert.match(readFileSync('app/admin/admin.module.css', 'utf8'), /\.root \.creditConfirmation input\[type="checkbox"\]\s*\{\s*width: 1\.25rem;\s*flex: 0 0 1\.25rem;/); }); check('existing client readonly', () => { assert.equal(query('[name="nombre"]'), null); assert.equal(query('[name="ubicacion"]'), null); });
  const calls = []; let finish;
  fetchHandler = (_, options) => { calls.push(JSON.parse(options.body)); return new Promise(resolve => { finish = resolve; }); };
  await act(async () => { const form = query('#credit-confirm-form'); form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); });
  check('double click one request', () => assert.equal(calls.length, 1));
  check('existing client frozen payload and whitelist', () => { assert.equal(calls[0].p_nombre, null); assert.equal(calls[0].p_cliente_id_esperado, fixture.id); assert.equal(Object.keys(calls[0]).length, 13); assert.equal(types.validateCreditCreation(calls[0]), null); assert.equal(calls[0].p_inversion, '500'); assert.equal(calls[0].p_ubicacion, null); });
  await act(async () => finish(Response.json({}, { status: 502 }))); await submit('credit-confirm-form');
  check('uncertain retry identical UUID/payload', () => assert.deepEqual(calls[1], calls[0]));
  await act(async () => finish(ok({ result: row(calls[1]) }))); check('generated code success', () => assert.match(text(), /Crédito creado correctamente.*CR-0048/s));
  await act(async () => [...document.querySelectorAll('button')].find(el => el.textContent === 'Crear otro crédito').click()); await populate();
  fetchHandler = async (_, options) => { calls.push(JSON.parse(options.body)); return ok({ result: row(calls.at(-1)) }); }; await submit('credit-confirm-form');
  check('new intention UUID and new-client payload', () => { assert.notEqual(calls[2].p_operacion_id, calls[0].p_operacion_id); assert.equal(calls[2].p_cliente_nuevo, true); assert.equal(calls[2].p_nombre, 'Cliente ficticio'); assert.equal(calls[2].p_ubicacion, 'Referencia nueva fixture'); });
  await mount(); fetchHandler = async () => Response.json({}, { status: 500 }); await set('dni', fixture.dni); await submit('client-search-form'); check('search error never nonexistent', () => assert.equal(query('#credit-data-form'), null));
  await mount(); const searches = []; fetchHandler = () => new Promise(resolve => searches.push(resolve)); await set('dni', fixture.dni); await submit('client-search-form'); await set('dni', '87654321'); check('changed DNI invalidates lookup', () => assert.equal(query('#credit-data-form'), null)); await submit('client-search-form');
  await act(async () => searches[1](ok({ client: null }))); await act(async () => searches[0](ok({ client: fixture }))); check('stale response ignored', () => { assert.ok(query('[name="nombre"]')); assert.doesNotMatch(text(), /Cliente encontrado/); });
  await mount(); await populate(); fetchHandler = async () => Response.json({ outcome: 'rejected', code: 'VALIDATION', error: 'Revisá los datos' }, { status: 422 }); await submit('credit-confirm-form'); check('definitive rejection allows editing', () => assert.ok(query('#credit-data-form')));
  await set('fecha', '2026-10-11'); await submit('credit-data-form'); check('UI Sunday rejected', () => assert.match(text(), /no puede ser domingo/));
  await set('fecha', '2026-10-08'); await set('nombre', ''); await submit('credit-data-form'); check('UI new name required', () => assert.match(text(), /nombre del cliente nuevo/));
  await set('nombre', 'Cliente ficticio'); await submit('credit-data-form'); let noConfirmation = 0; fetchHandler = async () => { noConfirmation++; return ok({}); }; await submit('credit-confirm-form'); check('explicit confirmation required', () => assert.equal(noConfirmation, 0));
  await act(async () => query('input[type="checkbox"]').click()); let rejectedId;
  fetchHandler = async (_, options) => { rejectedId = JSON.parse(options.body).p_operacion_id; return Response.json({ outcome: 'rejected', code: 'VALIDATION', error: 'Revisá los datos' }, { status: 422 }); }; await submit('credit-confirm-form'); await submit('credit-data-form'); await act(async () => query('input[type="checkbox"]').click());
  fetchHandler = async (_, options) => { const payload = JSON.parse(options.body); check('definitive rejection gets new UUID', () => assert.notEqual(payload.p_operacion_id, rejectedId)); throw new Error('offline'); }; await submit('credit-confirm-form');
  fetchHandler = async () => Response.json({ outcome: 'rejected', code: 'SESSION', error: 'Sesión vencida' }, { status: 401 }); await submit('credit-confirm-form'); check('session loss after uncertainty preserves intention', () => { assert.equal(query('#credit-data-form'), null); assert.ok(query('#credit-confirm-form')); });
  console.log(`PASS: ${checks} assertions; no network, credentials, SQL or production.`);
} finally { await act(async () => root.unmount()); dom.window.close(); }
