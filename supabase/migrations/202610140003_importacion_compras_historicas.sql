-- Infraestructura solamente. Sin carga de compras históricas ni períodos.
-- Baseline: migraciones hasta 202610140002; aborta ante drift y cortes existentes.
begin;
lock table public.compras_gastos, public.items_compras_gastos,
 public.operaciones_compras_gastos, public.operaciones_financieras_compras,
 public.financiaciones_compras, public.tramos_pago_compras, public.obligaciones_tarjetas,
 public.inicios_tramos_tarjeta, public.tarjetas_credito, public.periodos_tarjetas,
 public.pagos_resumenes_tarjetas, public.aplicaciones_pagos_obligaciones,
 public.anulaciones_compras_gastos, public.cortes_historicos_obligaciones_tarjeta
 in access exclusive mode;
do $preflight$
declare v record;
begin
 if current_setting('server_version_num')::integer<170000 then
  raise exception 'Importación histórica requiere PostgreSQL 17 o posterior'; end if;
 if exists(select 1 from public.cortes_historicos_obligaciones_tarjeta) then
  raise exception 'Se esperaba cero cortes históricos'; end if;
 if exists(select 1 from pg_attribute where attrelid='public.compras_gastos'::regclass
  and attname in ('fuente','id_origen') and not attisdropped)
  or to_regprocedure('public.importar_compra_historica_admin(uuid,text,text,uuid,date,text,text,text,text,numeric,jsonb)') is not null then
  raise exception 'Infraestructura histórica ya instalada o incompatible'; end if;
 for v in select * from (values
 ('public.crear_compra_gasto_admin(uuid,text,uuid,date,text,text,text,jsonb)','c12fd08eca171b7af8e5fb9b433fb23b'),
 ('public.crear_compra_financiada_admin(uuid,text,uuid,date,text,text,text,jsonb,jsonb)','4dd5dd93376f2dd8f6313ce315267c69'),
 ('public.confirmar_financiacion_compra_admin(uuid,uuid,jsonb)','1cc6f484189deed19f845a1a9540d92e'),
 ('public.asignar_obligaciones_tarjeta_interno(uuid)','3e3a8d1f2afb61067d485b118931c2ea'),
 ('public.proteger_financiacion_compras()','5a7ff422d4ee99474154a431b09d0a58'),
 ('public.validar_financiacion_compras_integridad()','b7fd97c260a4dfb2526ea88b463a3722'),
 ('public.iniciar_operacion_financiera_compras(uuid,text,jsonb)','24f3395e9cd1e4f902cfcc111a2fa4ff'),
 ('public.finalizar_operacion_financiera_compras(uuid,text,jsonb,jsonb)','1f5cbf8eb06f5d71c8d3ad4abd262512'),
 ('public.proteger_corte_historico_obligacion_tarjeta()','8dcfbf41ce16a523edc986d45226e52f'),
 ('public.registrar_corte_historico_obligacion_admin(uuid,uuid,text,date,numeric)','1638e2a688edd49b61a9ac11f5692b1c')
 ) x(firma,hash) loop
  if not exists(select 1 from pg_proc where oid=to_regprocedure(v.firma) and md5(prosrc)=v.hash
    and proowner='postgres'::regrole and prosecdef and proconfig=array['search_path=""']) then
   raise exception 'Baseline RPC incompatible: %',v.firma; end if;
  if exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    where p.oid=to_regprocedure(v.firma) and a.privilege_type='EXECUTE'
    and (a.grantee in (0,'anon'::regrole,'service_role'::regrole)
      or (a.grantee='authenticated'::regrole and p.proname in
        ('asignar_obligaciones_tarjeta_interno','proteger_financiacion_compras',
         'validar_financiacion_compras_integridad','iniciar_operacion_financiera_compras',
         'finalizar_operacion_financiera_compras','proteger_corte_historico_obligacion_tarjeta')))) then
   raise exception 'ACL de función incompatible: %',v.firma; end if;
  if split_part(v.firma,'(',1) in ('public.crear_compra_gasto_admin','public.crear_compra_financiada_admin',
    'public.confirmar_financiacion_compra_admin','public.registrar_corte_historico_obligacion_admin')
    and not has_function_privilege('authenticated',to_regprocedure(v.firma),'EXECUTE') then
   raise exception 'EXECUTE administrativo incompatible: %',v.firma; end if;
 end loop;
 if exists(select 1 from pg_class c where c.oid in (
  'public.compras_gastos'::regclass,'public.items_compras_gastos'::regclass,
  'public.operaciones_compras_gastos'::regclass,'public.operaciones_financieras_compras'::regclass,
  'public.cortes_historicos_obligaciones_tarjeta'::regclass)
  and (c.relowner<>'postgres'::regrole or not c.relrowsecurity
   or exists(select 1 from pg_policy where polrelid=c.oid)
   or exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
     where a.grantee in (0,'anon'::regrole,'authenticated'::regrole,'service_role'::regrole)))) then
  raise exception 'Seguridad de tablas incompatible'; end if;
 if (select md5(baseline::text) from (SELECT jsonb_object_agg(c.relname,jsonb_build_object(
 'columns',(SELECT jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attgenerated,pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
 'constraints',(SELECT jsonb_agg(jsonb_build_array(x.conname,x.contype,x.convalidated,pg_get_constraintdef(x.oid)) ORDER BY x.conname) FROM pg_constraint x WHERE x.conrelid=c.oid),
 'indexes',(SELECT jsonb_agg(jsonb_build_array(ic.relname,i.indisunique,i.indisvalid,pg_get_indexdef(i.indexrelid)) ORDER BY ic.relname) FROM pg_index i JOIN pg_class ic ON ic.oid=i.indexrelid WHERE i.indrelid=c.oid),
 'triggers',(SELECT jsonb_agg(jsonb_build_array(t.tgname,t.tgenabled,pg_get_triggerdef(t.oid)) ORDER BY t.tgname) FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal))) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('compras_gastos','items_compras_gastos','tarjetas_credito','financiaciones_compras','periodos_tarjetas','tramos_pago_compras','obligaciones_tarjetas','pagos_resumenes_tarjetas','aplicaciones_pagos_obligaciones','operaciones_financieras_compras','inicios_tramos_tarjeta','anulaciones_compras_gastos')) catalogo(baseline)) is distinct from 'ec512f62839827b3048233431f5c26d5' then
  raise exception 'Estructura financiera incompatible'; end if;
end;
$preflight$;

alter table public.compras_gastos
 add column fuente text,
 add column id_origen text,
 add constraint compras_gastos_procedencia_check check (
  (fuente is null and id_origen is null) or
  (fuente is not null and fuente='GOOGLE_SHEETS_COMPRAS'
   and id_origen is not null and id_origen ~ '^HG-[0-9]{4}$')),
 add constraint compras_gastos_fuente_id_origen_unique unique(fuente,id_origen);

alter table public.items_compras_gastos
 add column modalidad text not null default 'DETALLADO',
 add column importe_historico numeric,
 alter column cantidad drop not null,
 alter column costo_unitario drop not null,
 add constraint items_compras_gastos_modalidad_check check (
  (modalidad='DETALLADO' and cantidad is not null and costo_unitario is not null and importe_historico is null)
  or (modalidad='TOTAL_HISTORICO' and cantidad is null and costo_unitario is null
   and importe_historico is not null and importe_historico>=0
   and importe_historico<=9999999999999999.99 and importe_historico=round(importe_historico,2)));
-- PostgreSQL 17: conserva la columna, sus dependencias y la restricción de total.
alter table public.items_compras_gastos alter column total set expression as (
 case when modalidad='TOTAL_HISTORICO' then importe_historico else round(cantidad*costo_unitario,2) end);

create function public.proteger_procedencia_compra() returns trigger
language plpgsql security definer set search_path='' as $fn$
begin
 if row(new.fuente,new.id_origen) is distinct from row(old.fuente,old.id_origen) then
  raise exception 'Procedencia de compra inmutable' using errcode='23514'; end if;
 return new;
end;
$fn$;
create trigger a_procedencia_compra_inmutable before update on public.compras_gastos
 for each row execute function public.proteger_procedencia_compra();

-- Valida el conjunto al COMMIT: resumen único y evidencia de la RPC controlada.
-- Locks del padre serializan inserciones/traslados de ítems (trigger financiero existente).
create function public.validar_compra_historica_integridad() returns trigger
language plpgsql security definer set search_path='' as $fn$
declare v_id uuid; v_ids uuid[]; c public.compras_gastos%rowtype; i public.items_compras_gastos%rowtype; v_compra jsonb;
begin
 if tg_table_name='compras_gastos' then
  v_ids:=array[case when tg_op<>'DELETE' then new.id end,case when tg_op<>'INSERT' then old.id end];
 else
  v_ids:=array[case when tg_op<>'DELETE' then new.compra_gasto_id end,case when tg_op<>'INSERT' then old.compra_gasto_id end];
 end if;
 for v_id in select distinct x from unnest(v_ids) x where x is not null loop
  select * into c from public.compras_gastos where id=v_id;
  if not found then continue; end if;
  if c.fuente is null then
   if exists(select 1 from public.items_compras_gastos where compra_gasto_id=v_id and modalidad<>'DETALLADO') then
    raise exception 'Resumen histórico requiere procedencia histórica' using errcode='23514'; end if;
  else
   if (select count(*) from public.items_compras_gastos where compra_gasto_id=v_id)<>1 then
    raise exception 'Compra histórica requiere exactamente un resumen' using errcode='23514'; end if;
   select * into i from public.items_compras_gastos where compra_gasto_id=v_id;
   if i.modalidad<>'TOTAL_HISTORICO' or i.posicion<>1 then
    raise exception 'Compra histórica solo admite resumen histórico' using errcode='23514'; end if;
   v_compra:=jsonb_build_object('fuente',c.fuente,'id_origen',c.id_origen,'tipo',c.tipo,
    'proveedor_id',c.proveedor_id,'fecha',c.fecha,'moneda',c.moneda,'comprobante',c.comprobante,
    'observaciones',c.observaciones,'descripcion',i.descripcion,'total',i.total);
   if not exists(select 1 from public.operaciones_financieras_compras op
     join public.operaciones_compras_gastos oc on oc.operacion_id=(op.resultado->>'operacion_compra_id')::uuid
     join public.financiaciones_compras f on f.compra_id=c.id
     where op.accion='IMPORTACION_COMPRA_HISTORICA' and op.actor_id=c.actor_id
      and op.resultado->>'compra_id'=c.id::text and op.solicitud->'compra'=v_compra
      and oc.compra_gasto_id=c.id and oc.actor_id=c.actor_id and oc.solicitud=v_compra
      and f.estado='CONFIRMADA') then
    raise exception 'Compra histórica requiere operación de importación compatible' using errcode='23514'; end if;
  end if;
 end loop;
 return null;
end;
$fn$;
create constraint trigger compra_historica_integridad after insert or update or delete on public.compras_gastos
 deferrable initially deferred for each row execute function public.validar_compra_historica_integridad();
create constraint trigger item_historico_integridad after insert or update or delete on public.items_compras_gastos
 deferrable initially deferred for each row execute function public.validar_compra_historica_integridad();

create function public.canonicalizar_tramos_compra_interno(p_tramos jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $fn$
declare
 x jsonb; v_tramos jsonb:='[]'; v_suma numeric:=0;
 v_pos integer; v_medio text; v_importe numeric; v_cuotas integer; v_tarjeta uuid; v_primero uuid; v_fecha date;
begin
  -- Autorización antes de procesar payload; también se exige en el helper.
  if auth.uid() is null or public.es_admin_hugella() is not true then raise exception 'No autorizado' using errcode='42501'; end if;
  if p_tramos is null or jsonb_typeof(p_tramos)<>'array'
    or jsonb_array_length(p_tramos)>1000 then raise exception 'Tramos inválidos' using errcode='22023'; end if;
  for x in select value from jsonb_array_elements(p_tramos) loop
    if jsonb_typeof(x)<>'object' or not (x ?& array['posicion','medio','importe'])
      or (x-array['posicion','medio','importe','tarjeta_id','cantidad_cuotas','fecha_pago','primer_periodo_id'])<>'{}'
      or jsonb_typeof(x->'posicion')<>'number' or jsonb_typeof(x->'medio')<>'string'
      or jsonb_typeof(x->'importe')<>'number' then raise exception 'Campos de tramo inválidos' using errcode='22023'; end if;
    if (x->>'posicion')::numeric<>trunc((x->>'posicion')::numeric)
      or (x->>'posicion')::numeric not between 1 and 1000 then raise exception 'Posición inválida' using errcode='22023'; end if;
    v_pos:=(x->>'posicion')::integer; v_medio:=x->>'medio'; v_importe:=(x->>'importe')::numeric;
    if v_medio not in ('EFECTIVO','TRANSFERENCIA','TARJETA_DEBITO','TARJETA_CREDITO')
      or v_importe<=0 or v_importe>=1000000000000000000 or v_importe<>round(v_importe,2) then
      raise exception 'Medio o importe inválido' using errcode='22023'; end if;
    v_tarjeta:=(x->>'tarjeta_id')::uuid; v_primero:=(x->>'primer_periodo_id')::uuid; v_fecha:=(x->>'fecha_pago')::date;
    v_cuotas:=null;
    if v_medio='TARJETA_CREDITO' then
      if v_tarjeta is null or v_fecha is not null or jsonb_typeof(x->'cantidad_cuotas') is distinct from 'number'
        or (x->>'cantidad_cuotas')::numeric<>trunc((x->>'cantidad_cuotas')::numeric)
        or (x->>'cantidad_cuotas')::numeric not between 1 and 1000
        or (x->>'cantidad_cuotas')::numeric>v_importe*100 then raise exception 'Cuotas de tarjeta inválidas' using errcode='22023'; end if;
      v_cuotas:=(x->>'cantidad_cuotas')::integer;
    elsif v_tarjeta is not null or v_primero is not null or x->>'cantidad_cuotas' is not null
      or v_fecha is null or not isfinite(v_fecha) then raise exception 'Tramo inmediato inválido' using errcode='22023'; end if;
    v_tramos:=v_tramos||jsonb_build_array(jsonb_build_object('posicion',v_pos,'medio',v_medio,'importe',v_importe,
      'tarjeta_id',v_tarjeta,'cantidad_cuotas',v_cuotas,'fecha_pago',v_fecha,'primer_periodo_id',v_primero));
    v_suma:=v_suma+v_importe;
  end loop;
  if exists(select 1 from jsonb_array_elements(v_tramos) j group by j->>'posicion' having count(*)>1) then
    raise exception 'Posición duplicada' using errcode='22023'; end if;
  select coalesce(jsonb_agg(j order by (j->>'posicion')::integer),'[]') into v_tramos from jsonb_array_elements(v_tramos) j;
 return v_tramos;
end;
$fn$;

create function public.asignar_obligaciones_compra_interno(p_tarjeta uuid,p_compra_id uuid)
returns void language plpgsql volatile security definer set search_path='' as $fn$
declare v record; o record; v_orden integer; v_periodo uuid;
begin
  if p_compra_id is null then raise exception 'Compra obligatoria para asignación limitada' using errcode='22023'; end if;
  -- Solo tramos confirmados con primer período explícito. No mueve asignadas.
  for v in select t.id,t.compra_id,i.primer_periodo_id
    from public.tramos_pago_compras t join public.inicios_tramos_tarjeta i on i.tramo_id=t.id
    join public.financiaciones_compras f on f.compra_id=t.compra_id
    where t.tarjeta_id=p_tarjeta and t.compra_id=p_compra_id and f.estado='CONFIRMADA' and not exists(select 1 from public.anulaciones_compras_gastos ac where ac.compra_gasto_id=t.compra_id)
      and exists(select 1 from public.obligaciones_tarjetas pendiente where pendiente.tramo_id=t.id and pendiente.periodo_id is null)
    order by t.compra_id,t.id loop
    perform 1 from public.compras_gastos where id=v.compra_id for update;
    select p.orden-1 into v_orden from public.periodos_tarjetas p where p.id=v.primer_periodo_id;
    for o in select * from public.obligaciones_tarjetas where tramo_id=v.id order by numero_cuota loop
      if o.periodo_id is not null then
        select orden into v_orden from public.periodos_tarjetas where id=o.periodo_id;
      else
        select p.id,p.orden into v_periodo,v_orden from public.periodos_tarjetas p
          where p.tarjeta_id=p_tarjeta and p.orden>v_orden order by p.orden limit 1;
        if not found then exit; end if;
        update public.obligaciones_tarjetas set periodo_id=v_periodo where id=o.id;
      end if;
    end loop;
  end loop;
end;
$fn$;

create function public.confirmar_financiacion_compra_interno(p_operacion_id uuid,p_compra_id uuid,p_tramos jsonb,p_solo_compra boolean)
returns jsonb language plpgsql volatile security definer set search_path='' as $rpc$
declare
  v_req jsonb; v_res jsonb; x jsonb; v_tramos jsonb:='[]'; v_total numeric; v_suma numeric:=0;
  v_importe numeric; v_cuotas integer; v_tarjeta uuid; v_primero uuid;
  v_tramo uuid; v_centavos numeric;
begin
  if auth.uid() is null or public.es_admin_hugella() is not true then raise exception 'No autorizado' using errcode='42501'; end if;
  if p_compra_id is null then raise exception 'Tramos inválidos' using errcode='22023'; end if;
  if p_solo_compra is null then raise exception 'Alcance obligatorio' using errcode='22023'; end if;
  v_tramos:=public.canonicalizar_tramos_compra_interno(p_tramos);
  select coalesce(sum((j->>'importe')::numeric),0) into v_suma from jsonb_array_elements(v_tramos) j;
  v_req:=jsonb_build_object('compra_id',p_compra_id,'tramos',v_tramos);
  v_res:=public.iniciar_operacion_financiera_compras(p_operacion_id,'FINANCIACION',v_req);
  if v_res is not null then return v_res; end if;
  if exists(select 1 from public.anulaciones_compras_gastos where compra_gasto_id=p_compra_id) then raise exception 'Compra anulada; no admite financiación' using errcode='23514'; end if;
  perform 1 from public.compras_gastos where id=p_compra_id and moneda='ARS' for update;
  if not found then raise exception 'Compra inexistente o moneda no soportada' using errcode='22023'; end if;
  if exists(select 1 from public.financiaciones_compras where compra_id=p_compra_id) then
    raise exception 'Financiación ya registrada; requiere revisión auditada' using errcode='22023'; end if;
  select sum(total) into v_total from public.items_compras_gastos where compra_gasto_id=p_compra_id;
  if v_total is null or v_suma<>v_total then raise exception 'Suma de tramos incompatible con total de compra' using errcode='23514'; end if;
  -- Locks de todas las tarjetas en orden estable; las FK y triggers base siguen vigentes.
  perform t.id from public.tarjetas_credito t where t.id in (
    select (j->>'tarjeta_id')::uuid from jsonb_array_elements(v_tramos) j) order by t.id for update;
  insert into public.financiaciones_compras(compra_id,actor_id) values(p_compra_id,auth.uid());
  for x in select value from jsonb_array_elements(v_tramos) loop
    v_tarjeta:=(x->>'tarjeta_id')::uuid; v_primero:=(x->>'primer_periodo_id')::uuid;
    v_cuotas:=(x->>'cantidad_cuotas')::integer; v_importe:=(x->>'importe')::numeric;
    if v_tarjeta is not null and not exists(select 1 from public.tarjetas_credito where id=v_tarjeta and activo) then
      raise exception 'Tarjeta inexistente o inactiva' using errcode='22023'; end if;
    if v_primero is not null and not exists(select 1 from public.periodos_tarjetas where id=v_primero and tarjeta_id=v_tarjeta) then
      raise exception 'Primer período incompatible' using errcode='22023'; end if;
    insert into public.tramos_pago_compras(compra_id,posicion,medio,importe,tarjeta_id,cantidad_cuotas,fecha_pago)
      values(p_compra_id,(x->>'posicion')::integer,x->>'medio',v_importe,v_tarjeta,v_cuotas,(x->>'fecha_pago')::date) returning id into v_tramo;
    if x->>'medio'='TARJETA_CREDITO' then
      v_centavos:=v_importe*100;
      insert into public.obligaciones_tarjetas(compra_id,tramo_id,tarjeta_id,numero_cuota,cantidad_cuotas,importe)
        select p_compra_id,v_tramo,v_tarjeta,n,v_cuotas,
          (floor(v_centavos/v_cuotas)+case when n<=mod(v_centavos,v_cuotas) then 1 else 0 end)/100
        from generate_series(1,v_cuotas) n;
      if v_primero is not null then
        insert into public.inicios_tramos_tarjeta(tramo_id,primer_periodo_id,actor_id) values(v_tramo,v_primero,auth.uid());
      end if;
    end if;
  end loop;
  update public.financiaciones_compras set estado='CONFIRMADA',confirmado_at=clock_timestamp() where compra_id=p_compra_id;
  for v_tarjeta in select distinct (j->>'tarjeta_id')::uuid from jsonb_array_elements(v_tramos) j where j->>'tarjeta_id' is not null loop
    if p_solo_compra then
      perform public.asignar_obligaciones_compra_interno(v_tarjeta,p_compra_id);
    else
      perform public.asignar_obligaciones_tarjeta_interno(v_tarjeta);
    end if;
  end loop;
  v_res:=jsonb_build_object('operacion_id',p_operacion_id,'compra_id',p_compra_id,'estado','CONFIRMADA',
    'tramos',(select jsonb_agg(to_jsonb(t) order by t.posicion) from public.tramos_pago_compras t where t.compra_id=p_compra_id));
  return public.finalizar_operacion_financiera_compras(p_operacion_id,'FINANCIACION',v_req,v_res);
end;
$rpc$;
-- Firma/solicitud/resultado públicos sin cambios. Operación normal mantiene alcance amplio.
create or replace function public.confirmar_financiacion_compra_admin(p_operacion_id uuid,p_compra_id uuid,p_tramos jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $rpc$
begin
 return public.confirmar_financiacion_compra_interno(p_operacion_id,p_compra_id,p_tramos,false);
end;
$rpc$;

alter table public.operaciones_financieras_compras drop constraint operaciones_financieras_compras_accion_check;
alter table public.operaciones_financieras_compras add constraint operaciones_financieras_compras_accion_check
 check(accion in ('TARJETA','PERIODO','FINANCIACION','PRIMER_PERIODO','PAGO_RESUMEN','COMPRA_FINANCIADA','EDICION_TARJETA','ANULACION_COMPRA','CORTE_HISTORICO','IMPORTACION_COMPRA_HISTORICA'));

create function public.importar_compra_historica_admin(
 p_operacion_id uuid,p_id_origen text,p_tipo text,p_proveedor_id uuid,p_fecha date,
 p_moneda text,p_comprobante text,p_observaciones text,p_descripcion text,p_total numeric,p_tramos jsonb
) returns jsonb language plpgsql volatile security definer set search_path='' as $rpc$
declare
 v_actor uuid:=auth.uid(); v_compra_req jsonb; v_req jsonb; v_tramos jsonb; v_res jsonb; v_fin jsonb;
 v_compra uuid; v_compra_op uuid; v_fin_op uuid; v_lock bigint; v_activo boolean;
 v_existente public.operaciones_financieras_compras%rowtype;
begin
 if v_actor is null or public.es_admin_hugella() is not true then raise exception 'No autorizado' using errcode='42501'; end if;
 if p_operacion_id is null or p_id_origen is null or p_id_origen !~ '^HG-[0-9]{4}$'
  or p_tipo is null or p_tipo not in ('MERCADERIA','GASTO') or p_proveedor_id is null
  or p_fecha is null or not isfinite(p_fecha) or p_moneda is distinct from 'ARS'
  or nullif(btrim(p_descripcion),'') is null or p_total is null
  or not (p_total>=0 and p_total<=9999999999999999.99 and p_total=round(p_total,2)) then
  raise exception 'Compra histórica inválida' using errcode='22023'; end if;
 v_tramos:=public.canonicalizar_tramos_compra_interno(p_tramos);
 if exists(select 1 from jsonb_array_elements(v_tramos) j where j->>'medio'='TARJETA_DEBITO'
   and (j->>'fecha_pago')::date is distinct from p_fecha) then
  raise exception 'Débito histórico requiere fecha de compra como fecha de pago' using errcode='22023'; end if;
 v_compra_req:=jsonb_build_object('fuente','GOOGLE_SHEETS_COMPRAS','id_origen',p_id_origen,
  'tipo',p_tipo,'proveedor_id',p_proveedor_id,'fecha',p_fecha,'moneda',p_moneda,
  'comprobante',nullif(btrim(p_comprobante),''),'observaciones',nullif(btrim(p_observaciones),''),
  'descripcion',btrim(p_descripcion),'total',p_total);
 v_req:=jsonb_build_object('compra',v_compra_req,'tramos',v_tramos);
 v_compra_op:=md5('hugella:compra-historica:compra:v1:'||p_operacion_id::text)::uuid;
 v_fin_op:=md5('hugella:compra-historica:financiacion:v1:'||p_operacion_id::text)::uuid;
 if v_compra_op=p_operacion_id or v_fin_op=p_operacion_id or v_compra_op=v_fin_op then
  raise exception 'Identidades internas incompatibles' using errcode='23514'; end if;
 -- Identidad histórica y operaciones antes del lock global; jamás adquirir una nueva
 -- identidad de operación después del global al delegar a la confirmación interna.
 for v_lock in select distinct k from unnest(array[
  pg_catalog.hashtextextended('hugella:historico:GOOGLE_SHEETS_COMPRAS:'||p_id_origen,0),
  pg_catalog.hashtextextended('hugella:finanzas:operacion:'||p_operacion_id::text,0),
  pg_catalog.hashtextextended('hugella:finanzas:operacion:'||v_fin_op::text,0),
  pg_catalog.hashtextextended('hugella:compra:operacion:'||v_compra_op::text,0)]) k order by k loop
  perform pg_catalog.pg_advisory_xact_lock(v_lock);
 end loop;
 v_res:=public.iniciar_operacion_financiera_compras(p_operacion_id,'IMPORTACION_COMPRA_HISTORICA',v_req);
 if v_res is not null then return v_res; end if;
 select id into v_compra from public.compras_gastos where fuente='GOOGLE_SHEETS_COMPRAS' and id_origen=p_id_origen;
 if found then
  select * into v_existente from public.operaciones_financieras_compras
   where accion='IMPORTACION_COMPRA_HISTORICA' and resultado->>'compra_id'=v_compra::text;
  if not found or v_existente.actor_id is distinct from v_actor or v_existente.solicitud is distinct from v_req then
   raise exception 'HG existente con otro actor o solicitud; requiere revisión' using errcode='22023'; end if;
  return v_existente.resultado;
 end if;
 if exists(select 1 from public.operaciones_compras_gastos where operacion_id=v_compra_op)
  or exists(select 1 from public.operaciones_financieras_compras where operacion_id=v_fin_op) then
  raise exception 'Identidad interna ya utilizada; requiere revisión' using errcode='22023'; end if;
 select activo into v_activo from public.proveedores where id=p_proveedor_id for share;
 if not found or v_activo is not true then raise exception 'Proveedor inexistente o inactivo' using errcode='22023'; end if;
 insert into public.compras_gastos(tipo,proveedor_id,fecha,moneda,comprobante,observaciones,actor_id,fuente,id_origen)
  values(p_tipo,p_proveedor_id,p_fecha,p_moneda,v_compra_req->>'comprobante',v_compra_req->>'observaciones',v_actor,'GOOGLE_SHEETS_COMPRAS',p_id_origen)
  returning id into v_compra;
 insert into public.items_compras_gastos(compra_gasto_id,posicion,descripcion,modalidad,cantidad,costo_unitario,importe_historico)
  values(v_compra,1,btrim(p_descripcion),'TOTAL_HISTORICO',null,null,p_total);
 insert into public.operaciones_compras_gastos(operacion_id,actor_id,compra_gasto_id,solicitud)
  values(v_compra_op,v_actor,v_compra,v_compra_req);
 v_fin:=public.confirmar_financiacion_compra_interno(v_fin_op,v_compra,v_tramos,true);
 v_res:=jsonb_build_object('operacion_id',p_operacion_id,'fuente','GOOGLE_SHEETS_COMPRAS','id_origen',p_id_origen,
  'compra_id',v_compra,'estado',v_fin->'estado','operacion_compra_id',v_compra_op,'operacion_financiacion_id',v_fin_op,
  'tramos',coalesce(nullif(v_fin->'tramos','null'::jsonb),'[]'::jsonb));
 return public.finalizar_operacion_financiera_compras(p_operacion_id,'IMPORTACION_COMPRA_HISTORICA',v_req,v_res);
end;
$rpc$;

create or replace function public.proteger_corte_historico_obligacion_tarjeta() returns trigger
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
  if not exists(select 1 from public.compras_gastos cg where cg.id=v_obligacion.compra_id
   and cg.fuente='GOOGLE_SHEETS_COMPRAS' and cg.id_origen ~ '^HG-[0-9]{4}$') then
   raise exception 'Corte requiere compra de origen histórico válido' using errcode='23514'; end if;
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
alter function public.proteger_procedencia_compra() owner to postgres;
revoke all on function public.proteger_procedencia_compra() from public,anon,authenticated,service_role;
alter function public.validar_compra_historica_integridad() owner to postgres;
revoke all on function public.validar_compra_historica_integridad() from public,anon,authenticated,service_role;
alter function public.canonicalizar_tramos_compra_interno(jsonb) owner to postgres;
revoke all on function public.canonicalizar_tramos_compra_interno(jsonb) from public,anon,authenticated,service_role;
alter function public.asignar_obligaciones_compra_interno(uuid,uuid) owner to postgres;
revoke all on function public.asignar_obligaciones_compra_interno(uuid,uuid) from public,anon,authenticated,service_role;
alter function public.confirmar_financiacion_compra_interno(uuid,uuid,jsonb,boolean) owner to postgres;
revoke all on function public.confirmar_financiacion_compra_interno(uuid,uuid,jsonb,boolean) from public,anon,authenticated,service_role;
alter function public.proteger_corte_historico_obligacion_tarjeta() owner to postgres;
revoke all on function public.proteger_corte_historico_obligacion_tarjeta() from public,anon,authenticated,service_role;
alter function public.confirmar_financiacion_compra_admin(uuid,uuid,jsonb) owner to postgres;
revoke all on function public.confirmar_financiacion_compra_admin(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.confirmar_financiacion_compra_admin(uuid,uuid,jsonb) to authenticated;
alter function public.importar_compra_historica_admin(uuid,text,text,uuid,date,text,text,text,text,numeric,jsonb) owner to postgres;
revoke all on function public.importar_compra_historica_admin(uuid,text,text,uuid,date,text,text,text,text,numeric,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.importar_compra_historica_admin(uuid,text,text,uuid,date,text,text,text,text,numeric,jsonb) to authenticated;

set constraints all immediate;
commit;
