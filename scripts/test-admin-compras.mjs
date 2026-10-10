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
const input={p_operacion_id:id(1),p_tipo:'MERCADERIA',p_proveedor_id:id(2),p_fecha:'2026-10-10',p_moneda:'ARS',p_comprobante:null,p_observaciones:null,p_items:[{posicion:1,descripcion:'Producto',cantidad:3,costo_unitario:0.335}]};
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
const types=load('app/admin/compras/purchase-types.ts'); const {handle}=load('app/api/admin/compras/handlers.ts');
const Form=load('app/admin/compras/new-purchase-form.tsx').default; const View=load('app/admin/compras/purchases-view.tsx').default;
let checks=0;
function check(name,fn){fn();checks++;console.log('PASS:',name);}
async function api(body,kind='purchase',method='POST',origin='http://localhost'){
 const response=await handle(new Request('http://localhost/api/admin/'+kind,{method,headers:{origin,'Content-Type':'application/json'},...(method==='POST'?{body:JSON.stringify(body)}:{})}),kind,id(3));return response;
}
check('exact decimal round per item',()=>{assert.equal(types.subtotal('3','0,335'),BigInt(101));assert.equal(types.displayCents(BigInt(101)),'1,01');});
check('six decimals and no lossy conversion',()=>{assert.equal(types.decimalNumber('0.0000001',true),null);assert.equal(types.decimalNumber('999999999999.123456',true),null);assert.equal(types.decimalNumber('1,25',true),1.25);});
check('valid MERCADERIA/GASTO',()=>{assert.ok(types.validatePurchase(input));assert.ok(types.validatePurchase({...input,p_tipo:'GASTO'}));});
check('reject total, actor, item extras, invalid date/count/cost',()=>{for(const bad of [{...input,p_tipo:['MERCADERIA']},{...input,total:1},{...input,actor_id:id(9)},{...input,p_fecha:'2026-02-30'},{...input,p_items:[]},{...input,p_items:[{...input.p_items[0],total:1}]},{...input,p_items:[{...input.p_items[0],cantidad:0}]},{...input,p_items:[{...input.p_items[0],costo_unitario:-1}]}])assert.equal(types.validatePurchase(bad),false);});
check('supplier validation rejects actor',()=>assert.equal(types.validateSupplier({p_operacion_id:id(1),p_nombre:'x',p_identificacion_fiscal:null,p_contacto:null,p_observaciones:null,actor_id:id(9)}),false));
claims={data:{claims:null}};check('session required',(await api(input)).status===401?()=>{}:()=>assert.fail());
claims={data:{claims:{sub:id(9)}}};rpcCalls=[];check('server validation before RPC',(await api({...input,total:1})).status===422?()=>assert.equal(rpcCalls.length,0):()=>assert.fail());
check('origin protection',(await api(input,'purchase','POST','http://evil.test')).status===403?()=>{}:()=>assert.fail());
check('purchase RPC session client',(await api(input)).status===200?()=>{assert.equal(rpcCalls.at(-1)[0],'crear_compra_gasto_admin');assert.equal(rpcCalls.at(-1)[1].p_operacion_id,id(1));}:()=>assert.fail());
rpcResult={data:supplier,error:null};check('supplier RPC',(await api({p_operacion_id:id(1),p_nombre:'x',p_identificacion_fiscal:null,p_contacto:null,p_observaciones:null},'supplier')).status===200?()=>assert.equal(rpcCalls.at(-1)[0],'crear_proveedor_admin'):()=>assert.fail());
rpcResult={data:[],error:null};await api(null,'supplier','GET');check('supplier lookup uses RPC',()=>assert.equal(rpcCalls.at(-1)[0],'buscar_proveedores_admin'));
await api(null,'purchase','GET');check('list RPC',()=>assert.equal(rpcCalls.at(-1)[0],'buscar_compras_gastos_admin'));
rpcResult={data:detail,error:null};await api(null,'detail','GET');check('detail RPC',()=>assert.equal(rpcCalls.at(-1)[0],'obtener_compra_gasto_admin'));
rpcResult={data:null,error:{code:'42501',message:'internal'}};const denied=await api(input);check('non-admin permission and internal errors hidden',()=>{assert.equal(denied.status,403);});
rpcResult={data:null,error:{code:'XX000',message:'private SQL'}};const uncertain=await api(input);check('unknown error uncertain without SQL leak',()=>assert.equal(uncertain.status,502));
const root=createRoot(document.getElementById('root'));const query=s=>document.querySelector(s);const text=()=>document.body.textContent;
async function mount(Component,props={}){await act(async()=>{root.render(null)});await act(async()=>{root.render(React.createElement(Component,props))});}
async function set(name,value){await act(async()=>{const el=query(`[name="${name}"]`);const setter=Object.getOwnPropertyDescriptor(el.tagName==='SELECT'?dom.window.HTMLSelectElement.prototype:dom.window.HTMLInputElement.prototype,'value').set;setter.call(el,value);el.dispatchEvent(new dom.window.Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));});}
async function submit(id){await act(async()=>query('#'+id).dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));}
async function click(label){await act(async()=>{const el=[...document.querySelectorAll('button')].find(b=>b.textContent===label);assert.ok(el,label);el.click();});}
fetchHandler=async()=>Response.json({result:[]});await mount(View);check('empty list',()=>assert.match(text(),/No hay compras/));
fetchHandler=async()=>Response.json({result:[detail]});await mount(View);check('populated list/detail link',()=>{assert.match(text(),/Proveedor fixture/);assert.ok(query(`a[href="/admin/compras/${id(3)}"]`));});
fetchHandler=async()=>Response.json({result:detail});await mount(View,{id:id(3)});check('detail confirmed without purchase editing; receipt section available',()=>{assert.match(text(),/TOTAL GENERAL/);assert.match(text(),/Producto/);assert.doesNotMatch(text(),/Editar compra|Eliminar compra/);assert.match(text(),/Comprobantes digitales/);});
await mount(Form);await submit('purchase-data');check('supplier required UI',()=>assert.match(text(),/Seleccioná un proveedor/));
fetchHandler=async()=>Response.json({result:[supplier]});await set('supplier-search','fixture');await submit('supplier-search');await click('Proveedor fixture');check('supplier selection',()=>assert.match(text(),/Seleccionado: Proveedor fixture/));
await set('fecha','2026-10-10');await set('descripcion-0','Producto');await set('cantidad-0','3');await set('costo-0','0,335');check('preview total',()=>assert.match(text(),/TOTAL: 1,01 ARS/));
await click('+ Agregar ítem');await set('descripcion-1','Segundo');await set('costo-1','2');check('multiple items',()=>assert.ok(query('[name="descripcion-1"]')));
await act(async()=>{[...document.querySelectorAll('button')].filter(b=>b.textContent==='Quitar')[0].click();});check('remove and renumber',()=>{assert.equal(query('[name="descripcion-0"]').value,'Segundo');assert.equal(query('[name="descripcion-1"]'),null);});
await set('descripcion-0','Producto');await set('cantidad-0','3');await set('costo-0','0.335');await set('tipo','GASTO');await submit('purchase-data');check('explicit summary before POST',()=>{assert.match(text(),/Confirmar compra/);assert.match(text(),/Gasto/);assert.match(text(),/Comprobante:/);});
let calls=[],finish;
fetchHandler=(url,options)=>{if(options?.method === 'POST'){calls.push(JSON.parse(options.body));return new Promise(resolve=>{finish=resolve;});}return Promise.resolve(Response.json({result:{...detail,tipo:'GASTO'}}));};
await act(async()=>{const f=query('#purchase-confirm');for(let i=0;i<2;i++)f.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));});
check('double submit one request and auto positions',()=>{assert.equal(calls.length,1);assert.equal(calls[0].p_items[0].posicion,1);assert.deepEqual(Object.keys(calls[0].p_items[0]).sort(),['cantidad','costo_unitario','descripcion','posicion']);assert.equal('total' in calls[0],false);});
await act(async()=>finish(Response.json({error:'Resultado incierto'},{status:502})));check('error freezes payload',()=>{assert.match(text(),/Resultado incierto/);assert.equal([...document.querySelectorAll('button')].some(b=>b.textContent==='Volver a editar'),false);});
fetchHandler=async(url,options)=>{if(options?.method === 'POST'){calls.push(JSON.parse(options.body));return Response.json({result:{compra_gasto_id:id(3)}});}return Response.json({result:{...detail,tipo:'GASTO'}});};
await submit('purchase-confirm');check('stable UUID/payload retry and persisted result',()=>{assert.deepEqual(calls[0],calls[1]);assert.match(text(),/Gasto registrado correctamente/);assert.ok(query(`a[href="/admin/compras/${id(3)}"]`));});
await click('Registrar otra');await set('descripcion-0','Nuevo ítem');await set('costo-0','5');await submit('purchase-data');
let nextRequest;fetchHandler=async(url,options)=>{if(options?.method==='POST'){nextRequest=JSON.parse(options.body);return Response.json({result:{compra_gasto_id:id(3)}});}return Response.json({result:detail});};await submit('purchase-confirm');check('new operation has fresh UUID after success',()=>assert.notEqual(nextRequest.p_operacion_id,calls[0].p_operacion_id));
await mount(Form);await set('comprobante','conservar');await click('+ Nuevo proveedor');await set('supplier-nombre','Nuevo');
let supplierCalls=[];fetchHandler=async(url,options)=>{supplierCalls.push(JSON.parse(options.body));return Response.json({error:'Incierto'},{status:502});};await submit('supplier-create');check('supplier uncertain locks editing',()=>assert.ok(query('[name="supplier-nombre"]').closest('fieldset').disabled));
fetchHandler=async(url,options)=>{supplierCalls.push(JSON.parse(options.body));return Response.json({result:supplier});};await submit('supplier-create');check('supplier retry same UUID, automatic selection and preserved form',()=>{assert.deepEqual(supplierCalls[0],supplierCalls[1]);assert.match(text(),/Seleccionado: Proveedor fixture/);assert.equal(query('[name="comprobante"]').value,'conservar');});
check('responsive cards/control patterns',()=>{const source=readFileSync('app/admin/compras/new-purchase-form.tsx','utf8');assert.match(source,/sm:grid-cols-2/);assert.match(source,/flex-wrap/);assert.match(readFileSync('app/admin/compras/purchase-types.ts','utf8'),/min-h-12/);});
check('dashboard navigation and existing credit preserved',()=>{const source=readFileSync('app/admin/admin-dashboard.tsx','utf8');assert.match(source,/href="\/admin\/compras"/);assert.match(source,/href="\/admin\/nuevo-credito"/);});
check('RPC-only/no service role',()=>{const source=readFileSync('app/api/admin/compras/handlers.ts','utf8');assert.doesNotMatch(source,/\.from\(|service_role|supabase\/admin/);assert.match(source,/supabase\/server/);});
check('layout session protected',()=>assert.match(readFileSync('app/admin/compras/layout.tsx','utf8'),/getClaims\(\)/));
await act(async()=>root.unmount());console.log(`PASS: ${checks} groups; offline only`);
