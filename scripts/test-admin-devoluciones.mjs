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
const {POST}=load('app/api/admin/compras/[id]/finanzas/route.ts');
const Actions=load('app/admin/compras/financial-actions.tsx').default;
let checks=0;const ok=(n,c)=>{assert.ok(c,n);checks++;console.log('PASS',n)};
const root=createRoot(document.getElementById('root'));let refreshed=0,calls=[];
const finance={estado:'PENDIENTE',estado_financiacion:'CONFIRMADA',total_pagado:50,total_corte_historico:10,saldo_pendiente:40,formas_pago:[{tramo_id:id(3),medio:'TARJETA_CREDITO',tarjeta_nombre:'Tarjeta sintética',tarjeta_id:id(4),importe:100}],cuotas:[{obligacion_id:id(5),numero_cuota:1,importe:40,saldo:40,estado:'PENDIENTE',fecha_cierre:'2027-01-01',total_aplicado:0,importe_corte_historico:0},{obligacion_id:id(6),numero_cuota:2,importe:60,saldo:0,estado:'PAGADA',fecha_cierre:null,total_aplicado:50,importe_corte_historico:10}],devoluciones:[{id:id(7),tarjeta_id:id(4),importe_esperado:30,importe_acreditado:10,importe_pendiente:20,estado:'PARCIAL',acreditaciones:[]}]};
async function mount(f=finance){await act(async()=>root.render(null));await act(async()=>root.render(React.createElement(Actions,{id:id(2),finance:f,onDone:()=>refreshed++})));}
async function click(t){await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes(t)).click());}
async function set(selector,v){await act(async()=>{const el=document.querySelector(selector);const proto=el.tagName==='SELECT'?dom.window.HTMLSelectElement.prototype:dom.window.HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,v);el.dispatchEvent(new dom.window.Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));});}
async function submit(){await act(async()=>document.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));}
fetchHandler=async(u,o)=>{if(!o?.body)return Response.json({result:[{id:id(8),fecha_cierre:'2027-01-01',fecha_vencimiento:'2027-01-10'}]});calls.push(JSON.parse(o.body));return Response.json({error:'Incierto'},{status:502});};
// Fixture sintética: dos cierres y una cuota aún sin período; ninguna selección automática.
const historical={...finance,cuotas:[
 {...finance.cuotas[0],fecha_cierre:'2026-10-22'},
 {...finance.cuotas[0],obligacion_id:id(20),numero_cuota:2,fecha_cierre:'2026-11-19'},
 {...finance.cuotas[0],obligacion_id:id(21),numero_cuota:3,fecha_cierre:null}
]};
await mount(historical);await click('Cancelar compra');
ok('sin fecha explica por qué no hay casillas',document.querySelectorAll('input[type=checkbox]').length===0&&document.body.textContent.includes('Ingresá la fecha de cancelación'));
await set('input[type=date]','2026-11-01');
ok('pendiente cerrada excluida; futura y sin período disponibles',document.querySelectorAll('input[type=checkbox]').length===2&&document.body.textContent.includes('cierre 22/10/2026 anterior o igual')&&document.body.textContent.includes('Sin período asignado'));
ok('cuotas disponibles requieren confirmación explícita',![...document.querySelectorAll('input[type=checkbox]')].some(q=>q.checked)&&calls.length===0);
await act(async()=>document.querySelector('input[type=checkbox]').click());
await set('input[type=date]','2026-11-19');
ok('cierre igual excluido y cambio de fecha limpia selección',document.querySelectorAll('input[type=checkbox]').length===1&&!document.querySelector('input[type=checkbox]').checked);
await mount({...historical,cuotas:historical.cuotas.slice(0,2)});await click('Cancelar compra');await set('input[type=date]','2026-12-01');
ok('sin cuotas elegibles muestra motivo y mensaje',document.querySelectorAll('input[type=checkbox]').length===0&&document.body.textContent.includes('No hay cuotas elegibles'));
await mount();await click('Cancelar compra');await set('input[type=date]','2026-12-01');
ok('pagos reales y corte permanecen excluidos y explicados',document.querySelectorAll('input[type=checkbox]').length===1&&document.body.textContent.includes('registra pagos'));
await mount({...finance,cuotas:[{...finance.cuotas[0],total_aplicado:0,importe_corte_historico:10}]});await click('Cancelar compra');await set('input[type=date]','2026-12-01');
ok('corte histórico conserva exclusión',document.querySelectorAll('input[type=checkbox]').length===0&&document.body.textContent.includes('registra un corte histórico'));
await mount();ok('muestra pagos y expectativa separada',document.body.textContent.includes('Pagos reales')&&document.body.textContent.includes('Esperada:')&&document.body.textContent.includes('Acreditada:'));
await click('Cancelar compra');await set('input[type=date]','2026-12-01');await set('input[maxlength="1000"]','Fixture');ok('sólo cuota futura sin pagos ni corte',document.querySelectorAll('input[type=checkbox]').length===1);
await act(async()=>document.querySelector('input[type=checkbox]').click());await submit();ok('cancelación explícita de cuotas',calls[0].p_accion==='CANCELAR'&&calls[0].p_datos.obligaciones[0]===id(5));ok('resultado incierto congela datos',document.querySelector('fieldset').disabled);await submit();ok('reintento mismo UUID y payload',JSON.stringify(calls[0])===JSON.stringify(calls[1]));
fetchHandler=async(u,o)=>{calls.push(JSON.parse(o.body));return Response.json({result:{}});};await submit();ok('éxito refresca',refreshed===1);
await mount();await click('Registrar devolución esperada');await set('input[type=date]','2026-12-01');await set('input[maxlength="1000"]','Reintegro');await set('select',id(3));await set('input[inputmode=decimal]','20,25');await submit();ok('devolución esperada usa importe decimal exacto',calls.at(-1).p_accion==='DEVOLUCION'&&calls.at(-1).p_datos.importe===20.25);
fetchHandler=async(u,o)=>{if(!o?.body)return Response.json({result:[{id:id(8),fecha_cierre:'2027-01-01',fecha_vencimiento:'2027-01-10'}]});calls.push(JSON.parse(o.body));return Response.json({result:{}});};
await mount();await click('Acreditar devolución');await set('input[type=date]','2026-12-01');await set('select',id(7));ok('carga períodos de la tarjeta',document.querySelectorAll('select')[1].options.length===2);await act(async()=>{const el=document.querySelectorAll('select')[1];Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype,'value').set.call(el,id(8));el.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});await set('input[inputmode=decimal]','10');await submit();ok('acreditación elige resumen real',calls.at(-1).p_accion==='ACREDITAR'&&calls.at(-1).p_datos.periodo_id===id(8));
await mount({...finance,estado:'FINANCIACION_HISTORICA_SIN_IMPORTE_OPERATIVO',estado_financiacion:'EVIDENCIA_HISTORICA',formas_pago:[],cuotas:[]});ok('documental sin acciones financieras',document.querySelectorAll('button').length===0);
const payload={p_operacion_id:id(1),p_accion:'DEVOLUCION',p_datos:{fecha:'2026-12-01',motivo:'Fixture',tramo_id:id(3),importe:20}};
const request=(b,origin='http://localhost')=>new Request('http://localhost/api/admin/compras/'+id(2)+'/finanzas',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(b)});
const post=(b=payload,origin)=>POST(request(b,origin),{params:Promise.resolve({id:id(2)})});
rpcResult={data:{operacion_id:id(1),compra_id:id(2),accion:'DEVOLUCION',id:id(9)},error:null};ok('API RPC y resultado validado',(await post()).status===200&&rpcCalls.at(-1)[0]==='operar_devolucion_compra_admin');
ok('API origen',(await post(payload,'http://other')).status===403);
for(const b of [{...payload,extra:true},{...payload,p_accion:'OTRA'},{...payload,p_datos:{...payload.p_datos,importe:0}},{...payload,p_datos:{...payload.p_datos,importe:1.001}},{...payload,p_datos:{...payload.p_datos,fecha:'2026-02-30'}}])ok('API datos inválidos',(await post(b)).status===422);
rpcResult={error:{code:'23514'},data:null};ok('error financiero definitivo',(await post()).status===409);
rpcResult={error:{code:'42501'},data:null};ok('permisos SQL',(await post()).status===403);
claims={data:null};ok('API exige sesión',(await post()).status===401);
await act(async()=>root.unmount());console.log(checks+' grupos OK');
