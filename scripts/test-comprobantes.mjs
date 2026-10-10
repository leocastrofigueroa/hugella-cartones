// Offline: handlers y validadores reales. DB/Storage simulados, sin red ni secretos.
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const require=createRequire(import.meta.url),ts=require('typescript');const {PDFDocument}=require('pdf-lib');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actor=id(1),purchase=id(10);let claims={data:{claims:{sub:actor}},error:null},allowed=true,adminCreated=0,confirmFailure=0,lostUpload=false,lostConfirm=false;
const records=new Map(),objects=new Map(),calls=[];let callsBefore=0;
const session={auth:{getClaims:async()=>claims},rpc:async(name,args)=>{
 calls.push(name);if(!allowed)return {error:{code:'42501'}};
 if(name==='obtener_compra_gasto_admin')return args.p_compra_gasto_id===purchase?{data:{id:purchase}}:{error:{code:'22023'}};
 if(name==='obtener_comprobante_compra_gasto_admin')return records.has(args.p_id)?{data:{...records.get(args.p_id)}}:{error:{code:'22023'}};
 if(name==='listar_comprobantes_compra_gasto_admin')return {data:[...records.values()].map(r=>({...r}))};
 if(name==='anular_comprobante_compra_gasto_admin'){const r=records.get(args.p_id);if(r.estado==='ANULADO'&&r.motivo_anulacion!==args.p_motivo)return {error:{code:'22023'}};r.estado='ANULADO';r.motivo_anulacion=args.p_motivo;r.anulado_por=actor;r.anulado_at='2026-10-10';return {data:{...r}};}
 throw new Error(name);
}};
const admin={rpc:async(name,args)=>{
 calls.push(name);
 if(name==='reservar_comprobante_compra_gasto_servidor'){
  const existing=records.get(args.p_id);
  if(existing){if(existing.sha256!==args.p_sha256||existing.actor_id!==args.p_actor_id||existing.compra_gasto_id!==args.p_compra_gasto_id||existing.nombre_original!==args.p_nombre||existing.estado==='ANULADO')return {error:{code:'22023'}};return {data:{...existing}};}
  const r={id:args.p_id,compra_gasto_id:args.p_compra_gasto_id,actor_id:args.p_actor_id,bucket:'compras-gastos-privados',ruta:`${args.p_compra_gasto_id}/${args.p_id}${args.p_mime==='image/jpeg'?'.jpg':args.p_mime==='image/png'?'.png':'.pdf'}`,nombre_original:args.p_nombre,mime_type:args.p_mime,tamano_bytes:args.p_tamano,sha256:args.p_sha256,estado:'PENDIENTE',created_at:'2026-10-10',confirmado_at:null,anulado_at:null,anulado_por:null,motivo_anulacion:null};records.set(r.id,r);return {data:{...r}};
 }
 if(name==='confirmar_comprobante_compra_gasto_servidor'){
  if(confirmFailure-->0)return {error:{code:'network'}};
  const r=records.get(args.p_id);r.estado='DISPONIBLE';r.confirmado_at='2026-10-10';if(lostConfirm){lostConfirm=false;return {error:{code:'network'}};}return {data:{...r}};
 }throw new Error(name);
},storage:{from:bucket=>{assert.equal(bucket,'compras-gastos-privados');return {
 upload:async(route,bytes,opts)=>{calls.push('upload');assert.equal(opts.upsert,false);if(objects.has(route))return {error:{code:'409'}};objects.set(route,new Blob([bytes],{type:opts.contentType}));if(lostUpload){lostUpload=false;throw new Error('response lost');}return {error:null};},
 download:async route=>{calls.push('download');return objects.has(route)?{data:objects.get(route),error:null}:{data:null,error:{code:'404'}};}
};}}};
const cache=new Map();function load(file){file=path.resolve(file);if(cache.has(file))return cache.get(file);const mod={exports:{}};
 vm.runInNewContext(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2020}}).outputText,{module:mod,exports:mod.exports,Buffer,Request,Response,URL,File,Blob,console,Uint8Array,
 require(name){if(name==='server-only')return {};if(name==='@/utils/supabase/server')return {createClient:async()=>session};if(name==='@/utils/supabase/admin')return {createAdminClient:()=>{adminCreated++;return admin;}};if(name.startsWith('.')){const base=path.resolve(path.dirname(file),name);return load(base+(existsSync(base+'.ts')?'.ts':'.tsx'));}return require(name);}});cache.set(file,mod.exports);return mod.exports;}
