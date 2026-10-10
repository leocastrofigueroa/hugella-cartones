// Componentes reales bajo JSDOM; sin servidores ni conexiones externas.
import { createRequire } from 'node:module';
import { readFileSync,existsSync } from 'node:fs';
import path from 'node:path';import vm from 'node:vm';import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),React=require('react'),{act}=React,ts=require('typescript'),{JSDOM}=require('jsdom');
const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'});globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const {createRoot}=require('react-dom/client');const root=createRoot(document.getElementById('root'));
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let serial=50,calls=[],rows=[],lost=false,finish;const saved=new Map();let fetchHandler=async(url,opts)=>{
 calls.push([url,opts]);if(opts?.method==='POST'&&opts.body instanceof FormData){
 const op=opts.body.get('id'),file=opts.body.get('archivo');
 if(lost){lost=false;return Response.json({error:'Comprobante no pudo completarse'},{status:502});}
 const r={id:op,nombre_original:file.name,tamano_bytes:file.size,estado:'DISPONIBLE',created_at:'2026-10-10',actor_id:id(1)};saved.set(op,r);rows=[...saved.values()];return Response.json({result:r});
 }return Response.json({result:rows});};
const cache=new Map();function load(file){file=path.resolve(file);if(cache.has(file))return cache.get(file);const mod={exports:{}};
 vm.runInNewContext(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true,target:ts.ScriptTarget.ES2020}}).outputText,{module:mod,exports:mod.exports,Request,Response,FormData,File,window:dom.window,console,crypto:{randomUUID:()=>id(++serial)},fetch:(...args)=>fetchHandler(...args),require(name){if(name==='next/link')return {__esModule:true,default:props=>React.createElement('a',props)};if(name.startsWith('.')){const base=path.resolve(path.dirname(file),name);return load(base+(existsSync(base+'.ts')?'.ts':'.tsx'));}return require(name);}});cache.set(file,mod.exports);return mod.exports;}
