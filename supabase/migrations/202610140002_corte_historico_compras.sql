-- Corte de apertura: evidencia heredada, nunca salida de caja ni pago real.
-- Infraestructura únicamente: no carga compras, cortes ni períodos.
begin;
lock table public.operaciones_financieras_compras, public.obligaciones_tarjetas,
 public.aplicaciones_pagos_obligaciones, public.anulaciones_compras_gastos,
 public.periodos_tarjetas, public.pagos_resumenes_tarjetas, public.compras_gastos,
 public.items_compras_gastos, public.tarjetas_credito, public.financiaciones_compras,
 public.tramos_pago_compras, public.inicios_tramos_tarjeta in access exclusive mode;
do $preflight$
declare v record;
begin
 if to_regclass('public.cortes_historicos_obligaciones_tarjeta') is not null
 or to_regprocedure('public.registrar_corte_historico_obligacion_admin(uuid,uuid,text,date,numeric)') is not null then
  raise exception 'Corte histórico ya instalado o incompatible'; end if;
 for v in select * from (values
 ('public.registrar_pago_resumen_tarjeta_admin(uuid,uuid,date,numeric,text)','e4011fe47e79ceb9c1b94d92ed8816e5'),
 ('public.obtener_saldo_periodo_tarjeta_admin(uuid)','7a2d35a6eedc4ab87a4e72869dc96290'),
 ('public.listar_resumenes_tarjeta_admin(uuid,integer,integer)','457d13e458768f781c1e1980757923df'),
 ('public.obtener_financiacion_compra_admin(uuid)','2370f34dacb401a48e0831ae112cff69'),
 ('public.obtener_detalle_financiacion_compra_admin(uuid)','b56d2b022cf3f4dd5d750966cf809edd'),
 ('public.anular_compra_gasto_admin(uuid,uuid,text)','43997ac11ec83ab29003c322060068a5'),
 ('public.asignar_obligaciones_tarjeta_interno(uuid)','3e3a8d1f2afb61067d485b118931c2ea'),
 ('public.seleccionar_primer_periodo_tramo_admin(uuid,uuid,uuid)','177b2f2f6a01ef5c200f7f35b02119a6'),
 ('public.confirmar_financiacion_compra_admin(uuid,uuid,jsonb)','1cc6f484189deed19f845a1a9540d92e'),
 ('public.validar_financiacion_compras_integridad()','b7fd97c260a4dfb2526ea88b463a3722'),
 ('public.proteger_financiacion_compras()','5a7ff422d4ee99474154a431b09d0a58'),
 ('public.proteger_pagos_tarjetas()','1d9e9b8a038def57bc431e687f140e6a'),
 ('public.proteger_periodos_tarjetas()','b0f74a8189fcae71a409c101aba21fa1'),
 ('public.iniciar_operacion_financiera_compras(uuid,text,jsonb)','24f3395e9cd1e4f902cfcc111a2fa4ff'),
 ('public.finalizar_operacion_financiera_compras(uuid,text,jsonb,jsonb)','1f5cbf8eb06f5d71c8d3ad4abd262512')) x(firma,hash) loop
  if not exists(select 1 from pg_catalog.pg_proc where oid=to_regprocedure(v.firma)
   and md5(prosrc)=v.hash and proowner='postgres'::regrole and prosecdef
   and proconfig=array['search_path=""']) then
   raise exception 'Baseline incompatible: %',v.firma; end if;
  if exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    where p.oid=to_regprocedure(v.firma) and a.privilege_type='EXECUTE'
    and (a.grantee in (0,'anon'::regrole,'service_role'::regrole)
      or (a.grantee='authenticated'::regrole and p.proname in ('iniciar_operacion_financiera_compras','finalizar_operacion_financiera_compras','asignar_obligaciones_tarjeta_interno','validar_financiacion_compras_integridad','proteger_financiacion_compras','proteger_pagos_tarjetas','proteger_periodos_tarjetas')))) then
    raise exception 'ACL de función incompatible: %',v.firma; end if;
  if split_part(v.firma,'(',1) in ('public.registrar_pago_resumen_tarjeta_admin','public.obtener_saldo_periodo_tarjeta_admin','public.listar_resumenes_tarjeta_admin','public.obtener_financiacion_compra_admin','public.obtener_detalle_financiacion_compra_admin','public.anular_compra_gasto_admin','public.seleccionar_primer_periodo_tramo_admin','public.confirmar_financiacion_compra_admin')
    and not has_function_privilege('authenticated',to_regprocedure(v.firma),'EXECUTE') then
    raise exception 'EXECUTE Admin incompatible: %',v.firma; end if;
 end loop;
 if not exists(select 1 from pg_constraint where conrelid='public.operaciones_financieras_compras'::regclass
 and conname='operaciones_financieras_compras_accion_check' and convalidated
 and pg_get_constraintdef(oid)=$$CHECK ((accion = ANY (ARRAY['TARJETA'::text, 'PERIODO'::text, 'FINANCIACION'::text, 'PRIMER_PERIODO'::text, 'PAGO_RESUMEN'::text, 'COMPRA_FINANCIADA'::text, 'EDICION_TARJETA'::text, 'ANULACION_COMPRA'::text])))$$) then
 raise exception 'Acciones financieras incompatibles'; end if;
 if exists(select 1 from pg_class where oid in ('public.obligaciones_tarjetas'::regclass,
 'public.aplicaciones_pagos_obligaciones'::regclass,'public.operaciones_financieras_compras'::regclass,
 'public.anulaciones_compras_gastos'::regclass) and (relowner<>'postgres'::regrole or not relrowsecurity)) then
 raise exception 'Seguridad de tablas incompatible'; end if;
 if exists(select 1 from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
 where c.oid in ('public.obligaciones_tarjetas'::regclass,'public.aplicaciones_pagos_obligaciones'::regclass,
 'public.operaciones_financieras_compras'::regclass,'public.anulaciones_compras_gastos'::regclass)
 and a.grantee in (0,'anon'::regrole,'authenticated'::regrole,'service_role'::regrole)) then
 raise exception 'ACL de tablas incompatible'; end if;
 if exists(select 1 from pg_trigger where tgrelid in ('public.obligaciones_tarjetas'::regclass,
 'public.aplicaciones_pagos_obligaciones'::regclass,'public.anulaciones_compras_gastos'::regclass)
 and not tgisinternal and tgenabled<>'O') then raise exception 'Trigger deshabilitado'; end if;
 -- Fingerprint de columnas/defaults, constraints, índices y triggers de 12 tablas.
 -- No incluye filas, UUIDs de negocio ni valores operativos de secuencia.
 if (select md5(baseline::text) from (SELECT jsonb_object_agg(c.relname,jsonb_build_object(
 'columns',(SELECT jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attgenerated,pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
 'constraints',(SELECT jsonb_agg(jsonb_build_array(x.conname,x.contype,x.convalidated,pg_get_constraintdef(x.oid)) ORDER BY x.conname) FROM pg_constraint x WHERE x.conrelid=c.oid),
 'indexes',(SELECT jsonb_agg(jsonb_build_array(ic.relname,i.indisunique,i.indisvalid,pg_get_indexdef(i.indexrelid)) ORDER BY ic.relname) FROM pg_index i JOIN pg_class ic ON ic.oid=i.indexrelid WHERE i.indrelid=c.oid),
 'triggers',(SELECT jsonb_agg(jsonb_build_array(t.tgname,t.tgenabled,pg_get_triggerdef(t.oid)) ORDER BY t.tgname) FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal))) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('compras_gastos','items_compras_gastos','tarjetas_credito','financiaciones_compras','periodos_tarjetas','tramos_pago_compras','obligaciones_tarjetas','pagos_resumenes_tarjetas','aplicaciones_pagos_obligaciones','operaciones_financieras_compras','inicios_tramos_tarjeta','anulaciones_compras_gastos')) catalogo(baseline)) is distinct from '4f78f9b28bf2147b3af994e2b55e5258' then
 raise exception 'Estructura financiera incompatible'; end if;
end;
$preflight$;
alter table public.operaciones_financieras_compras drop constraint operaciones_financieras_compras_accion_check;
alter table public.operaciones_financieras_compras add constraint operaciones_financieras_compras_accion_check
 check(accion in ('TARJETA','PERIODO','FINANCIACION','PRIMER_PERIODO','PAGO_RESUMEN','COMPRA_FINANCIADA','EDICION_TARJETA','ANULACION_COMPRA','CORTE_HISTORICO'));
create table public.cortes_historicos_obligaciones_tarjeta (
 obligacion_id uuid primary key references public.obligaciones_tarjetas(id) on delete restrict,
 operacion_id uuid not null unique references public.operaciones_financieras_compras(operacion_id)
   on delete restrict deferrable initially deferred,
 fuente text not null check(fuente='GOOGLE_SHEETS_COMPRAS'),
 referencia text not null check(referencia=btrim(referencia) and length(referencia)>0),
 fecha_corte date not null check(isfinite(fecha_corte)),
 importe numeric not null check(importe>0 and importe<1000000000000000000 and importe=round(importe,2)),
 actor_id uuid not null references auth.users(id) on delete restrict,
 created_at timestamptz not null default clock_timestamp()
);
alter table public.cortes_historicos_obligaciones_tarjeta owner to postgres;
alter table public.cortes_historicos_obligaciones_tarjeta enable row level security;
revoke all on public.cortes_historicos_obligaciones_tarjeta from public,anon,authenticated,service_role;
create index cortes_historicos_obligaciones_fecha_idx on public.cortes_historicos_obligaciones_tarjeta(fecha_corte);

-- Defensa de orden de locks incluso para DML administrativo directo.
-- BEFORE STATEMENT se ejecuta antes de tomar locks de tuplas; BEFORE ROW
-- sería demasiado tarde en un UPDATE/DELETE de obligaciones.
-- Incluye pagos_resumenes_tarjetas: su trigger existente toma el período.
-- Las RPC ya poseen este mismo lock global, que es reentrante en la transacción.
create function public.bloquear_escritura_corte_historico() returns trigger
language plpgsql volatile security definer set search_path='' as $fn$
begin
 if current_setting('transaction_isolation')<>'read committed' then
  raise exception 'Cortes históricos requieren READ COMMITTED' using errcode='25000';
 end if;
 perform pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('hugella:finanzas:escritura',0));
 return null;
