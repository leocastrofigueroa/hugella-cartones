// Prueba la ruta y componente reales sin servidor ni red; sesión/RPC simuladas.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const ts = require('typescript'), React = require('react'), { act } = React;
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = require('react-dom/client');
let env = {}, claims = { data: { claims: { sub: 'admin-fixture' } } };
let admin = true, rpcError = null, rpcCalls = [], fetchCalls = [], fetchResult;
const preflight = { estado_lote: 'LISTO_PARA_IMPORTAR', actor_id: 'admin-fixture', administrador: true, rol_jwt: 'authenticated', solo_lectura: true, diagnostico: null, statement_timeout: '8s', transaction_read_only: 'on' };
let resolveFetch;
let privateCalls = 0;
const result = { estado_lote: 'IMPORTADO_CORRECTAMENTE', compras_historicas: 60,
  obligaciones_monetarias: 280, cortes_historicos: 54, saldo_pendiente: 14259630.21 };
function load(file) {
  const mod = { exports: {} };
  vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    target: ts.ScriptTarget.ES2020,
  } }).outputText, {
    module: mod, exports: mod.exports, process: { env }, Request, Response, URL, console,
    fetch: async (...args) => { fetchCalls.push(args); return fetchResult ?? new Promise(resolve => { resolveFetch = resolve; }); },
    require(name) {
      if (name === '@/utils/supabase/server') return { createClient: async () => ({
        auth: { getClaims: async () => claims },
        rpc: async (...args) => {
          rpcCalls.push(args);
          if (args[0] === 'es_admin_hugella') {
            privateCalls++;
            return { data: null, error: { code: '42501', message: 'permission denied for function es_admin_hugella' } };
          }
          if (!admin) return { data: null, error: { code: '42501', message: 'No autorizado' } };
          return { data: args[0] === 'verificar_lote_hg_admin' ? preflight : result, error: rpcError };
        },
      }) };
      if (name === 'next/navigation') return {
        notFound() { throw new Error('404'); }, redirect() { throw new Error('LOGIN'); },
      };
      if (name === './import-historical-batch') return { __esModule: true, default: () => null };
      return require(name);
    },
  });
  return mod.exports;
}
let checks = 0;
function pass(label) { checks++; console.log('PASS:', label); }
const route = load('app/admin/compras/importacion-historica/ejecutar/route.ts');
const verifyRoute = load('app/admin/compras/importacion-historica/verificar/route.ts');
const page = load('app/admin/compras/importacion-historica/page.tsx').default;
const request = (origin='http://localhost',body) => new Request('http://localhost/admin/compras/importacion-historica/ejecutar', { method: 'POST', headers: { origin }, ...(body ? { body } : {}) });
const get = (query='') => new Request('http://localhost/admin/compras/importacion-historica/verificar'+query);
assert.equal((await route.POST(request())).status,404);
assert.equal((await verifyRoute.GET(get())).status,404);
assert.equal(rpcCalls.length,0); await assert.rejects(page,/404/);
pass('rutas y página cerradas por defecto');
env.HUGELLA_IMPORTACION_COMPRAS_HISTORICAS='verificar';
assert.equal((await route.POST(request())).status,404);
assert.equal((await route.POST(request('http://localhost','{"importar":true}'))).status,404);
assert.equal(rpcCalls.length,0); pass('modo verificar bloquea POST incluso con parámetro de activación');
assert.equal((await verifyRoute.GET(get('?importar=true'))).status,400);
assert.equal(rpcCalls.length,0); pass('preflight no acepta parámetros');
claims={data:{claims:null}};
assert.equal((await verifyRoute.GET(get())).status,401); await assert.rejects(page,/LOGIN/);
assert.equal(rpcCalls.length,0); pass('sesión requerida antes del preflight');
claims={data:{claims:{sub:'admin-fixture'}}};
rpcError={code:'42501',message:'No autorizado'};
assert.equal((await verifyRoute.GET(get())).status,403); pass('no admin rechazado por RPC');
rpcError=null; rpcCalls=[];
const ready=await verifyRoute.GET(get()); assert.equal(ready.status,200);
assert.equal((await ready.json()).estado_lote,'LISTO_PARA_IMPORTAR');
assert.equal(rpcCalls.length,1); assert.equal(rpcCalls[0][0],'verificar_lote_hg_admin');
assert.equal(rpcCalls[0][1],undefined); assert.equal(rpcCalls[0][2].get,true);
assert.match(ready.headers.get('cache-control'),/no-store/);
pass('una RPC de preflight GET read-only, sin payload ni importador');
const beforeOpen=rpcCalls.length;
const shell=await page();
assert.ok(shell); assert.equal(rpcCalls.length,beforeOpen); assert.equal(privateCalls,0);
const { renderToStaticMarkup } = require('react-dom/server');
assert.match(renderToStaticMarkup(shell),/Acceso administrativo pendiente/);
pass('admin con helper privado sin EXECUTE: abre pantalla sin 404 ni RPC ni preflight automático');
admin=false; assert.ok(await page()); assert.equal(rpcCalls.length,beforeOpen); admin=true;
pass('pantalla inicial no acredita admin: autorización queda en VERIFICAR público');
for (const error of [
 {code:'42501',message:'permission denied for function verificar_lote_hg_admin'},
 {code:'PGRST202',message:'Could not find the function in the schema cache'},
 {code:'57014',message:'canceling statement due to statement timeout'},
]) {
 rpcError=error;
 const response=await verifyRoute.GET(get()); assert.equal(response.status,502);
 assert.match((await response.json()).error,/Error técnico/);
}
rpcError=null; pass('permisos/caché/timeout técnicos producen 502 explícito, nunca falso no-admin ni 404');
env.HUGELLA_IMPORTACION_COMPRAS_HISTORICAS='habilitada';
assert.equal((await route.POST(request())).status,404);
pass('flag anterior habilitada tampoco activa importar por sí solo');
env.HUGELLA_EJECUTAR_LOTE_HG='habilitada';
assert.equal((await route.POST(request('https://otro.test'))).status,403);
assert.equal((await route.POST(request('http://localhost','{"actor":"otro"}'))).status,400);
pass('importar requiere segunda flag y mantiene origen/cuerpo vacío');
claims={data:{claims:null}}; assert.equal((await route.POST(request())).status,401);
claims={data:{claims:{sub:'admin-fixture'}}}; admin=false; assert.equal((await route.POST(request())).status,403); admin=true;
pass('importar conserva rechazo sin sesión/no admin');
rpcCalls=[]; assert.equal((await route.POST(request())).status,200);
assert.equal(rpcCalls.filter(x=>x[0]==='importar_lote_compras_historicas_admin').length,1);
assert.equal(rpcCalls.at(-1).length,1);
pass('importar habilitado sólo hace una llamada sin argumentos (mock offline)');
rpcError={code:'42501',message:'permission denied for function importar_lote_compras_historicas_admin'};
assert.equal((await route.POST(request())).status,502);
rpcError={code:'P0001',message:'C PARCIAL_O_INCONSISTENTE'};
assert.equal((await route.POST(request())).status,409);
rpcError=null;
pass('importador mock distingue permiso técnico de conflicto sin llamar helper privado');
const View=load('app/admin/compras/importacion-historica/import-historical-batch.tsx').default;
const root=createRoot(document.getElementById('root'));
async function mount(enabled=false) {
 await act(async()=>root.render(null));
 await act(async()=>root.render(React.createElement(View,{importEnabled:enabled})));
}
function buttons() { return document.querySelectorAll('button'); }
await mount(); assert.ok(buttons()[1].disabled); assert.equal(fetchCalls.length,0);
pass('UI no importa automáticamente y empieza sólo con VERIFICAR');
await act(async()=>buttons()[0].click());
assert.equal(fetchCalls.length,1); assert.equal(fetchCalls[0][0],'/admin/compras/importacion-historica/verificar');
assert.equal(fetchCalls[0][1].method,'GET'); assert.equal(fetchCalls[0][1].cache,'no-store');
assert.ok(buttons()[0].disabled && buttons()[1].disabled);
pass('VERIFICAR hace sólo GET, bloquea doble envío');
await act(async()=>resolveFetch(Response.json(preflight)));
assert.match(document.body.textContent,/LISTO_PARA_IMPORTAR/); assert.match(document.body.textContent,/Admin reconocido/);
assert.match(document.body.textContent,/admin-fixture/); assert.match(document.body.textContent,/no se modificó ningún dato/);
assert.match(document.body.textContent,/8s/); assert.ok(buttons()[1].disabled);
pass('muestra usuario/admin/estado/read-only/timeout e IMPORTAR sigue cerrado');
await mount(true); assert.ok(buttons()[1].disabled);
fetchResult=Response.json(preflight); await act(async()=>buttons()[0].click());
assert.ok(!buttons()[1].disabled);
fetchResult=Response.json(result); await act(async()=>buttons()[1].click());
assert.match(document.body.textContent,/IMPORTADO_CORRECTAMENTE/); assert.ok(buttons()[1].disabled);
pass('con flag server, requiere preflight LISTO antes de importar (mock)');
await mount(true); fetchResult=Response.json({...preflight,estado_lote:'YA_APLICADO_CORRECTAMENTE'});
await act(async()=>buttons()[0].click());
assert.match(document.body.textContent,/YA_APLICADO_CORRECTAMENTE/); assert.ok(buttons()[1].disabled);
pass('B se verifica sin reimportación');
await mount(true); fetchResult=Response.json({...preflight,estado_lote:'PARCIAL_O_INCONSISTENTE',diagnostico:'Baseline alterado'});
await act(async()=>buttons()[0].click());
assert.ok(document.querySelector('[role="alert"]')); assert.match(document.body.textContent,/revisión manual/); assert.ok(buttons()[1].disabled);
pass('C muestra diagnóstico y no habilita importar');
await mount(true); fetchResult=Response.json({...preflight,transaction_read_only:'off'});
await act(async()=>buttons()[0].click()); assert.ok(buttons()[1].disabled);
assert.match(document.body.textContent,/sólo lectura/); pass('respuesta no read-only no habilita importar');
for (const [status,message] of [[403,'Acceso rechazado: se requiere administrador.'],[502,'Error técnico: no se pudo completar el preflight.']]) {
 await mount(true); fetchResult=Response.json({error:message},{status});
 await act(async()=>buttons()[0].click());
 assert.match(document.querySelector('[role="alert"]').textContent,new RegExp(message));
 assert.ok(buttons()[1].disabled); assert.ok(!document.body.textContent.includes('Admin reconocido'));
}
pass('UI distingue rechazo de acceso y error técnico, ambos sin habilitar importar');
assert.equal(privateCalls,0);
pass('ninguna ruta/página depende del EXECUTE privado; importar autoriza sólo dentro de su RPC pública mockeada');
await act(async()=>root.unmount());
console.log(`PASS: ${checks} controles app, sin red ni importador real`);
