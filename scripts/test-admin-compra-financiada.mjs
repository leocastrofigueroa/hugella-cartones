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
const supplier={id:id(2),nombre:'Proveedor fixture',identificacion_fiscal:null,contacto:null,observaciones:null};
const detail={id:id(3),tipo:'MERCADERIA',fecha:'2026-10-10',moneda:'ARS',proveedor:supplier,proveedor_nombre:supplier.nombre,comprobante:null,observaciones:null,created_at:'2026-10-10T12:00:00Z',total:1.01,cantidad_items:1,items:[{id:id(4),posicion:1,descripcion:'Producto',cantidad:3,costo_unitario:0.335,total:1.01}]};
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
const payments=load('app/admin/compras/payment-types.ts');
const {handle}=load('app/api/admin/compras/handlers.ts');
const Form=load('app/admin/compras/new-purchase-form.tsx').default;
let checks=0; function check(label,fn){fn();checks++;console.log('PASS:',label);}
const root=createRoot(document.getElementById('root'));const query=s=>document.querySelector(s);const text=()=>document.body.textContent;
async function mount(Component,props={}){await act(async()=>{root.render(null)});await act(async()=>{root.render(React.createElement(Component,props))});}
async function set(name,value){await act(async()=>{const el=query(`[name="${name}"]`);const setter=Object.getOwnPropertyDescriptor(el.tagName==='SELECT'?dom.window.HTMLSelectElement.prototype:dom.window.HTMLInputElement.prototype,'value').set;setter.call(el,value);el.dispatchEvent(new dom.window.Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));});}
async function submit(id){await act(async()=>query('#'+id).dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));}
async function click(label){await act(async()=>{const el=[...document.querySelectorAll('button')].find(b=>b.textContent===label);assert.ok(el,label);el.click();});}
const validBase={p_operacion_id:id(1),p_tipo:'GASTO',p_proveedor_id:supplier.id,p_fecha:'2026-10-10',p_moneda:'ARS',p_comprobante:null,p_observaciones:null,p_items:[{posicion:1,descripcion:'Fixture',cantidad:1,costo_unitario:100}]};
const draft={...payments.emptyPayment(),fecha:'2026-10-10'};
const card={id:id(10),nombre:'Visa fixture',entidad:'Banco fixture',activo:true};
const tranches=(mode,drafts=[draft],total=100n)=>payments.buildTranches(total,mode,drafts);
for(const medio of ['EFECTIVO','TRANSFERENCIA','TARJETA_DEBITO'])check(medio+' simple amount automatic/date valid',()=>{
 const t=tranches(medio,[{...draft,importe:'1'}],10000n);assert.equal(t[0].importe,100);assert.equal(t[0].medio,medio);assert.equal(t[0].fecha_pago,draft.fecha);assert.ok(payments.validateFinancedPurchase({...validBase,p_tramos:t}));
});
check('exact 100/3 preview',()=>assert.deepEqual([...payments.installments(10000n,3)],[3334n,3333n,3333n]));
check('credit card and optional NULL period',()=>{const t=tranches('TARJETA_CREDITO',[{...draft,tarjeta:card.id,cuotas:'3'}],10000n);assert.equal(t[0].primer_periodo_id,null);assert.equal(t[0].fecha_pago,null);assert.ok(payments.validateFinancedPurchase({...validBase,p_tramos:t}));});
check('no card cannot build credit',()=>assert.equal(tranches('TARJETA_CREDITO',[draft],10000n),null));
check('combined exact and never atomic COMBINADO',()=>{const t=tranches('COMBINADO',[{...draft,importe:'40'},{...draft,medio:'TARJETA_CREDITO',importe:'60',tarjeta:card.id,cuotas:'3'}],10000n);assert.ok(payments.validateFinancedPurchase({...validBase,p_tramos:t}));assert.equal(t.length,2);assert.equal(t.some(x=>x.medio==='COMBINADO'),false);});
check('combined mismatch, one tranche, zero and negative rejected',()=>{for(const amount of ['59.99','60.01','-1','0'])assert.equal(tranches('COMBINADO',[{...draft,importe:'40'},{...draft,importe:amount}],10000n),null);assert.equal(tranches('COMBINADO',[draft],10000n),null);});
check('zero total empty payment array, no invented fact',()=>{assert.equal(tranches('EFECTIVO',[draft],0n).length,0);assert.ok(payments.validateFinancedPurchase({...validBase,p_items:[{...validBase.p_items[0],costo_unitario:0}],p_tramos:[]}));});
check('lossy money/date/precision/count rejected',()=>{assert.equal(payments.centsNumber(999999999999999999n),null);assert.equal(payments.paymentCents('1.001'),null);assert.equal(tranches('EFECTIVO',[{...draft,fecha:'2026-02-30'}],10000n),null);assert.equal(tranches('TARJETA_CREDITO',[{...draft,tarjeta:card.id,cuotas:'1.5'}],10000n),null);});
const valid={...validBase,p_tramos:tranches('EFECTIVO',[draft],10000n)};
check('server rejects tampered totals/medium/actor/date/UUID and strings',()=>{for(const bad of [{...valid,total:100},{...valid,actor_id:id(5)},{...valid,p_tramos:[]},{...valid,p_tramos:[{...valid.p_tramos[0],medio:'COMBINADO'}]},{...valid,p_tramos:[{...valid.p_tramos[0],importe:99}]},{...valid,p_tramos:[{...valid.p_tramos[0],importe:'100'}]},{...valid,p_tramos:[{...valid.p_tramos[0],fecha_pago:'2026-02-30'}]},{...valid,p_tramos:[{...valid.p_tramos[0],tarjeta_id:card.id}]}])assert.equal(payments.validateFinancedPurchase(bad),false);});
async function api(body,kind='financed',method='POST',origin='http://localhost') { return handle(new Request('http://localhost/api/admin/compras/financiadas',{method,headers:{origin,'Content-Type':'application/json'},...(method==='POST'?{body:JSON.stringify(body)}:{})}),kind); }
rpcCalls=[];rpcResult={data:{operacion_id:id(1),compra_id:id(3),estado:'CONFIRMADA'},error:null};
assert.equal((await api(valid)).status,200);
check('one atomic RPC only, session client, full payload',()=>{assert.equal(rpcCalls.length,1);assert.equal(rpcCalls[0][0],'crear_compra_financiada_admin');assert.deepEqual(JSON.parse(JSON.stringify(rpcCalls[0][1])),JSON.parse(JSON.stringify(valid)));});
rpcCalls=[];assert.equal((await api({...valid,p_tramos:[]})).status,422);check('API validates before RPC',()=>assert.equal(rpcCalls.length,0));
claims={data:{claims:null}};assert.equal((await api(valid)).status,401);check('API no session blocked',()=>assert.equal(rpcCalls.length,0));claims={data:{claims:{sub:id(9)}}};
assert.equal((await api(valid,'financed','POST','https://evil.test')).status,403);check('same origin protection',()=>assert.equal(rpcCalls.length,0));
rpcResult={data:null,error:{code:'42501'}};assert.equal((await api(valid)).status,403);checks++;console.log('PASS: DB final Admin rejection');
rpcResult={data:{operacion_id:id(999),compra_id:id(3)},error:null};assert.equal((await api(valid)).status,502);checks++;console.log('PASS: uncertain response UUID rejected');
rpcResult={data:[],error:null};rpcCalls=[];assert.equal((await api(null,'cards','GET')).status,200);check('cards only read RPC',()=>assert.equal(rpcCalls.at(-1)[0],'listar_tarjetas_financieras_admin'));
await handle(new Request('http://localhost/api/admin/compras/periodos?tarjeta_id='+card.id),'periods');check('periods paginated RPC',()=>{assert.equal(rpcCalls.at(-1)[0],'listar_periodos_tarjeta_admin');assert.equal(rpcCalls.at(-1)[1].p_limite,100);});
check('no privileged client or independent finance calls',()=>{const source=readFileSync('app/api/admin/compras/handlers.ts','utf8');assert.doesNotMatch(source,/service_role|supabase\/admin|confirmar_financiacion_compra_admin/);assert.match(source,/supabase\/server/);});
let sent=[];let fail=false;let configured=true;
fetchHandler=async(url,options)=>{
 if(url.includes('/tarjetas'))return Response.json({result:configured?[card]:[]});
 if(url.includes('/periodos'))return Response.json({result:[]});
 if(url.includes('/proveedores'))return Response.json({result:[supplier]});
 if(options?.method==='POST'){sent.push({url,body:JSON.parse(options.body)});return fail?Response.json({error:'Incierto'},{status:502}):Response.json({result:{operacion_id:JSON.parse(options.body).p_operacion_id,compra_id:id(3)}});}
 if(url.includes('/comprobantes'))return Response.json({result:[]});
 return Response.json({result:detail});
};
async function prepare(){await mount(Form);await submit('supplier-search');await click('Proveedor fixture');await set('fecha','2026-10-10');await set('descripcion-0','Producto');await set('costo-0','100');await set('fecha-pago-0','2026-10-10');}
for(const mode of ['EFECTIVO','TRANSFERENCIA','TARJETA_DEBITO']){await prepare();await set('forma-pago',mode);await submit('purchase-data');assert.match(text(),/Formas de pago/);await submit('purchase-confirm');check('UI '+mode+' atomic and receipts retained',()=>{assert.equal(sent.at(-1).url,'/api/admin/compras/financiadas');assert.equal(sent.at(-1).body.p_tramos[0].medio,mode);assert.match(text(),/registrada correctamente/);assert.match(text(),/Comprobantes digitales/);});}
configured=false;await prepare();await set('forma-pago','TARJETA_CREDITO');check('empty cards explicit and review disabled',()=>{assert.match(text(),/No hay tarjetas de crédito configuradas/);assert.ok([...document.querySelectorAll('button')].find(b=>b.textContent==='Revisar antes de guardar').disabled);});
configured=true;await prepare();await set('forma-pago','TARJETA_CREDITO');await set('tarjeta-0',card.id);await set('cuotas-0','3');check('credit exact preview and missing periods allowed',()=>{assert.match(text(),/1: 33,34/);assert.match(text(),/2: 33,33/);assert.equal(query('[name="periodo-0"]').value,'');});
await submit('purchase-data');check('frozen credit summary',()=>{assert.match(text(),/Visa fixture/);assert.match(text(),/3 cuotas/);});fail=true;await submit('purchase-confirm');const frozen=sent.at(-1).body;fail=false;await submit('purchase-confirm');check('retry same operation and payload',()=>assert.deepEqual(sent.at(-1).body,frozen));
await prepare();await set('forma-pago','COMBINADO');await set('importe-0','40');await set('importe-1','59.99');check('combined permanent totals mismatch disabled',()=>{assert.match(text(),/Falta distribuir: 0,01/);assert.ok([...document.querySelectorAll('button')].find(b=>b.textContent==='Revisar antes de guardar').disabled);});await set('importe-1','60');await set('fecha-pago-1','2026-10-10');await submit('purchase-data');await submit('purchase-confirm');check('combined two real media persisted',()=>{assert.equal(sent.at(-1).body.p_tramos.length,2);assert.equal(sent.at(-1).body.p_tramos.some(t=>t.medio==='COMBINADO'),false);});
await prepare();await set('costo-0','0');check('zero total explanatory UI',()=>assert.match(text(),/no requiere distribución de pago/));await submit('purchase-data');await submit('purchase-confirm');check('zero UI request empty tranches',()=>assert.equal(sent.at(-1).body.p_tramos.length,0));
await act(async()=>root.unmount());console.log(`PASS: ${checks} groups; offline only`);