end;
$fn$;
alter function public.bloquear_escritura_corte_historico() owner to postgres;
revoke all on function public.bloquear_escritura_corte_historico()
 from public,anon,authenticated,service_role;
create trigger a_corte_lock_sentencia before insert or update or delete
 on public.cortes_historicos_obligaciones_tarjeta for each statement
 execute function public.bloquear_escritura_corte_historico();
create trigger a_corte_lock_sentencia before insert or update or delete
 on public.aplicaciones_pagos_obligaciones for each statement
 execute function public.bloquear_escritura_corte_historico();
create trigger a_corte_lock_sentencia before insert or update or delete
 on public.obligaciones_tarjetas for each statement
 execute function public.bloquear_escritura_corte_historico();
create trigger a_corte_lock_sentencia before insert or update or delete
 on public.anulaciones_compras_gastos for each statement
 execute function public.bloquear_escritura_corte_historico();
create trigger a_corte_lock_sentencia before insert or update or delete
 on public.pagos_resumenes_tarjetas for each statement
 execute function public.bloquear_escritura_corte_historico();

-- Defensa compartida, antes de triggers de locks existentes (orden alfabético).
-- READ COMMITTED permite releer después de esperar el lock global.
-- También protege INSERT administrativos directos; no depende solo de la RPC.
create function public.proteger_corte_historico_obligacion_tarjeta() returns trigger
language plpgsql volatile security definer set search_path='' as $fn$
declare v_obligacion public.obligaciones_tarjetas%rowtype;
begin
 if current_setting('transaction_isolation')<>'read committed' then
 raise exception 'Cortes históricos requieren READ COMMITTED' using errcode='25000'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('hugella:finanzas:escritura',0));
 if tg_table_name='cortes_historicos_obligaciones_tarjeta' then
  if tg_op<>'INSERT' then raise exception 'Corte histórico inmutable' using errcode='23514'; end if;
  select * into v_obligacion from public.obligaciones_tarjetas where id=new.obligacion_id;
  if not found or v_obligacion.periodo_id is null or not exists(select 1 from public.financiaciones_compras f where f.compra_id=v_obligacion.compra_id and f.estado='CONFIRMADA')
   or exists(select 1 from public.anulaciones_compras_gastos a where a.compra_gasto_id=v_obligacion.compra_id) then
   raise exception 'Corte requiere obligación confirmada, asignada y no anulada' using errcode='23514'; end if;
  if new.importe is distinct from v_obligacion.importe then raise exception 'Corte debe cubrir obligación completa' using errcode='23514'; end if;
  if exists(select 1 from public.aplicaciones_pagos_obligaciones a where a.obligacion_id=v_obligacion.id) then
   raise exception 'Obligación con pago real' using errcode='23514'; end if;
 elsif tg_table_name='aplicaciones_pagos_obligaciones' then
  if exists(select 1 from public.cortes_historicos_obligaciones_tarjeta c where c.obligacion_id=new.obligacion_id) then
   raise exception 'Obligación saldada históricamente' using errcode='23514'; end if;
 elsif tg_table_name='anulaciones_compras_gastos' then
  if exists(select 1 from public.cortes_historicos_obligaciones_tarjeta c join public.obligaciones_tarjetas o on o.id=c.obligacion_id where o.compra_id=new.compra_gasto_id) then
   raise exception 'Compra con corte histórico: requiere corrección auditada específica' using errcode='23514'; end if;
 elsif tg_table_name='obligaciones_tarjetas' then
  if exists(select 1 from public.cortes_historicos_obligaciones_tarjeta c where c.obligacion_id=old.id)
   and (tg_op='DELETE' or to_jsonb(new) is distinct from to_jsonb(old)) then
   raise exception 'Obligación con corte histórico inmutable, incluido período' using errcode='23514'; end if;
 else raise exception 'Tabla de defensa desconocida'; end if;
 if tg_op='DELETE' then return old; end if; return new;
