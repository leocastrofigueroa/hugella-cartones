// Offline: componentes React y handlers reales; sesión/RPC/fetch simulados.
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const React = require('react'); const { act } = React;
const ts = require('typescript'); const { JSDOM } = require('jsdom');
const dom = new JSDOM('<div id="root"></div>', { url:'http://localhost' });
globalThis.window=dom.window; globalThis.document=dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const { createRoot } = require('react-dom/client');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let claims={data:{claims:{sub:id(9)}}}; let rpcCalls=[]; let rpcResult={data:{operacion_id:id(1),compra_gasto_id:id(3)},error:null};
let fetchHandler=async()=>Response.json({result:[]}); let serial=50;
const cache=new Map();
function load(file) {
 file=path.resolve(file); if(cache.has(file))return cache.get(file);
 const mod={exports:{}};
 vm.runInNewContext(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true,target:ts.ScriptTarget.ES2020}}).outputText,{
 module:mod,exports:mod.exports,Request,Response,URL,console,window:dom.window,
 crypto:{randomUUID:()=>id(++serial)},fetch:(...args)=>fetchHandler(...args),
 require(name){
 if(name==='@/utils/supabase/server')return {createClient:async()=>({auth:{getClaims:async()=>claims},rpc:async(...args)=>{rpcCalls.push(args);return rpcResult;}})};
 if(name==='next/link')return {__esModule:true,default:props=>React.createElement('a',props)};
 if(name.startsWith('@/'))return load(name.slice(2)+'.ts');
 if(name.startsWith('.')){const base=path.resolve(path.dirname(file),name);return load(base+(existsSync(base+'.ts')?'.ts':'.tsx'));}
 return require(name);
 }}); cache.set(file,mod.exports);return mod.exports;
}
const {handle}=load('app/api/admin/compras/handlers.ts');
const Cards=load('app/admin/compras/cards-view.tsx').default;
let checks=0;const ok=(name,condition)=>{assert.ok(condition,name);checks++;console.log('PASS',name)};
const request=(kind,body,origin='http://localhost')=>new Request('http://localhost/api/admin/compras/'+kind,{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
const cardPayload={p_operacion_id:id(1),p_nombre:'Visa',p_entidad:'Fixture'};
rpcResult={data:{operacion_id:id(1),tarjeta_id:id(2)},error:null};
ok('alta tarjeta',(await handle(request('tarjetas',cardPayload),'cards')).status===200);
ok('RPC exclusiva',rpcCalls.at(-1)[0]==='crear_tarjeta_credito_admin');
ok('same origin',(await handle(request('tarjetas',cardPayload,'http://other'),'cards')).status===403);
const period={p_operacion_id:id(1),p_tarjeta_id:id(2),p_fecha_cierre:'2026-10-01',p_fecha_vencimiento:'2026-10-15'};
rpcResult={data:{operacion_id:id(1),periodo_id:id(3)},error:null};
ok('alta período',(await handle(request('periodos',period),'periods')).status===200);
ok('RPC período',rpcCalls.at(-1)[0]==='registrar_periodo_tarjeta_admin');
for(const field of ['p_fecha_cierre','p_fecha_vencimiento'])ok('fecha inválida '+field,(await handle(request('periodos',{...period,[field]:'2026-02-30'}),'periods')).status===422);
ok('cronología',(await handle(request('periodos',{...period,p_fecha_vencimiento:'2026-09-01'}),'periods')).status===422);
rpcResult={data:[],error:null};await handle(new Request('http://localhost/api/admin/compras/resumenes?tarjeta_id='+id(2)),'summaries');ok('resúmenes RPC',rpcCalls.at(-1)[0]==='listar_resumenes_tarjeta_admin');
claims={error:null,data:null};ok('sesión',(await handle(request('tarjetas',cardPayload),'cards')).status===401);
const root=createRoot(document.getElementById('root'));
let calls=[];let fail=true;
const states=['SIN_OBLIGACIONES','PENDIENTE','PAGO_PARCIAL','PAGADO'];
fetchHandler=async(url,options)=>{calls.push([url,options]);if(options?.method==='POST'){if(fail)return Response.json({error:'Incierto'},{status:502});return Response.json({result:{}});}if(url.includes('resumenes'))return Response.json({result:states.map((estado,i)=>({periodo_id:id(i+10),fecha_cierre:'2000-01-01',fecha_vencimiento:'2000-01-15',total_obligaciones_hugella:i,total_pagado:0,saldo:i,estado}))});return Response.json({result:[{id:id(2),nombre:'Visa',entidad:'Fixture',activo:true}]});};
await act(async()=>root.render(React.createElement(Cards)));
const click=async(text)=>{await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes(text)).click());};
await click('Visa');for(const state of states)ok('estado backend '+state,document.body.textContent.includes(state));
await click('+ Nueva tarjeta');
async function set(name,value){await act(async()=>{const el=document.querySelector('[name='+name+']');Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});}
await set('nombre','Nueva');await set('entidad','Entidad');
await act(async()=>document.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));
const first=calls.filter(c=>c[1]?.method==='POST').at(-1)[1].body;
await act(async()=>document.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));
ok('retry tarjeta mismo UUID/payload',calls.filter(c=>c[1]?.method==='POST').at(-1)[1].body===first);
ok('payload congelado',document.querySelector('fieldset').disabled);
fail=false;await act(async()=>document.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));
await click('+ Nuevo período');await set('cierre','2026-10-01');await set('vencimiento','2026-10-15');fail=true;
for(let n=0;n<2;n++)await act(async()=>document.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));
const posts=calls.filter(c=>c[1]?.method==='POST');ok('retry período mismo UUID/payload',posts.at(-1)[1].body===posts.at(-2)[1].body);
ok('sin service role',!readFileSync('app/api/admin/compras/handlers.ts','utf8').includes('service_role'));
ok('selección bloqueada durante período incierto',[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Visa')).disabled);
await act(async()=>root.render(null));fetchHandler=async()=>Response.json({result:[]});await act(async()=>root.render(React.createElement(Cards)));ok('sin tarjetas',document.body.textContent.includes('No hay tarjetas registradas.'));
await act(async()=>root.render(null));fetchHandler=async url=>Response.json({result:url.includes('resumenes')?[]:[{id:id(2),nombre:'Visa',entidad:'Fixture',activo:true}]});await act(async()=>root.render(React.createElement(Cards)));await click('Visa');ok('sin períodos',document.body.textContent.includes('No hay períodos registrados para esta tarjeta.'));
await click('Editar');ok('editar precarga',document.querySelector('[name=editar_nombre]').value==='Visa' && document.querySelector('[name=editar_entidad]').value==='Fixture');
let editCalls=[];fetchHandler=async(url,options)=>{if(options?.method==='POST'){editCalls.push(JSON.parse(options.body));return Response.json({error:'Incierto'},{status:502});}return Response.json({result:url.includes('resumenes')?[]:[{id:id(2),nombre:'Visa 1',entidad:'Fixture',activo:true}]});};
await click('Cancelar');ok('cancelar no escribe',editCalls.length===0);
await click('Editar');await set('editar_nombre','Visa 1');
for(let n=0;n<2;n++)await act(async()=>document.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));
ok('editar retry mismo UUID/payload',JSON.stringify(editCalls[0])===JSON.stringify(editCalls[1]));ok('editar conserva ID',editCalls[0].p_tarjeta_id===id(2));ok('editar congela campos',document.querySelector('[name=editar_nombre]').closest('fieldset').disabled);
fetchHandler=async(url,options)=>options?.method==='POST'?Response.json({result:{}}):Response.json({result:url.includes('resumenes')?[]:[{id:id(2),nombre:'Visa 1',entidad:'Fixture',activo:true}]});
await act(async()=>document.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));
ok('éxito refresca mantiene selección',document.body.textContent.includes('Visa 1') && document.querySelector('[aria-pressed=true]'));
claims={data:{claims:{sub:id(9)}}};rpcResult={data:{operacion_id:id(1),tarjeta_id:id(2)},error:null};
const editPayload={p_operacion_id:id(1),p_tarjeta_id:id(2),p_nombre:'Visa 1',p_entidad:'Fixture',p_nombre_anterior:'Visa',p_entidad_anterior:'Fixture'};
ok('API editar',(await handle(request('tarjetas/editar',editPayload),'edit-card')).status===200);ok('API RPC editar exclusiva',rpcCalls.at(-1)[0]==='editar_tarjeta_credito_admin');ok('API editar same-origin',(await handle(request('tarjetas/editar',editPayload,'http://other'),'edit-card')).status===403);
await act(async()=>root.unmount());console.log(checks+' grupos OK');