const {receiptHandler}=load('app/api/admin/comprobantes/handlers.ts'),files=load('app/api/admin/comprobantes/files.ts');let checks=0;
async function check(label,fn){await fn();checks++;console.log('PASS:',label);}
const png=readFileSync('public/hugella-logo.png');const pdfDoc=await PDFDocument.create();pdfDoc.addPage();const pdf=await pdfDoc.save();
const jpeg=await require('sharp')(png).jpeg().toBuffer();
function request(op,bytes=png,mime='image/png',name='factura.png',origin='http://localhost'){
 const form=new FormData();form.append('id',op);form.append('archivo',new File([bytes],name,{type:mime}));return new Request('http://localhost/api/admin/compras/'+purchase+'/comprobantes',{method:'POST',headers:{origin},body:form});}
const post=(op,bytes=png,mime='image/png',name='factura.png')=>receiptHandler(request(op,bytes,mime,name),'upload',purchase);
const action=(kind,rid,body)=>receiptHandler(new Request('http://localhost/api/admin/comprobantes/'+rid,{method:'POST',headers:{origin:'http://localhost','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),kind,rid);
await check('real PNG logo accepted',async()=>assert.equal((await files.validateFile(png,'image/png','factura.png')).hash,createHash('sha256').update(png).digest('hex')));
await check('parse real PDF',async()=>assert.equal((await files.validateFile(pdf,'application/pdf','factura.pdf')).size,pdf.length));
await check('real JPEG content generated locally',async()=>assert.equal((await files.validateFile(jpeg,'image/jpeg','foto.JPEG')).mime,'image/jpeg'));
await check('empty and 3MiB+ rejected',async()=>{for(const b of [Buffer.alloc(0),Buffer.alloc(3*1024*1024+1)])await assert.rejects(files.validateFile(b,'image/png','x.png'));});
await check('exact 3MiB valid PDF accepted',async()=>{const source=Buffer.from(pdf),eof=source.lastIndexOf('%%EOF');const boundary=Buffer.concat([source.subarray(0,eof),Buffer.alloc(files.MAX_FILE_SIZE-source.length,32),source.subarray(eof)]);assert.equal((await files.validateFile(boundary,'application/pdf','limite.pdf')).size,files.MAX_FILE_SIZE);});
await check('fake MIME/content/extensions rejected',async()=>{for(const [bytes,mime,name] of [[png,'application/pdf','x.pdf'],[pdf,'image/png','x.png'],[Buffer.from('%PDF-1.7\n%%EOF'),'application/pdf','x.pdf'],[Buffer.from('fake'),'image/jpeg','x.jpg'],[png,'image/png','x.jpg']])await assert.rejects(files.validateFile(bytes,mime,name));});
await check('corrupt PNG CRC and trailing bytes rejected',async()=>{const corrupt=Buffer.from(png);corrupt[20]^=1;await assert.rejects(files.validateFile(corrupt,'image/png','x.png'));await assert.rejects(files.validateFile(Buffer.concat([png,Buffer.from('suffix')]),'image/png','x.png'));});
await check('malicious/bidi names rejected and trim canonical',async()=>{for(const name of ['../x.png','<x>.png','x\u0000.png','x\u202e.png'])assert.throws(()=>files.safeName(name,'image/png'));assert.equal(files.safeName(' factura.png ','image/png'),'factura.png');});
await check('origin rejected before privileged client',async()=>{callsBefore=adminCreated;assert.equal((await receiptHandler(request(id(20),png,'image/png','x.png','http://evil'),'upload',purchase)).status,403);assert.equal(adminCreated,callsBefore);});
await check('no session rejected before privileged client',async()=>{claims={data:{claims:null}};callsBefore=adminCreated;assert.equal((await post(id(20))).status,401);assert.equal(adminCreated,callsBefore);claims={data:{claims:{sub:actor}},error:null};});
await check('ordinary user cannot use upload API',async()=>{allowed=false;callsBefore=adminCreated;assert.equal((await post(id(20))).status,403);assert.equal(adminCreated,callsBefore);allowed=true;});
await check('invalid file before reservation/Storage',async()=>{callsBefore=adminCreated;assert.equal((await post(id(20),Buffer.from('fake'))).status,422);assert.equal(adminCreated,callsBefore);});
await check('actual oversized body capped before privileged client',async()=>{callsBefore=adminCreated;assert.equal((await receiptHandler(new Request('http://localhost/upload',{method:'POST',headers:{origin:'http://localhost','Content-Type':'multipart/form-data; boundary=test'},body:Buffer.alloc(4*1024*1024)}),'upload',purchase)).status,413);assert.equal(adminCreated,callsBefore);});
await check('purchase nonexistent before privilege',async()=>{callsBefore=adminCreated;assert.equal((await receiptHandler(request(id(20)),'upload',id(99))).status,404);assert.equal(adminCreated,callsBefore);});
await check('admin upload bytes hash and reserve/upload/verify/confirm order',async()=>{calls.length=0;const r=await post(id(20));assert.equal(r.status,200);assert.equal(records.get(id(20)).sha256,createHash('sha256').update(png).digest('hex'));assert.deepEqual(calls,['obtener_compra_gasto_admin','reservar_comprobante_compra_gasto_servidor','upload','download','confirmar_comprobante_compra_gasto_servidor']);});
await check('retry UUID same bytes no duplicate and no overwrite',async()=>{calls.length=0;assert.equal((await post(id(20))).status,200);assert.equal(calls.includes('upload'),false);assert.equal(records.size,1);assert.equal(objects.size,1);});
await check('same UUID different valid bytes blocked',async()=>assert.equal((await post(id(20),pdf,'application/pdf','x.pdf')).status,409));
await check('lost upload response verified and confirmed',async()=>{lostUpload=true;assert.equal((await post(id(21))).status,200);});
await check('uploaded but confirmation failure pending then retry same object',async()=>{confirmFailure=1;assert.equal((await post(id(22))).status,502);assert.equal(records.get(id(22)).estado,'PENDIENTE');assert.equal((await post(id(22))).status,200);});
await check('commit response lost then stable retry',async()=>{lostConfirm=true;assert.equal((await post(id(23))).status,502);assert.equal(records.get(id(23)).estado,'DISPONIBLE');assert.equal((await post(id(23))).status,200);});
await check('pending recovery after reload without original File',async()=>{confirmFailure=1;await post(id(24));assert.equal((await action('recover',id(24))).status,200);});
await check('missing stored object never shown available during recovery',async()=>{confirmFailure=1;await post(id(25));objects.delete(records.get(id(25)).ruta);assert.equal((await action('recover',id(25))).status,409);assert.equal(records.get(id(25)).estado,'PENDIENTE');});
await check('stored object same size wrong hash fails closed',async()=>{const r=records.get(id(25));const bad=Buffer.from(png);bad[bad.length-1]^=1;objects.set(r.ruta,new Blob([bad]));assert.equal((await post(id(25))).status,409);assert.equal(r.estado,'PENDIENTE');});
await check('multiple concurrent attachments independent IDs',async()=>{const rs=await Promise.all([post(id(26)),post(id(27))]);assert.ok(rs.every(r=>r.status===200));assert.notEqual(records.get(id(26)).ruta,records.get(id(27)).ruta);});
await check('double same UUID safe',async()=>{const rs=await Promise.all([post(id(28)),post(id(28))]);assert.ok(rs.every(r=>r.status===200));assert.equal([...records.values()].filter(r=>r.id===id(28)).length,1);});
await check('read authenticated proxy hashes bytes and private headers',async()=>{const r=await receiptHandler(new Request('http://localhost/read'),'read',id(20));assert.equal(r.status,200);assert.match(r.headers.get('cache-control'),/private, no-store/);assert.equal(r.headers.get('x-content-type-options'),'nosniff');assert.equal(createHash('sha256').update(Buffer.from(await r.arrayBuffer())).digest('hex'),records.get(id(20)).sha256);});
await check('read does not accept arbitrary object paths',async()=>assert.equal((await receiptHandler(new Request('http://localhost/read'),'read','../../x')).status,400));
await check('non-admin cannot read/list/annul/recover',async()=>{allowed=false;callsBefore=adminCreated;for(const kind of ['read','list','annul','recover']){const r=kind==='read'||kind==='list'?await receiptHandler(new Request('http://localhost'),'list'===kind?'list':'read',kind==='list'?purchase:id(20)):await action(kind,id(20),{motivo:'Error'});assert.equal(r.status,403);}assert.equal(adminCreated,callsBefore);allowed=true;});
await check('annul reason required',async()=>assert.equal((await action('annul',id(20),{motivo:' '})).status,422));
await check('annul audit preserves object and retry',async()=>{const size=objects.size;assert.equal((await action('annul',id(20),{motivo:'Error de carga'})).status,200);assert.equal(records.get(id(20)).anulado_por,actor);assert.equal(objects.size,size);assert.equal((await action('annul',id(20),{motivo:'Error de carga'})).status,200);assert.equal((await post(id(20))).status,409);});
await check('list includes annulled history and pending distinct',async()=>{const r=await receiptHandler(new Request('http://localhost'),'list',purchase);assert.equal(r.status,200);const body=await r.json();assert.ok(body.result.some(r=>r.estado==='ANULADO'));assert.ok(body.result.some(r=>r.estado==='PENDIENTE'));});
await check('PDF download disposition isolates active document',async()=>{await post(id(29),pdf,'application/pdf','factura.pdf');const r=await receiptHandler(new Request('http://localhost'),'read',id(29));assert.match(r.headers.get('content-disposition'),/^attachment/);assert.match(r.headers.get('content-security-policy'),/sandbox/);});
await check('no Storage signed URLs/removals/service client in UI',async()=>{for(const file of ['app/admin/compras/receipt-files.tsx','app/admin/compras/new-purchase-form.tsx','app/admin/compras/purchases-view.tsx'])assert.doesNotMatch(readFileSync(file,'utf8'),/supabase\/admin|SUPABASE_SECRET_KEY|service_role|createSignedUrl|\.storage/);assert.doesNotMatch(readFileSync('app/api/admin/comprobantes/handlers.ts','utf8'),/\.remove\(|createSignedUrl/);});
await check('contracts and earlier migrations byte-for-byte unchanged',async()=>{
 const tracked=execFileSync('git',['ls-files','app/contrato','app/api/contratos','app/api/admin/firma-titular','app/admin/contratos','utils/contracts','utils/supabase/admin.ts','supabase/migrations/202609140002_contratos_storage.sql','supabase/migrations/202610090003_compras_gastos_base.sql','supabase/migrations/202610090004_compras_gastos_rpc_admin.sql'],{encoding:'utf8'}).trim().split('\n');
 for(const file of tracked)assert.ok(readFileSync(file).equals(execFileSync('git',['show',`HEAD:${file}`])),file);
});
console.log(`PASS: ${checks} groups; offline DB/Storage simulations only`);