end;
$fn$;
create trigger a_corte_historico_defensa before insert or update or delete on public.cortes_historicos_obligaciones_tarjeta for each row execute function public.proteger_corte_historico_obligacion_tarjeta();
create trigger a_corte_aplicacion_defensa before insert on public.aplicaciones_pagos_obligaciones for each row execute function public.proteger_corte_historico_obligacion_tarjeta();
create trigger a_corte_anulacion_defensa before insert on public.anulaciones_compras_gastos for each row execute function public.proteger_corte_historico_obligacion_tarjeta();
create trigger a_corte_obligacion_defensa before update or delete on public.obligaciones_tarjetas for each row execute function public.proteger_corte_historico_obligacion_tarjeta();

-- FK diferida permite insertar evidencia antes de finalizar la operación.
-- Comprueba el vínculo contable, actor y solicitud al finalizar la transacción.
create function public.validar_operacion_corte_historico() returns trigger
language plpgsql security definer set search_path='' as $fn$
begin
 if not exists(select 1 from public.operaciones_financieras_compras op where op.operacion_id=new.operacion_id
 and op.accion='CORTE_HISTORICO' and op.actor_id=new.actor_id
 and op.solicitud=jsonb_build_object('obligacion_id',new.obligacion_id,'fuente',new.fuente,
 'referencia',new.referencia,'fecha_corte',new.fecha_corte,'importe',new.importe)) then
 raise exception 'Operación de corte incompatible' using errcode='23514'; end if;
 return null;
