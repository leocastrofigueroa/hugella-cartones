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
const Annul=load('app/admin/compras/annul-purchase.tsx').default;
const View=load('app/admin/compras/purchases-view.tsx').default;
let checks=0;const ok=(n,c)=>{assert.ok(c,n);checks++;console.log('PASS',n)};
const root=createRoot(document.getElementById('root'));let calls=[],refreshes=0;
async function mount(Component,props={}){await act(async()=>root.render(null));await act(async()=>root.render(React.createElement(Component,props)));}
async function click(t){await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent===t).click());}
async function reason(v){await act(async()=>{const el=document.querySelector('[name=motivo_anulacion]');Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype,'value').set.call(el,v);el.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});}
async function submit(){await act(async()=>document.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));}
await mount(Annul,{id:id(2),onDone:()=>refreshes++});await click('Anular compra');ok('warning history preserved',document.body.textContent.includes('No se borra el historial'));
await submit();ok('empty motive blocked',document.body.textContent.includes('motivo obligatorio'));await reason('Error de carga');await click('Cancelar');ok('cancel no writes',calls.length===0);
await click('Anular compra');await reason('Error de carga');await submit();ok('explicit confirmation no writes',document.body.textContent.includes('Confirmar anulación')&&calls.length===0);
let finish;fetchHandler=async(url,opts)=>{calls.push(JSON.parse(opts.body));return await new Promise(r=>finish=r);};
await act(async()=>{const form=document.querySelector('form');for(let i=0;i<2;i++)form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));});ok('double submit one HTTP',calls.length===1);
await act(async()=>finish(Response.json({error:'Resultado incierto'},{status:502})));ok('uncertain payload frozen',!document.querySelector('textarea')&&!document.body.textContent.includes('Volver a editar'));
fetchHandler=async(url,opts)=>{calls.push(JSON.parse(opts.body));return Response.json({result:{...calls.at(-1),compra_gasto_id:calls.at(-1).p_compra_gasto_id,operacion_id:calls.at(-1).p_operacion_id,estado:'ANULADA'}});};await submit();ok('retry same UUID payload',JSON.stringify(calls[0])===JSON.stringify(calls[1]));ok('confirmed refresh once',refreshes===1);ok('confirmed cannot send again',document.querySelector('button').disabled);
const payload={p_operacion_id:id(1),p_compra_gasto_id:id(2),p_motivo:'  Error de carga  '};
const request=(body,origin='http://localhost')=>new Request('http://localhost/api/admin/compras/'+id(2)+'/anular',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
rpcResult={data:{compra_gasto_id:payload.p_compra_gasto_id,operacion_id:payload.p_operacion_id,estado:'ANULADA'},error:null};ok('API success',(await handle(request(payload),'annul-purchase',id(2))).status===200);ok('API RPC only + canonical',rpcCalls.at(-1)[0]==='anular_compra_gasto_admin'&&rpcCalls.at(-1)[1].p_motivo==='Error de carga');
ok('same-origin',(await handle(request(payload,'http://other'),'annul-purchase',id(2))).status===403);
for(const v of [{...payload,p_motivo:''},{...payload,p_compra_gasto_id:id(5)},{...payload,actor_id:id(6)},{...payload,p_operacion_id:'wrong'}])ok('invalid before RPC',(await handle(request(v),'annul-purchase',id(2))).status===422);
claims={data:null};ok('no session',(await handle(request(payload),'annul-purchase',id(2))).status===401);claims={data:{claims:{sub:id(9)}}};rpcResult={data:null,error:{code:'42501'}};ok('DB admin rejection',(await handle(request(payload),'annul-purchase',id(2))).status===403);
rpcResult={data:null,error:{code:'23514',message:'La compra tiene pagos de tarjeta aplicados y requiere corrección financiera'}};const denied=await handle(request(payload),'annul-purchase',id(2));ok('clear financial correction',denied.status===409&&(await denied.json()).error.includes('corrección financiera'));
rpcResult={data:{...payload,p_compra_gasto_id:id(7),estado:'ANULADA'},error:null};ok('wrong response rejected',(await handle(request(payload),'annul-purchase',id(2))).status===502);
const audit={compra_gasto_id:id(2),operacion_id:id(1),actor_id:id(9),motivo:'Error de carga',created_at:'2026-10-13T10:00:00Z'};
const detail={id:id(2),tipo:'GASTO',fecha:'2026-10-13',moneda:'ARS',proveedor:{id:id(4),nombre:'Fixture'},items:[{id:id(8),descripcion:'Item',posicion:1,cantidad:1,costo_unitario:100,total:100}],total:100,created_at:'2026-10-13T10:00:00Z',anulacion:audit};
fetchHandler=async()=>Response.json({result:detail});await mount(View,{id:id(2)});ok('detail cancellation motive actor date',document.body.textContent.includes('ANULADA')&&document.body.textContent.includes('Error de carga')&&document.body.textContent.includes(id(9)));ok('canceled explicit zero operative balance',document.body.textContent.includes('Saldo operativo pendiente:')&&document.body.textContent.includes('0,00')&&document.body.textContent.includes('importes originales se conservan'));ok('canceled cannot annul again',![...document.querySelectorAll('button')].some(b=>b.textContent==='Anular compra'));
fetchHandler=async()=>Response.json({result:[{...detail,proveedor_nombre:'Fixture',observaciones:'PRUEBA TÉCNICA'}]});await mount(View);ok('list actual canceled plus old technical marker',document.body.textContent.includes('ANULADA')&&document.body.textContent.includes('PRUEBA TÉCNICA'));
let canceled=false;fetchHandler=async(url,opts)=>{if(opts?.method==='POST'){canceled=true;const p=JSON.parse(opts.body);return Response.json({result:{compra_gasto_id:p.p_compra_gasto_id,operacion_id:p.p_operacion_id,estado:'ANULADA'}});}return Response.json({result:canceled?detail:{...detail,anulacion:null}});};await mount(View,{id:id(2)});await click('Anular compra');await reason('Error de carga');await submit();await submit();ok('full detail refresh shows audit',canceled&&document.body.textContent.includes('ANULADA')&&![...document.querySelectorAll('button')].some(b=>b.textContent==='Anular compra'));
ok('no privileged or direct table access',!readFileSync('app/api/admin/compras/handlers.ts','utf8').includes('service_role')&&!readFileSync('app/api/admin/compras/handlers.ts','utf8').includes('.from('));
await act(async()=>root.unmount());console.log(checks+' grupos OK');
