// Real React components, mocked RPC transport, no SQL/network or credentials.
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url), React=require('react'), ts=require('typescript');
const {JSDOM}=require('jsdom');
const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'});
globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const {createRoot}=require('react-dom/client');const {act}=React;
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const fixture={credito_id:id(1),cliente_id:id(3),nombre:'Nombre fixture',dni:'12345678',telefono:null,domicilio:null,ubicacion:null,codigo:'CR-fixture',producto:'Producto',origen:'SHEETS',fecha_inicio:'2026-10-13',fecha_fin_prevista:'2027-05-27',fecha_evaluacion:'2026-10-14',cantidad_cuotas:195,importe_cuota:100,total_contractual:19500,inversion:null,ganancia_prevista:null,cuota_recuperacion_inversion:null,total_pagado_valido:150,cuotas_completas_pagadas:1,remanente_actual:50,cuotas_equivalentes_monetarias:1.5,cuotas_plan_no_pagadas:194,saldo_por_cuotas_completas:19400,saldo_monetario_real:19350,cuotas_exigibles:2,diferencia_cuotas:-1,cuotas_atrasadas:1,importe_atrasado:50,estado:'ATRASADO',tipo_cierre:null,fecha_cierre:null,cobranza_futura_habilitada:true,calculos_solo_historicos:false};
let dashboardMocks={};
let handler=async()=>({data:fixture,error:null}),calls=[];const cache=new Map();
function load(file){file=path.resolve(file);if(cache.has(file))return cache.get(file);const mod={exports:{}};vm.runInNewContext(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,{module:mod,exports:mod.exports,URL,Date,console,require(name){if(file.endsWith('admin-dashboard.tsx') && dashboardMocks[name]) return {__esModule:true,default:dashboardMocks[name]}; if(name.endsWith('.module.css'))return {};if(name==='next/navigation')return {useRouter:()=>({replace(){}})};if(name==='next/image')return {__esModule:true,default:()=>null};if(name==='next/link')return {__esModule:true,default:({children,...props})=>React.createElement('a',props,children)};if(name==='@/utils/supabase/client')return {createClient:()=>({rpc:(name,args)=>{calls.push({name,args});return handler(name,args);}})};if(name.startsWith('.')){const base=path.resolve(path.dirname(file),name);return load(base+(existsSync(base+'.tsx')?'.tsx':'.ts'));}return require(name);}});cache.set(file,mod.exports);return mod.exports;}
const types=load('app/admin/admin-types.ts'),Full=load('app/admin/credit-full-detail.tsx').default;
assert(types.isCreditFicha(fixture,id(1)));for(const f of [null,{}, {...fixture,credito_id:id(2)},{...fixture,total_pagado_valido:NaN},{...fixture,inversion:undefined}])assert(!types.isCreditFicha(f,id(1)));
let root=createRoot(document.getElementById('root'));const text=()=>document.body.textContent;
const render=async(creditId=id(1),refreshVersion=0)=>act(async()=>root.render(React.createElement(Full,{creditId,refreshVersion})));
const click=async(label)=>act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes(label)).click());
const dd=label=>[...document.querySelectorAll('dt')].find(d=>d.textContent===label)?.nextElementSibling.textContent;
await render();const closedMarkup=document.getElementById('root').innerHTML;assert(document.querySelector('button').classList.contains('w-full'));assert.equal(document.querySelector('button').getAttribute('aria-expanded'),'false');assert(document.querySelector('[hidden]'));assert(!document.querySelector('button').parentElement.classList.contains('p-5'));assert.equal(calls.length,0);await click('Ver ficha completa del crédito');assert.equal(calls.length,1);assert.equal(calls[0].name,'obtener_ficha_credito_admin');
for(const title of ['Cliente','Crédito / plan','Economía','Pagos y saldos','Situación actual'])assert(text().includes(title));
assert.equal(dd('Inversión'),'Sin informar');assert.equal(dd('Ubicación'),'Sin informar');assert.equal(dd('Cuotas completas pagadas'),'1');assert.equal(dd('Cuotas equivalentes monetarias (incluyen parciales)'),'1,5');assert(dd('Saldo monetario real').includes('19.350'));assert(text().includes('14/10/2026'));assert.equal(document.querySelector('button').getAttribute('aria-expanded'),'true');assert(document.getElementById(document.querySelector('button').getAttribute('aria-controls')));
await click('Ficha completa del crédito');assert.equal(calls.length,1);await render(id(1),1);assert.equal(calls.length,1);await click('Ver ficha completa del crédito');assert.equal(calls.length,2);
const pending=[];handler=()=>new Promise(resolve=>pending.push(resolve));await render(id(1),2);assert(text().includes('Consultando'));assert(!text().includes('Nombre fixture'));await render(id(2),2);await act(async()=>pending[1]({data:{...fixture,credito_id:id(2),nombre:'B'},error:null}));assert(text().includes('B'));await act(async()=>pending[0]({data:fixture,error:null}));assert(!text().includes('Nombre fixture'));
handler=async()=>({data:null,error:{code:'42501'}});await render(id(2),3);assert(document.querySelector('[role="alert"]'));handler=async()=>({data:{...fixture,credito_id:id(2)},error:null});await click('Reintentar consulta');assert(!document.querySelector('[role="alert"]'));
handler=async()=>({data:{},error:null});await render(id(2),4);assert(document.querySelector('[role="alert"]'));
for(const tipo of ['DEVUELTO','RETIRADO']){handler=async()=>({data:{...fixture,credito_id:id(2),origen:'ADMIN',tipo_cierre:tipo,fecha_cierre:'2026-10-14',cobranza_futura_habilitada:false,calculos_solo_historicos:true,ubicacion:'https://example.com/maps'},error:null});await render(id(2),tipo==='DEVUELTO'?5:6);assert(text().includes('Cierre: '+tipo));assert(text().includes('Sin cobranza futura'));assert(text().includes('históricos'));assert.equal(document.querySelector('a').protocol,'https:');assert.equal(document.querySelector('a').getAttribute('rel'),'noopener noreferrer');}
for(const ubicacion of ['javascript:alert(1)','www.example.com','Referencia '+ 'Largo'.repeat(100)]){handler=async()=>({data:{...fixture,credito_id:id(2),ubicacion},error:null});await render(id(2),Math.random());assert.equal(document.querySelector('a'),null);assert(text().includes(ubicacion));}