end;
$fn$;
create constraint trigger corte_operacion_integridad after insert on public.cortes_historicos_obligaciones_tarjeta
 deferrable initially deferred for each row execute function public.validar_operacion_corte_historico();
create function public.registrar_corte_historico_obligacion_admin(p_operacion_id uuid,p_obligacion_id uuid,p_referencia text,p_fecha_corte date,p_importe numeric)
returns jsonb language plpgsql volatile security definer set search_path='' as $rpc$
declare v_req jsonb; v_res jsonb; o public.obligaciones_tarjetas%rowtype; c public.cortes_historicos_obligaciones_tarjeta%rowtype;
begin
 v_req:=jsonb_build_object('obligacion_id',p_obligacion_id,'fuente','GOOGLE_SHEETS_COMPRAS','referencia',nullif(btrim(p_referencia),''),'fecha_corte',p_fecha_corte,'importe',p_importe);
 v_res:=public.iniciar_operacion_financiera_compras(p_operacion_id,'CORTE_HISTORICO',v_req);
 if v_res is not null then return v_res; end if;
 if p_obligacion_id is null or nullif(btrim(p_referencia),'') is null or p_fecha_corte is null or not isfinite(p_fecha_corte)
 or p_importe is null or p_importe<=0 or p_importe>=1000000000000000000 or p_importe<>round(p_importe,2) then raise exception 'Corte inválido' using errcode='22023'; end if;
 select * into o from public.obligaciones_tarjetas where id=p_obligacion_id;
 if not found then raise exception 'Obligación inexistente' using errcode='22023'; end if;
 perform 1 from public.compras_gastos where id=o.compra_id for update;
 perform 1 from public.tarjetas_credito where id=o.tarjeta_id for update;
 perform 1 from public.periodos_tarjetas where id=o.periodo_id for update;
 perform 1 from public.obligaciones_tarjetas where id=o.id for update;
 insert into public.cortes_historicos_obligaciones_tarjeta(obligacion_id,operacion_id,fuente,referencia,fecha_corte,importe,actor_id)
 values(p_obligacion_id,p_operacion_id,'GOOGLE_SHEETS_COMPRAS',btrim(p_referencia),p_fecha_corte,p_importe,auth.uid()) returning * into c;
 return public.finalizar_operacion_financiera_compras(p_operacion_id,'CORTE_HISTORICO',v_req,to_jsonb(c)||jsonb_build_object('estado','SALDADA_HISTORICAMENTE'));
