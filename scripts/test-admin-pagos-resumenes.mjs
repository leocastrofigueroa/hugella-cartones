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
const Payment=load('app/admin/compras/summary-payment.tsx').default;
let checks=0;const ok=(n,c)=>{assert.ok(c,n);checks++;console.log('PASS',n)};
const row={periodo_id:id(2),fecha_cierre:'2026-10-22',fecha_vencimiento:'2026-11-02',total_obligaciones_hugella:300,total_pagado:100,saldo:200,estado:'PAGO_PARCIAL'};
const root=createRoot(document.getElementById('root'));let refreshed=0,calls=[],pending=false;
async function mount(r=row){await act(async()=>root.render(null));await act(async()=>root.render(React.createElement(Payment,{row:r,card:'Visa fixture',onDone:()=>refreshed++,onPending:v=>pending=v})));}
async function click(t){await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes(t)).click());}
async function set(n,v){await act(async()=>{const el=document.querySelector('[name='+n+']');Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set.call(el,v);el.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});}
async function submit(){await act(async()=>document.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));}
for(const estado of ['SIN_OBLIGACIONES','PAGADO']){await mount({...row,saldo:0,estado});ok(estado+' sin acción',!document.querySelector('button'));}
fetchHandler=async(u,o)=>{calls.push(JSON.parse(o.body));return Response.json({error:'Incierto'},{status:502});};
await mount({...row,estado:'PENDIENTE'});await click('Registrar pago');ok('saldo sugerido',document.querySelector('[name=importe_pago]').value==='200');ok('Caja Efectivo',document.body.textContent.includes('Origen')&&document.querySelector('input[readonly]').value==='Caja Efectivo');
for(const amount of ['0','-1','201']){await set('importe_pago',amount);await set('fecha_pago_resumen','2026-10-11');await submit();ok('rechaza '+amount,calls.length===0);}
await set('importe_pago','50');await set('fecha_pago_resumen','');await submit();ok('fecha obligatoria',calls.length===0);
await set('fecha_pago_resumen','2026-10-11');await submit();ok('pago parcial',calls[0].p_importe===50);ok('operación propia',/^[a-f0-9-]{36}$/.test(calls[0].p_operacion_id));ok('payload congelado',document.querySelector('fieldset').disabled&&pending);
await submit();ok('retry UUID payload',JSON.stringify(calls[0])===JSON.stringify(calls[1]));
fetchHandler=async(u,o)=>{calls.push(JSON.parse(o.body));return Response.json({result:{}});};await submit();ok('éxito refresca',refreshed===1&&!pending);
await mount();await click('Registrar pago');await set('fecha_pago_resumen','2026-10-11');await submit();ok('pago completo',calls.at(-1).p_importe===200);ok('nuevo UUID',calls.at(-1).p_operacion_id!==calls[0].p_operacion_id);
await mount();await click('Registrar pago');await set('fecha_pago_resumen','2026-10-11');let resolve;fetchHandler=async(u,o)=>{calls.push(JSON.parse(o.body));return await new Promise(r=>resolve=r);};const before=calls.length;
await act(async()=>{const form=document.querySelector('form');form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));});ok('doble submit una petición',calls.length===before+1);await act(async()=>resolve(Response.json({result:{}})));
const payload={p_operacion_id:id(1),p_periodo_id:id(2),p_fecha_pago:'2026-10-11',p_importe:50,p_referencia:null};
const request=(body,origin='http://localhost')=>new Request('http://localhost/api/admin/compras/resumenes/pagos',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
rpcResult={data:{operacion_id:id(1),pago_id:id(3)},error:null};ok('API RPC',(await handle(request(payload),'summary-payment')).status===200);ok('RPC exacta',rpcCalls.at(-1)[0]==='registrar_pago_resumen_tarjeta_admin');ok('mismo payload',JSON.stringify(rpcCalls.at(-1)[1])===JSON.stringify(payload));
ok('same-origin',(await handle(request(payload,'http://other'),'summary-payment')).status===403);
for(const p of [{...payload,p_importe:0},{...payload,p_importe:-1},{...payload,p_importe:1.001},{...payload,p_fecha_pago:''},{...payload,origen:'OTHER'}])ok('API rechazo',(await handle(request(p),'summary-payment')).status===422);
claims={data:null};ok('sesión',(await handle(request(payload),'summary-payment')).status===401);
ok('sin acceso privilegiado',!readFileSync('app/api/admin/compras/handlers.ts','utf8').includes('service_role')&&!readFileSync('app/api/admin/compras/handlers.ts','utf8').includes('.from('));
await act(async()=>root.unmount());console.log(checks+' grupos OK');