// Dashboard orchestration uses real handlers and real ficha; sibling forms are probes.
if (process.argv.includes('--responsive')) {
 const fs=require('node:fs/promises'),os=require('node:os'),{spawn}=require('node:child_process');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hugella-ficha-responsive-'));
 const css=(await require('postcss')([require('@tailwindcss/postcss')()]).process(readFileSync('app/globals.css','utf8'),{from:path.resolve('app/globals.css')})).css;
 await fs.writeFile(path.join(dir,'fixture.html'),'<meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style><main id="closed-preview" style="padding:16px">'+closedMarkup+'</main><main style="padding:16px">'+document.getElementById('root').innerHTML+'</main>');
 const chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--remote-debugging-pipe','--user-data-dir='+path.join(dir,'profile')],{stdio:['ignore','ignore','ignore','pipe','pipe']});
 let serial=0,buffer='',pending=new Map();
 chrome.stdio[4].on('data',chunk=>{buffer+=chunk;let index;while((index=buffer.indexOf('\0'))>=0){const message=JSON.parse(buffer.slice(0,index));buffer=buffer.slice(index+1);if(message.id&&pending.has(message.id)){const {resolve,reject,timer}=pending.get(message.id);clearTimeout(timer);pending.delete(message.id);if(message.error)reject(new Error(JSON.stringify(message.error)));else resolve(message.result);}}});
 const call=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>reject(new Error('Chrome timeout '+method)),15000);pending.set(id,{resolve,reject,timer});chrome.stdio[3].write(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})})+'\0');});
 try {
  const {targetId}=await call('Target.createTarget',{url:'about:blank'});
  const {sessionId}=await call('Target.attachToTarget',{targetId,flatten:true});
  await call('Page.enable',{},sessionId);
  for(const width of [320,375,768,1280]) {
   await call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<768},sessionId);
   await call('Page.navigate',{url:'file://'+path.join(dir,'fixture.html')},sessionId);
   let measured;
   for(let attempt=0;attempt<50;attempt++) { const r=await call('Runtime.evaluate',{expression:'document.readyState === "complete" && document.querySelector("dl") ? JSON.stringify({width:innerWidth,scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth,rows:document.querySelectorAll("dd").length,closedHeight:document.querySelector("#closed-preview section").getBoundingClientRect().height,closedWidth:document.querySelector("#closed-preview section").clientWidth,buttonWidth:document.querySelector("#closed-preview button").getBoundingClientRect().width}) : null',returnByValue:true},sessionId);if(r.result.value){measured=JSON.parse(r.result.value);break;}await new Promise(resolve=>setTimeout(resolve,50)); }
   assert(measured);assert.equal(measured.width,width);assert(measured.scroll<=measured.client,JSON.stringify(measured));assert(measured.rows>=24);assert(measured.closedHeight<=80,JSON.stringify(measured));assert.equal(measured.buttonWidth,measured.closedWidth);
   console.log('PASS: real Chrome layout '+width+'px, no horizontal overflow with long location text.');
  }
 } finally {const stopped=new Promise(resolve=>chrome.once('exit',resolve));chrome.kill();await stopped;await fs.rm(dir,{recursive:true,force:true});}
}
await act(async()=>root.unmount());root=createRoot(document.getElementById('root'));
let paymentProps,historyProps,closureProps, mounts=0;
function Probe({kind,...props}){React.useEffect(()=>{mounts++;},[]);if(kind==='payment')paymentProps=props;if(kind==='history')historyProps=props;if(kind==='closure')closureProps=props;return React.createElement('input',{'data-probe':kind,defaultValue:'draft'});}
dashboardMocks={
 './credit-search':props=>React.createElement('button',{onClick:()=>props.onChange('Cliente')},'Preparar búsqueda'),
 './credit-results':props=>React.createElement('button',{onClick:()=>props.onSelect(props.credits[0])},'Seleccionar'),
 './payment-form':props=>React.createElement(Probe,{kind:'payment',...props}),
 './payment-history':props=>React.createElement(Probe,{kind:'history',...props}),
 './credit-closure':props=>React.createElement(Probe,{kind:'closure',...props}),
 './contract-form':props=>React.createElement(Probe,{kind:'contract',...props}),
};
// Search probe keeps query and submit in separate renders, like the actual controlled form.
dashboardMocks['./credit-search']=props=>React.createElement('div',null,React.createElement('button',{onClick:()=>props.onChange('Cliente')},'Preparar búsqueda'),React.createElement('button',{onClick:props.onSearch},'Buscar'));
const credit={credito_id:id(1),nombre_cliente:'Nombre fixture',codigo_credito:'CR-fixture',producto:'Producto',importe_cuota:100,cantidad_cuotas:195,cuotas_pagadas:1,cuotas_pendientes:194,diferencia_cuotas:-1,estado:'ATRASADO'};
let failFicha=false;
handler=async(name,args)=>{
 if(name==='buscar_creditos_admin')return {data:[credit],error:null};
 if(name==='obtener_historial_pagos_admin')return {data:[],error:null};
 if(name==='obtener_ficha_credito_admin')return failFicha?{data:null,error:{code:'42501'}}:{data:fixture,error:null};
 if(name==='registrar_pago_admin')return {data:[{pago_id:id(8),cuotas_aplicadas:1,remanente:50}],error:null};
 if(name==='corregir_pago_admin')return {data:[{operacion_id:args.p_operacion_id,pago_original_id:args.p_pago_id,pago_nuevo_id:id(9),credito_id:id(1)}],error:null};
 if(name==='anular_pago_admin')return {data:[{pago_id:args.p_pago_id,estado_pago:'ANULADO'}],error:null};
 if(name==='cerrar_credito_admin')return {data:[{credito_id:id(1),operacion_id:args.p_operacion_id,tipo:args.p_tipo}],error:null};
 throw new Error('Unexpected RPC '+name);
};
const Dashboard=load('app/admin/admin-dashboard.tsx').default;
await act(async()=>root.render(React.createElement(Dashboard,{email:'fixture'})));
await click('Preparar búsqueda');await click('Buscar');await click('Seleccionar');
const before=calls.filter(c=>c.name==='obtener_ficha_credito_admin').length;
const field=document.querySelector('[data-probe="payment"]');field.value='unsaved';const mounted=mounts;
await click('Ver ficha completa del crédito');await click('Ficha completa del crédito');assert.equal(document.querySelector('[data-probe="payment"]'),field);assert.equal(field.value,'unsaved');assert.equal(mounts,mounted);
await click('Ver ficha completa del crédito');
const input={p_importe:100,p_fecha_pago:'2026-10-14',p_medio_pago:'Efectivo',p_observaciones:null};
let count=calls.filter(c=>c.name==='obtener_ficha_credito_admin').length;
failFicha=true;await act(async()=>paymentProps.onPayment(input));assert(text().includes('Pago registrado'));assert(document.querySelector('[role="alert"]'));assert.equal(calls.filter(c=>c.name==='obtener_ficha_credito_admin').length,count+1);
failFicha=false;count++;
await act(async()=>assert.equal(await historyProps.onCorrect({pago_id:id(8)},{...input,p_motivo:'Fixture'},id(10)),null));assert.equal(calls.filter(c=>c.name==='obtener_ficha_credito_admin').length,++count);
await act(async()=>assert.equal(await historyProps.onAnnul({pago_id:id(8),importe:100},'Fixture',id(11)),null));assert.equal(calls.filter(c=>c.name==='obtener_ficha_credito_admin').length,++count);
await act(async()=>assert.equal(await closureProps.onClose({p_tipo:'RETIRADO',p_fecha:'2026-10-14',p_motivo:'Fixture',p_observaciones:null},id(12)),null));assert.equal(calls.filter(c=>c.name==='obtener_ficha_credito_admin').length,++count);
assert.equal(calls.find(c=>c.name==='corregir_pago_admin').args.p_operacion_id,id(10));assert.equal(calls.find(c=>c.name==='anular_pago_admin').args.p_operacion_id,id(11));assert.equal(calls.find(c=>c.name==='cerrar_credito_admin').args.p_operacion_id,id(12));assert(count>before);
await click('Ficha completa del crédito');const closedCount=calls.filter(c=>c.name==='obtener_ficha_credito_admin').length;await act(async()=>historyProps.onAnnul({pago_id:id(8),importe:100},'Fixture',id(13)));assert.equal(calls.filter(c=>c.name==='obtener_ficha_credito_admin').length,closedCount);
await act(async()=>root.unmount());dom.window.close();
console.log('PASS: real dashboard refresh after payment/correction/annulment/closure; ficha failure retains successful operation; closed ficha does not fetch; disclosure preserves sibling DOM/drafts/mounts and operation UUIDs.');
console.log('PASS: complete render, NULL, partials, origins, closures, lazy load, stale A→B responses, invalid response, errors/retry, refresh versions, safe location links and disclosure accessibility; no SQL/network.');