end;
$rpc$;

create or replace function public.registrar_pago_resumen_tarjeta_admin(p_operacion_id uuid,p_periodo_id uuid,p_fecha_pago date,p_importe numeric,p_referencia text default null)
returns jsonb language plpgsql volatile security definer set search_path='' as $rpc$
declare v_req jsonb; v_res jsonb; v_pago uuid; v_restante numeric; v_aplicar numeric; o record;
begin
  v_req:=jsonb_build_object('periodo_id',p_periodo_id,'fecha_pago',p_fecha_pago,'importe',p_importe,'referencia',nullif(btrim(p_referencia),''));
  v_res:=public.iniciar_operacion_financiera_compras(p_operacion_id,'PAGO_RESUMEN',v_req);
  if v_res is not null then return v_res; end if;
  if p_periodo_id is null or p_fecha_pago is null or not isfinite(p_fecha_pago)
    or p_importe is null or p_importe<=0 or p_importe>=1000000000000000000 or p_importe<>round(p_importe,2) then
    raise exception 'Pago inválido' using errcode='22023'; end if;
  perform 1 from public.periodos_tarjetas where id=p_periodo_id for update;
  if not found then raise exception 'Período inexistente' using errcode='22023'; end if;
  insert into public.pagos_resumenes_tarjetas(periodo_id,fecha_pago,importe,referencia,actor_id)
    values(p_periodo_id,p_fecha_pago,p_importe,nullif(btrim(p_referencia),''),auth.uid()) returning id into v_pago;
  v_restante:=p_importe;
  for o in select ob.id,ob.importe-coalesce((select ch.importe from public.cortes_historicos_obligaciones_tarjeta ch where ch.obligacion_id=ob.id),0)-coalesce((select sum(a.importe) from public.aplicaciones_pagos_obligaciones a where a.obligacion_id=ob.id),0) saldo
    from public.obligaciones_tarjetas ob join public.financiaciones_compras f on f.compra_id=ob.compra_id
    where ob.periodo_id=p_periodo_id and f.estado='CONFIRMADA' and not exists(select 1 from public.anulaciones_compras_gastos ac where ac.compra_gasto_id=ob.compra_id)
    order by ob.numero_cuota,ob.compra_id,ob.tramo_id,ob.id loop
    if o.saldo<0 then raise exception 'Saldo de obligación inconsistente' using errcode='23514'; end if;
    if o.saldo=0 then continue; end if;
    v_aplicar:=least(v_restante,o.saldo);
    insert into public.aplicaciones_pagos_obligaciones(pago_id,obligacion_id,importe) values(v_pago,o.id,v_aplicar);
    v_restante:=v_restante-v_aplicar;
    if v_restante=0 then exit; end if;
  end loop;
  if v_restante<>0 then raise exception 'Pago excede saldo distribuible' using errcode='23514'; end if;
  return public.finalizar_operacion_financiera_compras(p_operacion_id,'PAGO_RESUMEN',v_req,
    jsonb_build_object('operacion_id',p_operacion_id,'pago_id',v_pago,'importe',p_importe,
      'aplicaciones',(select jsonb_agg(to_jsonb(a) order by a.obligacion_id) from public.aplicaciones_pagos_obligaciones a where a.pago_id=v_pago)));
