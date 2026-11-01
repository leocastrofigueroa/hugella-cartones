// PostgreSQL WASM aislado. Sin red, .env, credenciales ni datos productivos.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const db=new PGlite();const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actor=id(1),supplier=id(2),card=id(3),p1=id(4),p2=id(5),p3=id(6);
const read=n=>readFileSync(`supabase/migrations/${n}.sql`,'utf8');
let checks=0;const ok=(label,value)=>{assert.ok(value,label);console.log('PASS',label);checks++;};
const scalar=async(q,args=[])=>Object.values((await db.query(q,args)).rows[0])[0];
const rpc=async(name,args)=>scalar(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')})`,args);
const rejects=async(label,fn)=>{await assert.rejects(fn);ok(label,true);};
let op=100;const operate=(purchase,action,data,operation=id(++op))=>rpc('operar_devolucion_compra_admin',[operation,purchase,action,JSON.stringify(data)]);
const saldo=period=>rpc('obtener_saldo_periodo_tarjeta_admin',[period]);
const pay=(period,amount)=>rpc('registrar_pago_resumen_tarjeta_admin',[id(++op),period,'2027-01-01',amount,null]);
async function listings(label){
 const rows=(await db.query('select * from listar_resumenes_tarjeta_financieros_admin($1,100,0)',[card])).rows.map(r=>Object.values(r)[0]);
 const legacy=(await db.query('select to_jsonb(s) j from listar_resumenes_tarjeta_admin($1,100,0) s',[card])).rows.map(r=>r.j);
 for(const row of rows){
   assert.deepEqual(row,{...await saldo(row.periodo_id),orden:row.orden,fecha_cierre:row.fecha_cierre,fecha_vencimiento:row.fecha_vencimiento},label);
 }
 ok(label+' / importes y estados idénticos al saldo individual',true);
 const fields=['periodo_id','orden','fecha_cierre','fecha_vencimiento','total_obligaciones_hugella','total_pagado','saldo','estado'];
 assert.deepEqual(legacy,rows.map(row=>Object.fromEntries(fields.map(k=>[k,row[k]]))));
 ok(label+' / contrato de RPC anterior conservado',true);
}

async function purchase(n,amount,count=1,period=p1){
 const purchase=id(n);await db.query(`insert into compras_gastos(id,tipo,proveedor_id,fecha,moneda,actor_id) values($1,'GASTO',$2,'2026-10-01','ARS',$3)`,[purchase,supplier,actor]);
 await db.query(`insert into items_compras_gastos(compra_gasto_id,posicion,descripcion,cantidad,costo_unitario) values($1,1,'Compra sintética',1,$2)`,[purchase,amount]);
 await rpc('confirmar_financiacion_compra_admin',[id(++op),purchase,JSON.stringify([{posicion:1,medio:'TARJETA_CREDITO',importe:amount,tarjeta_id:card,cantidad_cuotas:count,primer_periodo_id:period}])]);
 return {id:purchase,tramo:await scalar('select id from tramos_pago_compras where compra_id=$1',[purchase]),quotas:(await db.query('select id from obligaciones_tarjetas where compra_id=$1 order by numero_cuota',[purchase])).rows.map(x=>x.id)};
}
try{
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema auth;create table auth.users(id uuid primary key);insert into auth.users values('${actor}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 create function public.es_admin_hugella() returns boolean language sql stable as $$select auth.uid()='${actor}'::uuid$$;
 grant usage on schema auth to authenticated;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,metadata jsonb);alter table storage.objects enable row level security;
 set test.uid='${actor}';`);
 for(const n of ['202610090003_compras_gastos_base','202610090004_compras_gastos_rpc_admin','202610100001_comprobantes_compras_gastos','202610110001_financiacion_compras_base','202610110002_financiacion_compras_rpc_admin','202610110003_compra_financiada_admin','202610110004_editar_tarjeta_credito_admin','202610110005_observaciones_listado_compras','202610110006_anulacion_compras_gastos','202610140002_corte_historico_compras','202610140003_importacion_compras_historicas','202610140004_financiacion_historica_sheets']){
  // PGlite usa otro major de PostgreSQL: sólo omitir fingerprints de catálogo versionados de migraciones anteriores.
  // Las funciones, triggers, ACL, checks y la migración nueva se ejecutan íntegros.
  try{await db.exec(read(n).replace(/if \(select md5\(baseline::text\)[\s\S]*? is distinct from '[0-9a-f]+' then/g,'if false then'));}catch(e){throw new Error('Baseline '+n+': '+e.message);}
 }
 await db.exec(read('202610260001_devoluciones_tarjetas_base'));
 // Previous view extracted verbatim: panel migration also depends on unrelated credit tables.
 const panel=read('202610160001_panel_financiero');await db.exec(panel.slice(panel.indexOf('create or replace view public.vw_obligaciones_tarjetas_financieras'),panel.indexOf('create or replace view public.vw_obligaciones_tarjetas_financieras')+panel.slice(panel.indexOf('create or replace view public.vw_obligaciones_tarjetas_financieras')).indexOf(';')+1));
 await db.exec(read('202610160008_calendario_financiero'));
 await db.exec(`insert into proveedores(id,nombre,actor_id) values('${supplier}','Proveedor sintético','${actor}');insert into tarjetas_credito(id,nombre,entidad,actor_id) values('${card}','Tarjeta sintética','Emisor sintético','${actor}');
 insert into periodos_tarjetas(id,tarjeta_id,orden,fecha_cierre,fecha_vencimiento,actor_id) values
 ('${p1}','${card}',1,'2026-11-10','2026-11-20','${actor}'),('${p2}','${card}',2,'2026-12-10','2026-12-20','${actor}'),('${p3}','${card}',3,'2027-01-10','2027-01-20','${actor}');`);
 const a=await purchase(10,300,3),b=await purchase(11,90,1,p2);
 await pay(p1,40);
 const facts=await scalar(`select jsonb_build_object('pagos',(select jsonb_agg(to_jsonb(p)) from pagos_resumenes_tarjetas p),'aplicaciones',(select jsonb_agg(to_jsonb(a)) from aplicaciones_pagos_obligaciones a),'cuotas',(select jsonb_agg(to_jsonb(o) order by id) from obligaciones_tarjetas o))`);
 const migration=read('202610260002_integrar_devoluciones_finanzas');
 await rejects('instalación revierte ante error',()=>db.exec(migration.replace(/commit;\s*$/,'select 1/0; commit;')));
 await db.exec('rollback');ok('rollback no deja RPC parcial',await scalar("select to_regprocedure('public.operar_devolucion_compra_admin(uuid,uuid,text,jsonb)') is null"));
 await db.exec(migration);
 // Dependencias de cobranzas vacías y sintéticas; se ejecuta la RPC real de proyección sin cambios.
 await db.exec(`create table creditos(id uuid primary key,codigo text);create table pagos(credito_id uuid,fecha_pago date,importe numeric,estado text);
 create view vw_proyeccion_cobranza_mensual as select null::date mes,0::numeric recaudacion_programada where false;`);
 await db.exec(read('202610160009_proyeccion_mensual_financiera'));

 ok('instalación conserva saldo sin devoluciones',(await saldo(p1)).saldo===60);
 await listings('sin devoluciones');
 ok('instalación conserva pagos y cuotas',JSON.stringify(facts)===JSON.stringify(await scalar(`select jsonb_build_object('pagos',(select jsonb_agg(to_jsonb(p)) from pagos_resumenes_tarjetas p),'aplicaciones',(select jsonb_agg(to_jsonb(a)) from aplicaciones_pagos_obligaciones a),'cuotas',(select jsonb_agg(to_jsonb(o) order by id) from obligaciones_tarjetas o))`)));
 const d=await operate(a.id,'DEVOLUCION',{fecha:'2026-10-20',motivo:'Reintegro sintético',tramo_id:a.tramo,importe:120});
 ok('devolución esperada no descuenta saldo',(await saldo(p1)).saldo===60);
 await listings('devolución pendiente');
 ok('proyección usa saldo pendiente sin devolución esperada',Number(await scalar("select tarjetas_a_pagar from obtener_proyeccion_mensual_financiera_admin() where mes='2026-11-01'"))===60);

 const cancellation={fecha:'2026-11-11',motivo:'Cancelación sintética',obligaciones:[a.quotas[2]]};
 const cancelId=id(++op);const c=await operate(a.id,'CANCELAR',cancellation,cancelId);
 ok('cancelación idempotente',JSON.stringify(c)===JSON.stringify(await operate(a.id,'CANCELAR',cancellation,cancelId)));
 await rejects('UUID no admite otro payload',()=>operate(a.id,'CANCELAR',{...cancellation,motivo:'Otro'},cancelId));
 ok('cuota cancelada excluida',(await saldo(p3)).saldo===0&&(await saldo(p3)).estado==='CANCELADA');
 await listings('cuotas canceladas');
 const cr={fecha:'2026-11-15',devolucion_id:d.id,periodo_id:p1,importe:80,referencia:'Crédito sintético'};
 const creditId=id(++op);await operate(a.id,'ACREDITAR',cr,creditId);await operate(a.id,'ACREDITAR',cr,creditId);
 ok('acreditación parcial idempotente',(await saldo(p1)).saldo===0&&(await saldo(p1)).saldo_a_favor===20);
 ok('saldo a favor pasa a siguiente período',(await saldo(p2)).saldo===170);
 const page=(await db.query('select * from listar_resumenes_tarjeta_financieros_admin($1,1,1)',[card])).rows.map(r=>Object.values(r)[0]);ok('offset no pierde crédito de la página anterior',page.length===1&&page[0].periodo_id===p2&&page[0].saldo===170&&page[0].saldo_a_favor_entrante===20);
 await listings('crédito arrastrado');
 ok('proyección descuenta crédito una sola vez',Number(await scalar("select tarjetas_a_pagar from obtener_proyeccion_mensual_financiera_admin() where mes='2026-12-01'"))===170);
 ok('resúmenes enriquecidos exponen crédito',((await db.query('select * from listar_resumenes_tarjeta_financieros_admin($1,100,0)',[card])).rows.map(r=>Object.values(r)[0])).find(r=>r.periodo_id===p1).saldo_a_favor===20);

 await pay(p2,70);ok('pago real no duplica crédito',(await saldo(p2)).saldo===100);
 await listings('pago parcial con crédito');
 await operate(a.id,'ACREDITAR',{...cr,periodo_id:p2,importe:40});ok('crédito en segundo resumen',(await saldo(p2)).saldo===60);
 await pay(p2,60);ok('saldo final cero',(await saldo(p2)).saldo===0);
 await listings('saldo pagado');
 await rejects('no admite sobrepago',()=>pay(p2,1));
 await rejects('no admite sobreacreditación',()=>operate(a.id,'ACREDITAR',{...cr,importe:1}));
 await rejects('no duplica descuento cancelación/devolución',()=>operate(a.id,'DEVOLUCION',{fecha:'2026-11-20',motivo:'Exceso',tramo_id:a.tramo,importe:81}));
 const detail=await rpc('obtener_compra_gasto_admin',[a.id]);ok('detalle conserva evidencia y conecta financiación',Object.hasOwn(detail,'evidencia_historica')&&detail.financiacion.estado==='CANCELADA');
 ok('detalle distingue cuotas canceladas',detail.financiacion.cuotas[2].estado==='CANCELADA'&&detail.financiacion.cuotas[2].saldo===0);
 ok('detalle devolución acreditada',detail.financiacion.devoluciones[0].estado==='ACREDITADA'&&detail.financiacion.devoluciones[0].importe_acreditado===120);
 ok('calendario identifica cancelada',(await db.query('select * from listar_calendario_financiero_admin()')).rows.find(q=>q.obligacion_id===a.quotas[2]).estado==='CANCELADA');
 await rejects('historial inmutable',()=>db.exec('delete from acreditaciones_devoluciones_tarjetas'));
 const paid=await purchase(12,30,1,p3);await pay(p3,30);
 await rejects('no cancela cuota pagada',()=>operate(paid.id,'CANCELAR',{fecha:'2026-10-01',motivo:'Inválida',obligaciones:paid.quotas}));
 await db.query(`insert into tarjetas_credito(id,nombre,entidad,actor_id) values($1,'Visa Leo','Santander',$2)`,[id(50),actor]);
 await rpc('registrar_periodo_tarjeta_admin',[id(++op),id(50),'2026-11-10','2026-11-20']);
 const hp=await scalar('select id from periodos_tarjetas where tarjeta_id=$1',[id(50)]);
 const evidence={tarjeta_original:'Visa L',tarjeta_canonica:'Visa Leo Santander',tarjeta_id:id(50),periodo_inicial_id:hp,cuotas_fuente:2,valor_cuota_historico:20,pagadas_historicas:1,pendientes_historicas:1,saldo_historico:20,estado_original:'Fixture',cierre_original:'2026-11-10',vencimiento_original:'2026-11-20',tratamiento:'FINANCIACION_HISTORICA_OPERATIVA'};
 const hist=await rpc('importar_compra_historica_admin',[id(++op),'HG-9001','GASTO',supplier,'2026-10-01','ARS',null,null,'Histórica sintética',40,JSON.stringify([{posicion:1,medio:'TARJETA_CREDITO',importe:40,tarjeta_id:id(50),cantidad_cuotas:2,primer_periodo_id:hp}]),JSON.stringify(evidence)]);
 const cut={id:hist.compra_id,quotas:[await scalar('select id from obligaciones_tarjetas where compra_id=$1 and numero_cuota=1',[hist.compra_id])]};
 await rpc('registrar_corte_historico_obligacion_admin',[id(++op),cut.quotas[0],'Corte sintético','2026-10-01',20]);
 ok('histórico conserva corte y saldo operativo',(await rpc('obtener_financiacion_compra_admin',[cut.id])).total_corte_historico===20);

 await rejects('no cancela corte histórico',()=>operate(cut.id,'CANCELAR',{fecha:'2026-10-01',motivo:'Inválida',obligaciones:cut.quotas}));
 const documentaryEvidence={...evidence,cuotas_fuente:1,valor_cuota_historico:0,pagadas_historicas:0,pendientes_historicas:1,saldo_historico:0,tratamiento:'FINANCIACION_HISTORICA_SIN_IMPORTE_OPERATIVO'};
 // HG-0043 es el discriminador exigido por el CHECK de la migración; todo el registro es sintético.
 const documentary=await rpc('importar_compra_historica_admin',[id(++op),'HG-0043','GASTO',supplier,'2026-10-01','ARS',null,null,'Documental sintética',0,'[]',JSON.stringify(documentaryEvidence)]);
 const docDetail=await rpc('obtener_compra_gasto_admin',[documentary.compra_id]);
 ok('documental conserva evidencia y saldo cero',docDetail.financiacion.estado==='FINANCIACION_HISTORICA_SIN_IMPORTE_OPERATIVO'&&docDetail.financiacion.saldo_pendiente===0&&docDetail.evidencia_historica.tratamiento===documentaryEvidence.tratamiento);
 await rejects('documental no admite cancelación financiera',()=>operate(documentary.compra_id,'CANCELAR',{fecha:'2026-10-01',motivo:'X',obligaciones:[]}));
 await rejects('cuotas de otra compra no se cancelan',()=>operate(b.id,'CANCELAR',{fecha:'2026-10-01',motivo:'X',obligaciones:a.quotas}));
 await rejects('anulación técnica no ignora devoluciones',()=>rpc('anular_compra_gasto_admin',[id(++op),a.id,'X']));
 await rejects('cuota con cierre pasado no se cancela',()=>operate(b.id,'CANCELAR',{fecha:'2027-01-01',motivo:'X',obligaciones:b.quotas}));
 await rejects('acreditación rechaza resumen de otra tarjeta',()=>operate(a.id,'ACREDITAR',{...cr,periodo_id:hp,importe:1}));
 const unassigned=await purchase(14,10,1,null);
 const unassignedDetail=await rpc('obtener_detalle_financiacion_compra_admin',[unassigned.id]);
 ok('cuota sin período conserva saldo operativo',unassignedDetail.saldo_pendiente===10&&unassignedDetail.cuotas[0].periodo_id===null);
 await operate(unassigned.id,'CANCELAR',{fecha:'2026-10-01',motivo:'Futura sin período',obligaciones:unassigned.quotas});
 ok('cuota sin período cancelada excluida',(await rpc('obtener_detalle_financiacion_compra_admin',[unassigned.id])).saldo_pendiente===0);
 const originalPayment=facts.pagos[0];
 ok('pago real original no se reescribe',JSON.stringify(originalPayment)===JSON.stringify(await scalar('select to_jsonb(p) from pagos_resumenes_tarjetas p where id=$1',[originalPayment.id])));
 await listings('historial completo');
 await db.exec(`set test.uid='${id(999)}'`);await rejects('RPC rechaza no admin',()=>operate(b.id,'DEVOLUCION',{fecha:'2026-10-20',motivo:'X',tramo_id:b.tramo,importe:1}));
 await db.exec('set role authenticated');await rejects('tablas sin acceso directo',()=>db.exec('select * from devoluciones_tarjetas'));
 console.log(`${checks} grupos OK`);
}finally{await db.close();}