const {default:Receipts,AttachmentPicker}=load('app/admin/compras/receipt-files.tsx');const Form=load('app/admin/compras/new-purchase-form.tsx').default;
let checks=0;function check(label,fn){fn();checks++;console.log('PASS:',label);}
const text=()=>document.body.textContent;async function mount(Component,props={}){await act(async()=>root.render(null));await act(async()=>root.render(React.createElement(Component,props)));}
async function click(label){await act(async()=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent===label);assert.ok(button,label);button.click();});}
async function choose(selector,files){await act(async()=>{const input=document.querySelector(selector);assert.ok(input);Object.defineProperty(input,'files',{configurable:true,value:files});input.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});}
const file=new File(['fixture'],'factura.png',{type:'image/png'}),second=new File(['two'],'ticket.pdf',{type:'application/pdf'});
let selected=[];await mount(AttachmentPicker,{files:[],onChange:files=>{selected=files;}});
check('native mobile/file selector supports multiple JPEG PNG PDF',()=>{const input=document.querySelector('input');assert.equal(input.accept,'image/jpeg,image/png,application/pdf');assert.ok(input.multiple);assert.equal(input.getAttribute('capture'),null);});
await choose('input',[file,second]);check('stable distinct UUID per selected file',()=>{assert.equal(selected.length,2);assert.notEqual(selected[0].id,selected[1].id);});
await mount(AttachmentPicker,{files:selected,onChange:files=>{selected=files;}});await click('Quitar archivo');check('remove only unsent attachment',()=>assert.equal(selected.length,1));
await choose('input',[new File([],'empty.png',{type:'image/png'})]);check('empty rejected locally',()=>assert.match(text(),/con contenido/));
await mount(Receipts,{purchaseId:id(10)});check('empty receipt list, no valid pending preview',()=>assert.match(text(),/Sin comprobantes guardados/));
lost=true;const op=id(20);await mount(Receipts,{purchaseId:id(10),initialFiles:[{id:op,file}]});check('file upload failure retains original File and retry',()=>{assert.match(text(),/no pudo completarse/);assert.ok([...document.querySelectorAll('button')].some(b=>/Guardar \/ reintentar/.test(b.textContent)));});
await click('Guardar / reintentar comprobantes');check('retry uses exact same UUID and File, one stored receipt',()=>{const uploads=calls.filter(([,opts])=>opts?.body instanceof FormData);assert.equal(uploads.at(-1)[1].body.get('id'),op);assert.equal(uploads.at(-2)[1].body.get('id'),op);assert.equal(saved.size,1);assert.match(text(),/DISPONIBLE/);});
check('available read uses authenticated API URL',()=>assert.equal(document.querySelector('a').getAttribute('href'),`/api/admin/comprobantes/${op}/archivo`));
await click('Anular comprobante');check('explicit confirmation and required motive',()=>{assert.match(text(),/Confirmar anulación/);assert.ok(document.querySelector('textarea').required);assert.ok([...document.querySelectorAll('button')].find(b=>b.textContent==='Confirmar anulación').disabled);});
await click('Cancelar');check('cancel annul no POST',()=>assert.equal(document.querySelector('textarea'),null));
rows=[{id:id(21),nombre_original:'pendiente.png',tamano_bytes:100,estado:'PENDIENTE',created_at:'2026-10-10',actor_id:id(1)},{id:id(22),nombre_original:'anulado.pdf',tamano_bytes:100,estado:'ANULADO',created_at:'2026-10-10',anulado_at:'2026-10-10',anulado_por:id(1),motivo_anulacion:'Error'}];
await mount(Receipts,{purchaseId:id(10)});check('reload pending discoverable, no Ver for pending; annulled history',()=>{assert.match(text(),/Historial de anulados/);assert.match(text(),/Reintentar archivo original/);assert.equal(document.querySelectorAll('a').length,1);assert.ok(document.querySelector(`a[href="/api/admin/comprobantes/${id(22)}/archivo"]`));});
await choose('input[accept]', [file]);check('reselect pending keeps original UUID after reload',()=>{assert.equal(calls.filter(([,opts])=>opts?.body instanceof FormData).at(-1)[1].body.get('id'),id(21));});
// Hold request to demonstrate UI exclusion; release once checked.
fetchHandler=(url,opts)=>opts?.method==='POST'?new Promise(resolve=>{finish=resolve;}):Promise.resolve(Response.json({result:[]}));
await mount(Receipts,{purchaseId:id(10)});await choose('input',[file]);
await act(async()=>{[...document.querySelectorAll('button')].find(b=>/Guardar \/ reintentar/.test(b.textContent)).click();});
check('upload disables double-submit and picker',()=>{assert.ok(document.querySelector('input').disabled);assert.ok([...document.querySelectorAll('button')].find(b=>/Guardar \/ reintentar/.test(b.textContent)).disabled);});
await act(async()=>finish(Response.json({error:'Resultado incierto'},{status:502})));
// Full purchase: attachment selected first; no upload before purchase creation.
const supplier={id:id(2),nombre:'Proveedor',identificacion_fiscal:null,contacto:null,observaciones:null};const detail={id:id(10),tipo:'GASTO',proveedor:supplier,fecha:'2026-10-10',moneda:'ARS',total:10,items:[],created_at:'2026-10-10'};
let ordered=[];fetchHandler=async(url,opts)=>{
 ordered.push(url);
 if(url.startsWith('/api/admin/proveedores'))return Response.json({result:[supplier]});
 if(url==='/api/admin/compras'&&opts?.method==='POST')return Response.json({result:{compra_gasto_id:id(10)}});
 if(url===`/api/admin/compras/${id(10)}`)return Response.json({result:detail});
 if(opts?.body instanceof FormData){const op=opts.body.get('id');return Response.json({result:{id:op,estado:'DISPONIBLE'}});}
 return Response.json({result:[]});
};
await mount(Form);await choose('input[type="file"]',[file]);check('new form selection does not upload/create receipt',()=>assert.equal(ordered.length,0));
await act(async()=>document.querySelector('#supplier-search').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));await click('Proveedor');
async function set(name,value){await act(async()=>{const input=document.querySelector(`[name="${name}"]`);Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});}
await set('fecha','2026-10-10');await set('descripcion-0','Gasto');await set('costo-0','10');
await act(async()=>document.querySelector('#purchase-data').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));
check('review retains files without uploading',()=>{assert.match(text(),/Archivos adjuntos: 1/);assert.equal(ordered.some(url=>url.includes('/comprobantes')),false);});
await act(async()=>document.querySelector('#purchase-confirm').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));
check('purchase saved before attachments, result preserved',()=>{assert.match(text(),/Gasto registrado correctamente/);assert.ok(ordered.indexOf('/api/admin/compras')<ordered.findIndex(url=>url.includes('/comprobantes')));assert.match(text(),/Guardado/);});
await act(async()=>root.unmount());console.log(`PASS: ${checks} UI groups, offline only`);