end;
$rpc$;

-- total_pagado incluye únicamente hechos reales (tramos inmediatos + aplicaciones).
-- saldo_historico conserva el cálculo previo sin corte para auditoría;
-- saldo/saldo_pendiente/saldo_operativo descuentan corte y pagos, anuladas = 0.
-- PAGADO agregado conserva compatibilidad: saldo cerrado, no prueba caja.
create or replace function public.obtener_saldo_periodo_tarjeta_admin(p_periodo_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $rpc$
declare v_total numeric; v_pagado numeric; v_corte numeric;
begin
  if auth.uid() is null or public.es_admin_hugella() is not true then raise exception 'No autorizado' using errcode='42501'; end if;
  perform 1 from public.periodos_tarjetas where id=p_periodo_id;
  if not found then raise exception 'Período inexistente' using errcode='22023'; end if;
  select coalesce(sum(o.importe),0) into v_total from public.obligaciones_tarjetas o
    join public.financiaciones_compras f on f.compra_id=o.compra_id where o.periodo_id=p_periodo_id and f.estado='CONFIRMADA' and not exists(select 1 from public.anulaciones_compras_gastos ac where ac.compra_gasto_id=o.compra_id);
  select coalesce(sum(importe),0) into v_pagado from public.pagos_resumenes_tarjetas where periodo_id=p_periodo_id;
  select coalesce(sum(ch.importe),0) into v_corte from public.cortes_historicos_obligaciones_tarjeta ch join public.obligaciones_tarjetas o on o.id=ch.obligacion_id where o.periodo_id=p_periodo_id and not exists(select 1 from public.anulaciones_compras_gastos ac where ac.compra_gasto_id=o.compra_id);
  if v_total-v_corte-v_pagado<0 then raise exception 'Saldo financiero inconsistente' using errcode='23514'; end if;
  return jsonb_build_object('periodo_id',p_periodo_id,'total_obligaciones_hugella',v_total,'total_pagado',v_pagado,'total_corte_historico',v_corte,'saldo',v_total-v_corte-v_pagado,
    'estado',case when v_total=0 and v_pagado=0 then 'SIN_OBLIGACIONES' when v_total=v_pagado+v_corte then 'PAGADO' when v_pagado+v_corte=0 then 'PENDIENTE' else 'PAGO_PARCIAL' end);
end;
$rpc$;
create or replace function public.listar_resumenes_tarjeta_admin(p_tarjeta_id uuid,p_limite integer default 50,p_offset integer default 0)
returns table(periodo_id uuid,orden integer,fecha_cierre date,fecha_vencimiento date,
  total_obligaciones_hugella numeric,total_pagado numeric,saldo numeric,estado text)
language plpgsql stable security definer set search_path='' as $rpc$
begin
  if auth.uid() is null or public.es_admin_hugella() is not true then raise exception 'No autorizado' using errcode='42501'; end if;
  if p_tarjeta_id is null or p_limite is null or p_limite not between 1 and 100 or p_offset is null or p_offset<0 then
    raise exception 'Paginación inválida' using errcode='22023'; end if;
  if not exists(select 1 from public.tarjetas_credito where id=p_tarjeta_id) then
    raise exception 'Tarjeta inexistente' using errcode='22023'; end if;
  -- Página primero. Reutiliza el cálculo JSON con rechazo explícito de inconsistencias.
  return query select p.id,p.orden,p.fecha_cierre,p.fecha_vencimiento,
    (r.j->>'total_obligaciones_hugella')::numeric,(r.j->>'total_pagado')::numeric,
    (r.j->>'saldo')::numeric,r.j->>'estado'
    from (select per.* from public.periodos_tarjetas per where per.tarjeta_id=p_tarjeta_id
      order by per.orden limit p_limite offset p_offset) p
    cross join lateral (select public.obtener_saldo_periodo_tarjeta_admin(p.id) j) r
    order by p.orden;
end;
$rpc$;
create or replace function public.obtener_financiacion_compra_admin(p_compra_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $rpc$
declare v_total numeric; v_pagado numeric; v_estado text; v_anulacion jsonb; v_saldo_operativo numeric; v_corte numeric;
begin
  if auth.uid() is null or public.es_admin_hugella() is not true then raise exception 'No autorizado' using errcode='42501'; end if;
  perform 1 from public.compras_gastos where id=p_compra_id;
  if not found then raise exception 'Compra inexistente' using errcode='22023'; end if;
  select sum(total) into v_total from public.items_compras_gastos where compra_gasto_id=p_compra_id;
  select estado into v_estado from public.financiaciones_compras where compra_id=p_compra_id;
  select to_jsonb(ac) into v_anulacion from public.anulaciones_compras_gastos ac where ac.compra_gasto_id=p_compra_id;
  if v_estado is distinct from 'CONFIRMADA' then
    return jsonb_build_object('compra_id',p_compra_id,'total_compra',v_total,'total_pagado',null,'saldo_historico',null,'saldo_operativo',case when v_anulacion is not null then 0 else null end,
      'saldo_pendiente',case when v_anulacion is not null then 0 else null end,
      'estado',case when v_anulacion is not null then 'ANULADA' else 'FINANCIACION_NO_REGISTRADA' end,'anulacion',v_anulacion,'estado_financiacion',v_estado);
  end if;
  select coalesce(sum(importe),0) into v_pagado from public.tramos_pago_compras where compra_id=p_compra_id and medio<>'TARJETA_CREDITO';
  v_pagado:=v_pagado+coalesce((select sum(a.importe) from public.aplicaciones_pagos_obligaciones a
    join public.obligaciones_tarjetas o on o.id=a.obligacion_id where o.compra_id=p_compra_id),0);
  select coalesce(sum(ch.importe),0) into v_corte from public.cortes_historicos_obligaciones_tarjeta ch join public.obligaciones_tarjetas o on o.id=ch.obligacion_id where o.compra_id=p_compra_id;
  if v_total-v_pagado-v_corte<0 then raise exception 'Saldo financiero inconsistente' using errcode='23514'; end if;
  -- Saldo histórico conserva importe menos pagos reales; corte se expone separado.
  -- Conserva el saldo histórico; el campo compatible saldo_pendiente es operativo.
  v_saldo_operativo:=case when v_anulacion is not null then 0 else v_total-v_pagado-v_corte end;
  return jsonb_build_object('compra_id',p_compra_id,'total_compra',v_total,'total_pagado',v_pagado,
    'total_corte_historico',v_corte,'saldo_historico',v_total-v_pagado,'saldo_operativo',v_saldo_operativo,'saldo_pendiente',v_saldo_operativo,
    'anulacion',v_anulacion,'estado',case when v_anulacion is not null then 'ANULADA' when v_total=v_pagado+v_corte then 'CANCELADA' else 'ACTIVA' end,'estado_financiacion',v_estado);
end;
$rpc$;
create or replace function public.obtener_detalle_financiacion_compra_admin(p_compra_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $rpc$
declare v_res jsonb; v_formas jsonb; v_cuotas jsonb;
begin
  if auth.uid() is null or public.es_admin_hugella() is not true then raise exception 'No autorizado' using errcode='42501'; end if;
  v_res:=public.obtener_financiacion_compra_admin(p_compra_id);
  -- Históricos sin confirmación no se presentan como hechos financieros confirmados.
  if v_res->>'estado_financiacion' is distinct from 'CONFIRMADA' then
    return v_res||jsonb_build_object('formas_pago','[]'::jsonb,'cuotas','[]'::jsonb);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('tramo_id',t.id,'posicion',t.posicion,
    'medio',t.medio,'importe',t.importe,'fecha_pago',t.fecha_pago,'tarjeta_id',t.tarjeta_id,
    'tarjeta_nombre',c.nombre,'entidad',c.entidad,'cantidad_cuotas',t.cantidad_cuotas,
    'primer_periodo_id',i.primer_periodo_id) order by t.posicion),'[]') into v_formas
    from public.tramos_pago_compras t left join public.tarjetas_credito c on c.id=t.tarjeta_id
    left join public.inicios_tramos_tarjeta i on i.tramo_id=t.id where t.compra_id=p_compra_id;
  select coalesce(jsonb_agg(jsonb_build_object('obligacion_id',o.id,'tramo_id',o.tramo_id,
    'numero_cuota',o.numero_cuota,'cantidad_cuotas',o.cantidad_cuotas,'importe',o.importe,
    'periodo_id',o.periodo_id,'fecha_cierre',p.fecha_cierre,'fecha_vencimiento',p.fecha_vencimiento,
    -- saldo conserva su significado operativo; saldo_historico conserva el hecho previo.
    'total_aplicado',a.pagado,'importe_corte_historico',coalesce(ch.importe,0),'saldo_historico',o.importe-a.pagado,
    'saldo_operativo',case when v_res->>'estado'='ANULADA' then 0 else o.importe-a.pagado-coalesce(ch.importe,0) end,
    'saldo',case when v_res->>'estado'='ANULADA' then 0 else o.importe-a.pagado-coalesce(ch.importe,0) end,
    'estado',case when v_res->>'estado'='ANULADA' then 'ANULADA' when ch.obligacion_id is not null then 'SALDADA_HISTORICAMENTE' when a.pagado=0 then 'PENDIENTE' when a.pagado=o.importe then 'PAGADA' else 'PAGO_PARCIAL' end)
    order by t.posicion,o.numero_cuota),'[]') into v_cuotas
    from public.obligaciones_tarjetas o join public.tramos_pago_compras t on t.id=o.tramo_id
    left join public.cortes_historicos_obligaciones_tarjeta ch on ch.obligacion_id=o.id
    left join public.periodos_tarjetas p on p.id=o.periodo_id
    cross join lateral (select coalesce(sum(ap.importe),0) pagado
      from public.aplicaciones_pagos_obligaciones ap where ap.obligacion_id=o.id) a
    where o.compra_id=p_compra_id;
  return v_res||jsonb_build_object('formas_pago',v_formas,'cuotas',v_cuotas);
end;
$rpc$;
alter function public.proteger_corte_historico_obligacion_tarjeta() owner to postgres;
alter function public.validar_operacion_corte_historico() owner to postgres;
revoke all on function public.proteger_corte_historico_obligacion_tarjeta(),public.validar_operacion_corte_historico() from public,anon,authenticated,service_role;
alter function public.registrar_corte_historico_obligacion_admin(uuid,uuid,text,date,numeric) owner to postgres;
revoke all on function public.registrar_corte_historico_obligacion_admin(uuid,uuid,text,date,numeric) from public,anon,authenticated,service_role;
grant execute on function public.registrar_corte_historico_obligacion_admin(uuid,uuid,text,date,numeric) to authenticated;
alter function public.registrar_pago_resumen_tarjeta_admin(uuid,uuid,date,numeric,text) owner to postgres;
revoke all on function public.registrar_pago_resumen_tarjeta_admin(uuid,uuid,date,numeric,text) from public,anon,authenticated,service_role;
grant execute on function public.registrar_pago_resumen_tarjeta_admin(uuid,uuid,date,numeric,text) to authenticated;
alter function public.obtener_saldo_periodo_tarjeta_admin(uuid) owner to postgres;
revoke all on function public.obtener_saldo_periodo_tarjeta_admin(uuid) from public,anon,authenticated,service_role;
grant execute on function public.obtener_saldo_periodo_tarjeta_admin(uuid) to authenticated;
alter function public.listar_resumenes_tarjeta_admin(uuid,integer,integer) owner to postgres;
revoke all on function public.listar_resumenes_tarjeta_admin(uuid,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.listar_resumenes_tarjeta_admin(uuid,integer,integer) to authenticated;
alter function public.obtener_financiacion_compra_admin(uuid) owner to postgres;
revoke all on function public.obtener_financiacion_compra_admin(uuid) from public,anon,authenticated,service_role;
grant execute on function public.obtener_financiacion_compra_admin(uuid) to authenticated;
alter function public.obtener_detalle_financiacion_compra_admin(uuid) owner to postgres;
revoke all on function public.obtener_detalle_financiacion_compra_admin(uuid) from public,anon,authenticated,service_role;
grant execute on function public.obtener_detalle_financiacion_compra_admin(uuid) to authenticated;

set constraints all immediate;
commit;
