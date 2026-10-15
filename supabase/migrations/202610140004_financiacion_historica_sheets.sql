-- Infraestructura exclusivamente. No importa filas, registra cortes ni crea períodos.
-- Requiere 140003 intacta y ninguna importación/corte histórico previo.
begin;
lock table public.compras_gastos, public.items_compras_gastos, public.operaciones_compras_gastos,
 public.operaciones_financieras_compras, public.financiaciones_compras, public.tramos_pago_compras,
 public.obligaciones_tarjetas, public.inicios_tramos_tarjeta, public.tarjetas_credito,
 public.periodos_tarjetas, public.pagos_resumenes_tarjetas, public.aplicaciones_pagos_obligaciones,
 public.anulaciones_compras_gastos, public.cortes_historicos_obligaciones_tarjeta in access exclusive mode;
do $preflight$
declare v record;
begin
 if current_setting('server_version_num')::integer<170000 then raise exception 'Se requiere PostgreSQL 17'; end if;
 if to_regclass('public.evidencias_financiacion_historica_compras') is not null then
  raise exception 'Infraestructura histórica final ya instalada'; end if;
 if exists(select 1 from public.compras_gastos where fuente is not null)
  or exists(select 1 from public.cortes_historicos_obligaciones_tarjeta)
  or exists(select 1 from public.operaciones_financieras_compras where accion='IMPORTACION_COMPRA_HISTORICA') then
  raise exception 'Se esperaba cero importaciones y cortes históricos previos'; end if;
 for v in select * from (values
 ('public.importar_compra_historica_admin(uuid,text,text,uuid,date,text,text,text,text,numeric,jsonb)','2c2ece8bb2b2e74efa543e0257e12694'),
 ('public.confirmar_financiacion_compra_interno(uuid,uuid,jsonb,boolean)','9ffb780d6d7cf19387ab46f14e50dc3a'),
 ('public.validar_compra_historica_integridad()','b2d01f1d93b9846ec98f7a42fee1cbbb'),
 ('public.validar_financiacion_compras_integridad()','b7fd97c260a4dfb2526ea88b463a3722'),
 ('public.obtener_financiacion_compra_admin(uuid)','779107a21b61d7989113111e7b85f6ee'),
 ('public.obtener_compra_gasto_admin(uuid)','9a0478bed263e99291627c80a7b076d2'),
 ('public.canonicalizar_tramos_compra_interno(jsonb)','9e778de812d3082724ac1a396825e47d'),
 ('public.asignar_obligaciones_compra_interno(uuid,uuid)','d84629edb367151d18e579f9c4b29932'),
 ('public.proteger_corte_historico_obligacion_tarjeta()','5bf2baa27c0ad21ca5677fa9a6e4256b')
 ) x(firma,hash) loop
  if not exists(select 1 from pg_proc where oid=to_regprocedure(v.firma) and md5(prosrc)=v.hash
   and proowner='postgres'::regrole and prosecdef and proconfig=array['search_path=""']) then
   raise exception 'Baseline RPC incompatible: %',v.firma; end if;
  if exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
   where p.oid=to_regprocedure(v.firma) and a.privilege_type='EXECUTE'
    and (a.grantee in (0,'anon'::regrole,'service_role'::regrole)
     or (a.grantee='authenticated'::regrole and p.proname in ('confirmar_financiacion_compra_interno',
      'validar_compra_historica_integridad','validar_financiacion_compras_integridad',
      'canonicalizar_tramos_compra_interno','asignar_obligaciones_compra_interno','proteger_corte_historico_obligacion_tarjeta')))) then
   raise exception 'ACL RPC incompatible: %',v.firma; end if;

 end loop;
 if (select md5(baseline::text) from (SELECT jsonb_object_agg(c.relname,jsonb_build_object(
 'columns',(SELECT jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attgenerated,pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
 'constraints',(SELECT jsonb_agg(jsonb_build_array(x.conname,x.contype,x.convalidated,pg_get_constraintdef(x.oid)) ORDER BY x.conname) FROM pg_constraint x WHERE x.conrelid=c.oid),
 'indexes',(SELECT jsonb_agg(jsonb_build_array(ic.relname,i.indisunique,i.indisvalid,pg_get_indexdef(i.indexrelid)) ORDER BY ic.relname) FROM pg_index i JOIN pg_class ic ON ic.oid=i.indexrelid WHERE i.indrelid=c.oid),
 'triggers',(SELECT jsonb_agg(jsonb_build_array(t.tgname,t.tgenabled,pg_get_triggerdef(t.oid)) ORDER BY t.tgname) FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal))) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('compras_gastos','items_compras_gastos','tarjetas_credito','financiaciones_compras','periodos_tarjetas','tramos_pago_compras','obligaciones_tarjetas','pagos_resumenes_tarjetas','aplicaciones_pagos_obligaciones','operaciones_financieras_compras','inicios_tramos_tarjeta','anulaciones_compras_gastos','operaciones_compras_gastos','cortes_historicos_obligaciones_tarjeta')) catalogo(baseline)) is distinct from '535b9bb1d15c1d341ce7294e77bed45d' then raise exception 'Estructura histórica incompatible'; end if;
 if exists(select 1 from pg_class c where c.oid in (
 'public.compras_gastos'::regclass,'public.items_compras_gastos'::regclass,'public.operaciones_compras_gastos'::regclass,
 'public.operaciones_financieras_compras'::regclass,'public.financiaciones_compras'::regclass,
 'public.tramos_pago_compras'::regclass,'public.obligaciones_tarjetas'::regclass,
 'public.inicios_tramos_tarjeta'::regclass,'public.tarjetas_credito'::regclass,'public.periodos_tarjetas'::regclass,
 'public.pagos_resumenes_tarjetas'::regclass,'public.aplicaciones_pagos_obligaciones'::regclass,
 'public.anulaciones_compras_gastos'::regclass,'public.cortes_historicos_obligaciones_tarjeta'::regclass)
 and (c.relowner<>'postgres'::regrole or not c.relrowsecurity
  or exists(select 1 from pg_policy where polrelid=c.oid)
  or exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
   where a.grantee in (0,'anon'::regrole,'authenticated'::regrole,'service_role'::regrole)))) then
  raise exception 'Seguridad de tablas incompatible'; end if;
end;
$preflight$;

create table public.evidencias_financiacion_historica_compras (
 compra_id uuid primary key references public.compras_gastos(id) on delete restrict,
 operacion_id uuid not null unique references public.operaciones_financieras_compras(operacion_id) on delete restrict deferrable initially deferred,
 tarjeta_original text not null check(tarjeta_original in ('Visa F','Visa L')),
 tarjeta_canonica text not null check(tarjeta_canonica=btrim(tarjeta_canonica) and length(tarjeta_canonica)>0),
 tarjeta_id uuid not null references public.tarjetas_credito(id) on delete restrict,
 periodo_inicial_id uuid not null,
 cuotas_fuente integer not null check(cuotas_fuente between 1 and 1000),
 valor_cuota_historico numeric not null check(valor_cuota_historico>=0 and valor_cuota_historico<1000000000000000000 and valor_cuota_historico=round(valor_cuota_historico,2)),
 pagadas_historicas integer not null check(pagadas_historicas>=0),
 pendientes_historicas integer not null check(pendientes_historicas>=0),
 saldo_historico numeric not null check(saldo_historico>=0 and saldo_historico<1000000000000000000 and saldo_historico=round(saldo_historico,2)),
 estado_original text not null check(length(btrim(estado_original))>0),
 cierre_original date not null check(isfinite(cierre_original)),
 vencimiento_original date not null check(isfinite(vencimiento_original) and vencimiento_original>=cierre_original),
 tratamiento text not null check(tratamiento in ('FINANCIACION_HISTORICA_OPERATIVA','FINANCIACION_HISTORICA_SIN_IMPORTE_OPERATIVO')),
 actor_id uuid not null references auth.users(id) on delete restrict,
 created_at timestamptz not null default clock_timestamp(),
 check(pagadas_historicas+pendientes_historicas=cuotas_fuente),
 foreign key(periodo_inicial_id,tarjeta_id) references public.periodos_tarjetas(id,tarjeta_id) on delete restrict
);
alter table public.evidencias_financiacion_historica_compras owner to postgres;
alter table public.evidencias_financiacion_historica_compras enable row level security;
revoke all on public.evidencias_financiacion_historica_compras from public,anon,authenticated,service_role;

-- NORMAL es explícita para las compras existentes. No se recalculan sus obligaciones.
alter table public.tramos_pago_compras
 add column estrategia_distribucion text not null default 'NORMAL',
 add column valor_cuota_historico numeric,
 add constraint tramos_estrategia_distribucion_check check (
 (estrategia_distribucion='NORMAL' and valor_cuota_historico is null) or
 (estrategia_distribucion='HISTORICA_SHEETS' and medio='TARJETA_CREDITO'
  and valor_cuota_historico is not null and valor_cuota_historico>0
  and valor_cuota_historico<1000000000000000000 and valor_cuota_historico=round(valor_cuota_historico,2)
  and importe-valor_cuota_historico*(cantidad_cuotas-1)>0));
-- Se conservan TODOS los CHECK importe>0 existentes.

create function public.canonicalizar_evidencia_historica_interno(p_evidencia jsonb)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare v_key text; v_num numeric; v_result jsonb:=p_evidencia;
 v_keys text[]:=array['tarjeta_original','tarjeta_canonica','tarjeta_id','periodo_inicial_id','cuotas_fuente',
 'valor_cuota_historico','pagadas_historicas','pendientes_historicas','saldo_historico','estado_original',
 'cierre_original','vencimiento_original','tratamiento'];
begin
 if p_evidencia is null or jsonb_typeof(p_evidencia)<>'object' or not(p_evidencia ?& v_keys)
  or (p_evidencia-v_keys)<>'{}' then raise exception 'Evidencia histórica incompleta' using errcode='22023'; end if;
 foreach v_key in array array['cuotas_fuente','pagadas_historicas','pendientes_historicas','valor_cuota_historico','saldo_historico'] loop
  if jsonb_typeof(p_evidencia->v_key) is distinct from 'number' then raise exception 'Número de evidencia inválido' using errcode='22023'; end if;
  v_num:=(p_evidencia->>v_key)::numeric;
  if v_num<0 or v_num>=1000000000000000000 or v_num<>round(v_num,2) then raise exception 'Importe de evidencia inválido' using errcode='22023'; end if;
  if v_key in ('cuotas_fuente','pagadas_historicas','pendientes_historicas') and (v_num<>trunc(v_num) or v_num>1000) then
   raise exception 'Cuotas de evidencia inválidas' using errcode='22023'; end if;
 end loop;
 foreach v_key in array array['tarjeta_original','tarjeta_canonica','tarjeta_id','periodo_inicial_id','estado_original','cierre_original','vencimiento_original','tratamiento'] loop
  if jsonb_typeof(p_evidencia->v_key) is distinct from 'string' or nullif(btrim(p_evidencia->>v_key),'') is null then
   raise exception 'Texto de evidencia inválido' using errcode='22023'; end if;
 end loop;
 v_result:=v_result||jsonb_build_object('tarjeta_id',(p_evidencia->>'tarjeta_id')::uuid,
  'periodo_inicial_id',(p_evidencia->>'periodo_inicial_id')::uuid,
  'cierre_original',(p_evidencia->>'cierre_original')::date,'vencimiento_original',(p_evidencia->>'vencimiento_original')::date);
 return v_result;
end;
$fn$;

create function public.validar_evidencia_compra_interno(p_compra uuid) returns void
language plpgsql security definer set search_path='' as $fn$
declare c public.compras_gastos%rowtype; e public.evidencias_financiacion_historica_compras%rowtype;
 v_total numeric; v_evidencia jsonb; v_op public.operaciones_financieras_compras%rowtype;
begin
 select * into c from public.compras_gastos where id=p_compra;
 select * into e from public.evidencias_financiacion_historica_compras where compra_id=p_compra;
 if not found then
  if exists(select 1 from public.tramos_pago_compras where compra_id=p_compra and estrategia_distribucion='HISTORICA_SHEETS') then
   raise exception 'Estrategia histórica requiere evidencia' using errcode='23514'; end if;
  if c.fuente='GOOGLE_SHEETS_COMPRAS' and (exists(select 1 from public.tramos_pago_compras where compra_id=p_compra and medio='TARJETA_CREDITO')
   or (select sum(total) from public.items_compras_gastos where compra_gasto_id=p_compra)=0) then
   raise exception 'Compra histórica de tarjeta/cero requiere evidencia' using errcode='23514'; end if;
  return;
 end if;
 if c.fuente is distinct from 'GOOGLE_SHEETS_COMPRAS' or e.actor_id is distinct from c.actor_id then
  raise exception 'Evidencia solo permitida para importación histórica' using errcode='23514'; end if;
 select sum(total) into v_total from public.items_compras_gastos where compra_gasto_id=p_compra;
 if v_total is null or v_total is distinct from e.saldo_historico+e.valor_cuota_historico*e.pagadas_historicas then
  raise exception 'Saldo histórico no reconcilia exactamente' using errcode='23514'; end if;
 if not exists(select 1 from public.periodos_tarjetas p where p.id=e.periodo_inicial_id and p.tarjeta_id=e.tarjeta_id
  and p.fecha_cierre=e.cierre_original and p.fecha_vencimiento=e.vencimiento_original) then
  raise exception 'Período histórico incompatible' using errcode='23514'; end if;
 if e.tarjeta_canonica is distinct from (case e.tarjeta_original when 'Visa L' then 'Visa Leo Santander' when 'Visa F' then 'Visa Facu Santander' end) then
  raise exception 'Identidad histórica de tarjeta incompatible' using errcode='23514'; end if;
 v_evidencia:=to_jsonb(e)-array['compra_id','operacion_id','actor_id','created_at'];
 select * into v_op from public.operaciones_financieras_compras where operacion_id=e.operacion_id;
 if not found or v_op.accion<>'IMPORTACION_COMPRA_HISTORICA' or v_op.actor_id is distinct from e.actor_id
  or v_op.resultado->>'compra_id' is distinct from p_compra::text
  or v_op.solicitud->'evidencia_historica' is distinct from v_evidencia then
  raise exception 'Operación de evidencia histórica incompatible' using errcode='23514'; end if;
 if e.tratamiento='FINANCIACION_HISTORICA_SIN_IMPORTE_OPERATIVO' then
  if c.id_origen<>'HG-0043' or c.tipo<>'GASTO' or v_total<>0 or e.tarjeta_original<>'Visa L'
   or e.cuotas_fuente<>1 or e.valor_cuota_historico<>0 or e.pagadas_historicas<>0 or e.pendientes_historicas<>1 or e.saldo_historico<>0
   or exists(select 1 from public.financiaciones_compras where compra_id=p_compra)
   or exists(select 1 from public.tramos_pago_compras where compra_id=p_compra)
   or exists(select 1 from public.obligaciones_tarjetas where compra_id=p_compra) then
   raise exception 'Evidencia sin importe operativo incompatible' using errcode='23514'; end if;
 else
  if (e.pendientes_historicas=0 and e.saldo_historico<>0) or v_total<=0 or e.valor_cuota_historico<=0 or v_total-e.valor_cuota_historico*(e.cuotas_fuente-1)<=0
   or (select count(*) from public.tramos_pago_compras where compra_id=p_compra)<>1
   or not exists(select 1 from public.tramos_pago_compras t join public.financiaciones_compras f on f.compra_id=t.compra_id
    where t.compra_id=p_compra and f.estado='CONFIRMADA' and t.medio='TARJETA_CREDITO'
     and t.importe=v_total and t.tarjeta_id=e.tarjeta_id and t.cantidad_cuotas=e.cuotas_fuente
     and t.estrategia_distribucion='HISTORICA_SHEETS' and t.valor_cuota_historico=e.valor_cuota_historico
     and exists(select 1 from public.inicios_tramos_tarjeta i where i.tramo_id=t.id and i.primer_periodo_id=e.periodo_inicial_id)) then
   raise exception 'Financiación histórica operativa incompatible' using errcode='23514'; end if;
 end if;
end;
$fn$;

create function public.proteger_evidencia_historica_compra() returns trigger
language plpgsql security definer set search_path='' as $fn$
begin
 if tg_op<>'INSERT' then raise exception 'Evidencia histórica inmutable' using errcode='23514'; end if;
 perform 1 from public.compras_gastos where id=new.compra_id for update;
 if not exists(select 1 from public.compras_gastos where id=new.compra_id and fuente='GOOGLE_SHEETS_COMPRAS') then
  raise exception 'Evidencia solo permitida para importación histórica' using errcode='23514'; end if;
 return new;
end;
$fn$;
create trigger evidencia_historica_inmutable before insert or update or delete on public.evidencias_financiacion_historica_compras
 for each row execute function public.proteger_evidencia_historica_compra();
create function public.validar_evidencia_historica_compra() returns trigger
language plpgsql security definer set search_path='' as $fn$
begin perform public.validar_evidencia_compra_interno(new.compra_id); return null; end;
$fn$;
create constraint trigger evidencia_historica_integridad after insert on public.evidencias_financiacion_historica_compras
 deferrable initially deferred for each row execute function public.validar_evidencia_historica_compra();

-- La ausencia de financiación operativa en HG-0043 no deja desprotegidos sus datos.
create function public.proteger_compra_documental_historica() returns trigger
language plpgsql security definer set search_path='' as $fn$
declare v_id uuid;
begin
 if tg_table_name='compras_gastos' then v_id:=old.id; else v_id:=old.compra_gasto_id; end if;
 if exists(select 1 from public.evidencias_financiacion_historica_compras where compra_id=v_id
  and tratamiento='FINANCIACION_HISTORICA_SIN_IMPORTE_OPERATIVO') then
  raise exception 'Compra histórica documental inmutable' using errcode='23514'; end if;
 if tg_op='DELETE' then return old; end if; return new;
end;
$fn$;
create trigger a_compra_documental_inmutable before update or delete on public.compras_gastos
 for each row execute function public.proteger_compra_documental_historica();
create trigger a_item_documental_inmutable before update or delete on public.items_compras_gastos
 for each row execute function public.proteger_compra_documental_historica();

create or replace function public.validar_compra_historica_integridad() returns trigger
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
     left join public.financiaciones_compras f on f.compra_id=c.id
     where op.accion='IMPORTACION_COMPRA_HISTORICA' and op.actor_id=c.actor_id
      and op.resultado->>'compra_id'=c.id::text and op.solicitud->'compra'=v_compra
      and oc.compra_gasto_id=c.id and oc.actor_id=c.actor_id and oc.solicitud=v_compra
      and (f.estado='CONFIRMADA' or exists(select 1 from public.evidencias_financiacion_historica_compras e where e.compra_id=c.id and e.tratamiento='FINANCIACION_HISTORICA_SIN_IMPORTE_OPERATIVO'))) then
    raise exception 'Compra histórica requiere operación de importación compatible' using errcode='23514'; end if;
  end if;
  perform public.validar_evidencia_compra_interno(v_id);
 end loop;
 return null;
end;
$fn$;
create or replace function public.validar_financiacion_compras_integridad()
returns trigger language plpgsql security definer set search_path='' as $fn$
declare
  v_row jsonb; v_id uuid;
  v_compras uuid[] := '{}'; v_tramos uuid[] := '{}';
  v_obligaciones uuid[] := '{}'; v_pagos uuid[] := '{}'; v_periodos uuid[] := '{}';
begin
  for v_row in select x from unnest(array[
    case when tg_op<>'INSERT' then to_jsonb(old) end,
    case when tg_op<>'DELETE' then to_jsonb(new) end]) x where x is not null loop
    case tg_table_name
      when 'financiaciones_compras' then
        v_compras:=array_append(v_compras,(v_row->>'compra_id')::uuid);
      when 'tramos_pago_compras' then
        v_compras:=array_append(v_compras,(v_row->>'compra_id')::uuid);
        v_tramos:=array_append(v_tramos,(v_row->>'id')::uuid);
      when 'obligaciones_tarjetas' then
        v_tramos:=array_append(v_tramos,(v_row->>'tramo_id')::uuid);
        v_obligaciones:=array_append(v_obligaciones,(v_row->>'id')::uuid);
      when 'periodos_tarjetas' then
        v_periodos:=array_append(v_periodos,(v_row->>'id')::uuid);
      when 'pagos_resumenes_tarjetas' then
        v_pagos:=array_append(v_pagos,(v_row->>'id')::uuid);
      when 'aplicaciones_pagos_obligaciones' then
        v_pagos:=array_append(v_pagos,(v_row->>'pago_id')::uuid);
        v_obligaciones:=array_append(v_obligaciones,(v_row->>'obligacion_id')::uuid);
      else raise exception 'Tabla de validación no reconocida';
    end case;
  end loop;

  for v_id in select distinct x from unnest(v_compras) x loop
    if exists(select 1 from public.financiaciones_compras f join public.compras_gastos c on c.id=f.compra_id
      where f.compra_id=v_id and f.estado='CONFIRMADA' and (c.moneda<>'ARS'
        or not exists(select 1 from public.items_compras_gastos i where i.compra_gasto_id=v_id)
        or coalesce((select sum(t.importe) from public.tramos_pago_compras t where t.compra_id=v_id),0)
          is distinct from (select sum(i.total) from public.items_compras_gastos i where i.compra_gasto_id=v_id))) then
      raise exception 'Suma de tramos incompatible con total de compra' using errcode='23514';
    end if;
    -- Confirmar cabecera exige validar cada tramo de ESTA compra, no otras.
    v_tramos:=v_tramos || array(select t.id from public.tramos_pago_compras t where t.compra_id=v_id);
  end loop;

  for v_id in select distinct x from unnest(v_periodos) x loop
    if exists(select 1 from public.periodos_tarjetas p
      join public.periodos_tarjetas vecino on vecino.tarjeta_id=p.tarjeta_id and vecino.id<>p.id
      where p.id=v_id and (
        (vecino.orden<p.orden and (vecino.fecha_cierre>=p.fecha_cierre or vecino.fecha_vencimiento>=p.fecha_vencimiento))
        or (vecino.orden>p.orden and (vecino.fecha_cierre<=p.fecha_cierre or vecino.fecha_vencimiento<=p.fecha_vencimiento)))) then
      raise exception 'Fechas de períodos fuera de orden' using errcode='23514';
    end if;
    -- Cambiar el orden de un período puede afectar los tramos vinculados a él.
    v_tramos:=v_tramos || array(select distinct o.tramo_id from public.obligaciones_tarjetas o where o.periodo_id=v_id);
  end loop;

  for v_id in select distinct x from unnest(v_tramos) x loop
    if exists(select 1 from public.tramos_pago_compras t join public.financiaciones_compras f on f.compra_id=t.compra_id
      where t.id=v_id and f.estado='CONFIRMADA' and t.medio='TARJETA_CREDITO'
        and (select count(*) from public.obligaciones_tarjetas o where o.tramo_id=v_id)<>t.cantidad_cuotas) then
      raise exception 'Cantidad de obligaciones incompatible' using errcode='23514';
    end if;
    perform public.validar_evidencia_compra_interno((select compra_id from public.tramos_pago_compras where id=v_id));
    -- NORMAL conserva el reparto previo; HISTORICA_SHEETS exige evidencia y residuo final.
    if exists(select 1 from public.obligaciones_tarjetas o join public.tramos_pago_compras t on t.id=o.tramo_id
      where o.tramo_id=v_id and o.importe is distinct from
       case t.estrategia_distribucion
        when 'NORMAL' then (floor(t.importe*100/t.cantidad_cuotas)
         + case when o.numero_cuota<=mod(t.importe*100,t.cantidad_cuotas) then 1 else 0 end)/100
        when 'HISTORICA_SHEETS' then case when o.numero_cuota<t.cantidad_cuotas then t.valor_cuota_historico
         else t.importe-t.valor_cuota_historico*(t.cantidad_cuotas-1) end
       end) then
      raise exception 'Distribución de centavos incompatible' using errcode='23514';
    end if;
    -- Incluye sucesoras: quitar/reasignar una cuota anterior también se verifica.
    if exists(select 1 from public.obligaciones_tarjetas o join public.periodos_tarjetas p on p.id=o.periodo_id
      where o.tramo_id=v_id and exists(select 1 from public.obligaciones_tarjetas anterior
        left join public.periodos_tarjetas pa on pa.id=anterior.periodo_id
        where anterior.tramo_id=v_id and anterior.numero_cuota<o.numero_cuota
          and (anterior.periodo_id is null or pa.orden>=p.orden))) then
      raise exception 'Orden de períodos incompatible con cuotas' using errcode='23514';
    end if;
  end loop;

  for v_id in select distinct x from unnest(v_pagos) x loop
    if exists(select 1 from public.pagos_resumenes_tarjetas p where p.id=v_id
      and p.importe is distinct from (select sum(a.importe) from public.aplicaciones_pagos_obligaciones a where a.pago_id=v_id)) then
      raise exception 'Pago sin distribución exacta' using errcode='23514';
    end if;
    v_obligaciones:=v_obligaciones || array(select a.obligacion_id from public.aplicaciones_pagos_obligaciones a where a.pago_id=v_id);
  end loop;

  for v_id in select distinct x from unnest(v_obligaciones) x loop
    if exists(select 1 from public.aplicaciones_pagos_obligaciones a
      join public.pagos_resumenes_tarjetas p on p.id=a.pago_id
      join public.obligaciones_tarjetas o on o.id=a.obligacion_id
      join public.financiaciones_compras f on f.compra_id=o.compra_id
      where a.obligacion_id=v_id and (o.periodo_id is distinct from p.periodo_id or f.estado<>'CONFIRMADA')) then
      raise exception 'Aplicación incompatible con período o financiación' using errcode='23514';
    end if;
    if exists(select 1 from public.obligaciones_tarjetas o where o.id=v_id
      and (select sum(a.importe) from public.aplicaciones_pagos_obligaciones a where a.obligacion_id=v_id)>o.importe) then
      raise exception 'Aplicaciones superan obligación' using errcode='23514';
    end if;
  end loop;
  return null;
end;
$fn$;
create or replace function public.confirmar_financiacion_compra_interno(p_operacion_id uuid,p_compra_id uuid,p_tramos jsonb,p_solo_compra boolean)
returns jsonb language plpgsql volatile security definer set search_path='' as $rpc$
declare
  v_req jsonb; v_res jsonb; x jsonb; v_tramos jsonb:='[]'; v_total numeric; v_suma numeric:=0;
  v_importe numeric; v_cuotas integer; v_tarjeta uuid; v_primero uuid;
  v_tramo uuid; v_centavos numeric; e public.evidencias_financiacion_historica_compras%rowtype;
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
  select * into e from public.evidencias_financiacion_historica_compras where compra_id=p_compra_id;
  if e.tratamiento='FINANCIACION_HISTORICA_SIN_IMPORTE_OPERATIVO' then
   raise exception 'Evidencia sin importe no admite financiación operativa' using errcode='23514'; end if;
  if e.compra_id is not null and p_solo_compra is not true then
   raise exception 'Financiación histórica requiere flujo limitado' using errcode='23514'; end if;
  insert into public.financiaciones_compras(compra_id,actor_id) values(p_compra_id,auth.uid());
  for x in select value from jsonb_array_elements(v_tramos) loop
    v_tarjeta:=(x->>'tarjeta_id')::uuid; v_primero:=(x->>'primer_periodo_id')::uuid;
    v_cuotas:=(x->>'cantidad_cuotas')::integer; v_importe:=(x->>'importe')::numeric;
    if v_tarjeta is not null and not exists(select 1 from public.tarjetas_credito where id=v_tarjeta and activo) then
      raise exception 'Tarjeta inexistente o inactiva' using errcode='22023'; end if;
    if v_primero is not null and not exists(select 1 from public.periodos_tarjetas where id=v_primero and tarjeta_id=v_tarjeta) then
      raise exception 'Primer período incompatible' using errcode='22023'; end if;
    insert into public.tramos_pago_compras(compra_id,posicion,medio,importe,tarjeta_id,cantidad_cuotas,fecha_pago,estrategia_distribucion,valor_cuota_historico)
      values(p_compra_id,(x->>'posicion')::integer,x->>'medio',v_importe,v_tarjeta,v_cuotas,(x->>'fecha_pago')::date,case when e.tratamiento='FINANCIACION_HISTORICA_OPERATIVA' then 'HISTORICA_SHEETS' else 'NORMAL' end,e.valor_cuota_historico) returning id into v_tramo;
    if x->>'medio'='TARJETA_CREDITO' then
      v_centavos:=v_importe*100;
      insert into public.obligaciones_tarjetas(compra_id,tramo_id,tarjeta_id,numero_cuota,cantidad_cuotas,importe)
        select p_compra_id,v_tramo,v_tarjeta,n,v_cuotas,
          case when e.tratamiento='FINANCIACION_HISTORICA_OPERATIVA' then case when n<v_cuotas then e.valor_cuota_historico else v_importe-e.valor_cuota_historico*(v_cuotas-1) end else (floor(v_centavos/v_cuotas)+case when n<=mod(v_centavos,v_cuotas) then 1 else 0 end)/100 end
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
create function public.importar_compra_historica_admin(
 p_operacion_id uuid,p_id_origen text,p_tipo text,p_proveedor_id uuid,p_fecha date,
 p_moneda text,p_comprobante text,p_observaciones text,p_descripcion text,p_total numeric,p_tramos jsonb,p_evidencia_historica jsonb
) returns jsonb language plpgsql volatile security definer set search_path='' as $rpc$
declare
 v_actor uuid:=auth.uid(); v_compra_req jsonb; v_req jsonb; v_tramos jsonb; v_res jsonb; v_fin jsonb;
 v_compra uuid; v_compra_op uuid; v_fin_op uuid; v_lock bigint; v_activo boolean;
 v_existente public.operaciones_financieras_compras%rowtype; v_evidencia jsonb; v_documental boolean:=false;
begin
 if v_actor is null or public.es_admin_hugella() is not true then raise exception 'No autorizado' using errcode='42501'; end if;
 if p_operacion_id is null or p_id_origen is null or p_id_origen !~ '^HG-[0-9]{4}$'
  or p_tipo is null or p_tipo not in ('MERCADERIA','GASTO') or p_proveedor_id is null
  or p_fecha is null or not isfinite(p_fecha) or p_moneda is distinct from 'ARS'
  or nullif(btrim(p_descripcion),'') is null or p_total is null
  or not (p_total>=0 and p_total<=9999999999999999.99 and p_total=round(p_total,2)) then
  raise exception 'Compra histórica inválida' using errcode='22023'; end if;
 v_tramos:=public.canonicalizar_tramos_compra_interno(p_tramos);
 if p_evidencia_historica is not null then
  v_evidencia:=public.canonicalizar_evidencia_historica_interno(p_evidencia_historica);
  v_documental:=v_evidencia->>'tratamiento'='FINANCIACION_HISTORICA_SIN_IMPORTE_OPERATIVO';
  if (v_evidencia->>'pagadas_historicas')::integer+(v_evidencia->>'pendientes_historicas')::integer<>(v_evidencia->>'cuotas_fuente')::integer
   or p_total is distinct from (v_evidencia->>'saldo_historico')::numeric+(v_evidencia->>'valor_cuota_historico')::numeric*(v_evidencia->>'pagadas_historicas')::integer then
   raise exception 'Evidencia histórica no reconcilia exactamente' using errcode='22023'; end if;
  if not v_documental and (v_evidencia->>'tratamiento' is distinct from 'FINANCIACION_HISTORICA_OPERATIVA'
   or jsonb_array_length(v_tramos)<>1 or v_tramos->0->>'medio' is distinct from 'TARJETA_CREDITO'
   or (v_tramos->0->>'importe')::numeric is distinct from p_total
   or v_tramos->0->'tarjeta_id' is distinct from v_evidencia->'tarjeta_id'
   or v_tramos->0->'primer_periodo_id' is distinct from v_evidencia->'periodo_inicial_id'
   or (v_tramos->0->>'cantidad_cuotas')::integer is distinct from (v_evidencia->>'cuotas_fuente')::integer) then
   raise exception 'Tramo no corresponde a evidencia histórica' using errcode='22023'; end if;
  if v_documental and jsonb_array_length(v_tramos)<>0 then raise exception 'Caso documental no admite tramos' using errcode='22023'; end if;
 elsif p_total=0 or exists(select 1 from jsonb_array_elements(v_tramos) j where j->>'medio'='TARJETA_CREDITO') then
  raise exception 'Tarjeta/cero histórico requiere evidencia estructurada' using errcode='22023';
 end if;
 if exists(select 1 from jsonb_array_elements(v_tramos) j where j->>'medio'='TARJETA_DEBITO'
   and (j->>'fecha_pago')::date is distinct from p_fecha) then
  raise exception 'Débito histórico requiere fecha de compra como fecha de pago' using errcode='22023'; end if;
 v_compra_req:=jsonb_build_object('fuente','GOOGLE_SHEETS_COMPRAS','id_origen',p_id_origen,
  'tipo',p_tipo,'proveedor_id',p_proveedor_id,'fecha',p_fecha,'moneda',p_moneda,
  'comprobante',nullif(btrim(p_comprobante),''),'observaciones',nullif(btrim(p_observaciones),''),
  'descripcion',btrim(p_descripcion),'total',p_total);
 v_req:=jsonb_build_object('compra',v_compra_req,'tramos',v_tramos,'evidencia_historica',v_evidencia);
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
 if v_evidencia is not null then
  perform 1 from public.tarjetas_credito where id=(v_evidencia->>'tarjeta_id')::uuid and activo
   and nombre||' '||entidad=v_evidencia->>'tarjeta_canonica' for share;
  if not found then raise exception 'Tarjeta canónica inexistente o inactiva' using errcode='22023'; end if;
  insert into public.evidencias_financiacion_historica_compras(compra_id,operacion_id,tarjeta_original,tarjeta_canonica,tarjeta_id,
   periodo_inicial_id,cuotas_fuente,valor_cuota_historico,pagadas_historicas,pendientes_historicas,saldo_historico,
   estado_original,cierre_original,vencimiento_original,tratamiento,actor_id)
  select v_compra,p_operacion_id,e.tarjeta_original,e.tarjeta_canonica,e.tarjeta_id,e.periodo_inicial_id,
   e.cuotas_fuente,e.valor_cuota_historico,e.pagadas_historicas,e.pendientes_historicas,e.saldo_historico,
   e.estado_original,e.cierre_original,e.vencimiento_original,e.tratamiento,v_actor
  from jsonb_to_record(v_evidencia) as e(tarjeta_original text,tarjeta_canonica text,tarjeta_id uuid,periodo_inicial_id uuid,
   cuotas_fuente integer,valor_cuota_historico numeric,pagadas_historicas integer,pendientes_historicas integer,
   saldo_historico numeric,estado_original text,cierre_original date,vencimiento_original date,tratamiento text);
 end if;
 if v_documental then
  v_fin:=jsonb_build_object('estado','FINANCIACION_HISTORICA_SIN_IMPORTE_OPERATIVO','tramos','[]'::jsonb);
 else
  v_fin:=public.confirmar_financiacion_compra_interno(v_fin_op,v_compra,v_tramos,true);
 end if;
 v_res:=jsonb_build_object('operacion_id',p_operacion_id,'fuente','GOOGLE_SHEETS_COMPRAS','id_origen',p_id_origen,
  'compra_id',v_compra,'estado',v_fin->'estado','operacion_compra_id',v_compra_op,'operacion_financiacion_id',case when v_documental then null else v_fin_op end,
  'tramos',coalesce(nullif(v_fin->'tramos','null'::jsonb),'[]'::jsonb));
 return public.finalizar_operacion_financiera_compras(p_operacion_id,'IMPORTACION_COMPRA_HISTORICA',v_req,v_res);
end;
$rpc$;

create or replace function public.importar_compra_historica_admin(
 p_operacion_id uuid,p_id_origen text,p_tipo text,p_proveedor_id uuid,p_fecha date,
 p_moneda text,p_comprobante text,p_observaciones text,p_descripcion text,p_total numeric,p_tramos jsonb
) returns jsonb language plpgsql volatile security definer set search_path='' as $rpc$
begin
 return public.importar_compra_historica_admin(p_operacion_id,p_id_origen,p_tipo,p_proveedor_id,p_fecha,
  p_moneda,p_comprobante,p_observaciones,p_descripcion,p_total,p_tramos,null);
end;
$rpc$;

create or replace function public.obtener_compra_gasto_admin(p_compra_gasto_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $rpc$
declare v_resultado jsonb;
begin
  if auth.uid() is null or public.es_admin_hugella() is not true then
    raise exception 'No autorizado' using errcode='42501';
  end if;
  if p_compra_gasto_id is null then
    raise exception 'ID obligatorio' using errcode='22023';
  end if;
  select to_jsonb(cg) || jsonb_build_object('proveedor',to_jsonb(pr),
    'items',(select jsonb_agg(to_jsonb(it) order by it.posicion) from public.items_compras_gastos it where it.compra_gasto_id=cg.id),
    'total',(select sum(it.total) from public.items_compras_gastos it where it.compra_gasto_id=cg.id))
    into v_resultado from public.compras_gastos cg join public.proveedores pr on pr.id=cg.proveedor_id
    where cg.id=p_compra_gasto_id;
  if not found then raise exception 'Compra/gasto inexistente' using errcode='22023'; end if;
  return v_resultado||jsonb_build_object('evidencia_historica',(select to_jsonb(e)-array['actor_id','operacion_id','created_at'] from public.evidencias_financiacion_historica_compras e where e.compra_id=p_compra_gasto_id))||jsonb_build_object('anulacion',(select to_jsonb(ac) from public.anulaciones_compras_gastos ac where ac.compra_gasto_id=p_compra_gasto_id));
end;
$rpc$;
create or replace function public.obtener_financiacion_compra_admin(p_compra_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $rpc$
declare v_total numeric; v_pagado numeric; v_estado text; v_anulacion jsonb; v_saldo_operativo numeric; v_corte numeric; v_evidencia jsonb;
begin
  if auth.uid() is null or public.es_admin_hugella() is not true then raise exception 'No autorizado' using errcode='42501'; end if;
  perform 1 from public.compras_gastos where id=p_compra_id;
  if not found then raise exception 'Compra inexistente' using errcode='22023'; end if;
  select sum(total) into v_total from public.items_compras_gastos where compra_gasto_id=p_compra_id;
  select to_jsonb(e)-array['actor_id','operacion_id','created_at'] into v_evidencia from public.evidencias_financiacion_historica_compras e where e.compra_id=p_compra_id;
  if v_evidencia->>'tratamiento'='FINANCIACION_HISTORICA_SIN_IMPORTE_OPERATIVO' then
   return jsonb_build_object('compra_id',p_compra_id,'total_compra',v_total,'total_pagado',0,'total_corte_historico',0,
    'saldo_historico',0,'saldo_operativo',0,'saldo_pendiente',0,'anulacion',null,
    'estado','FINANCIACION_HISTORICA_SIN_IMPORTE_OPERATIVO','estado_financiacion','EVIDENCIA_HISTORICA',
    'evidencia_historica',v_evidencia);
  end if;
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

create function public.proteger_operacion_documental_historica() returns trigger
language plpgsql security definer set search_path='' as $fn$
declare v_id uuid;
begin
 if tg_table_name='anulaciones_compras_gastos' then v_id:=new.compra_gasto_id;
 else v_id:=new.compra_id; end if;
 perform 1 from public.compras_gastos where id=v_id for update;
 if exists(select 1 from public.evidencias_financiacion_historica_compras where compra_id=v_id
  and tratamiento='FINANCIACION_HISTORICA_SIN_IMPORTE_OPERATIVO') then
  raise exception 'Compra documental no admite operación financiera ni anulación' using errcode='23514'; end if;
 return new;
end;
$fn$;
create trigger a_documental_financiacion before insert on public.financiaciones_compras
 for each row execute function public.proteger_operacion_documental_historica();
create trigger a_documental_anulacion before insert on public.anulaciones_compras_gastos
 for each row execute function public.proteger_operacion_documental_historica();

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
  if not exists(select 1 from public.evidencias_financiacion_historica_compras e
   where e.compra_id=v_obligacion.compra_id and e.tratamiento='FINANCIACION_HISTORICA_OPERATIVA'
    and v_obligacion.numero_cuota<=e.pagadas_historicas) then
   raise exception 'Corte fuera de las primeras cuotas históricas documentadas' using errcode='23514'; end if;
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

alter function public.canonicalizar_evidencia_historica_interno(jsonb) owner to postgres;
revoke all on function public.canonicalizar_evidencia_historica_interno(jsonb) from public,anon,authenticated,service_role;
alter function public.validar_evidencia_compra_interno(uuid) owner to postgres;
revoke all on function public.validar_evidencia_compra_interno(uuid) from public,anon,authenticated,service_role;
alter function public.proteger_evidencia_historica_compra() owner to postgres;
revoke all on function public.proteger_evidencia_historica_compra() from public,anon,authenticated,service_role;
alter function public.validar_evidencia_historica_compra() owner to postgres;
revoke all on function public.validar_evidencia_historica_compra() from public,anon,authenticated,service_role;
alter function public.proteger_compra_documental_historica() owner to postgres;
revoke all on function public.proteger_compra_documental_historica() from public,anon,authenticated,service_role;
alter function public.proteger_operacion_documental_historica() owner to postgres;
revoke all on function public.proteger_operacion_documental_historica() from public,anon,authenticated,service_role;
alter function public.validar_compra_historica_integridad() owner to postgres;
revoke all on function public.validar_compra_historica_integridad() from public,anon,authenticated,service_role;
alter function public.validar_financiacion_compras_integridad() owner to postgres;
revoke all on function public.validar_financiacion_compras_integridad() from public,anon,authenticated,service_role;
alter function public.confirmar_financiacion_compra_interno(uuid,uuid,jsonb,boolean) owner to postgres;
revoke all on function public.confirmar_financiacion_compra_interno(uuid,uuid,jsonb,boolean) from public,anon,authenticated,service_role;
alter function public.importar_compra_historica_admin(uuid,text,text,uuid,date,text,text,text,text,numeric,jsonb,jsonb) owner to postgres;
revoke all on function public.importar_compra_historica_admin(uuid,text,text,uuid,date,text,text,text,text,numeric,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.importar_compra_historica_admin(uuid,text,text,uuid,date,text,text,text,text,numeric,jsonb,jsonb) to authenticated;
alter function public.importar_compra_historica_admin(uuid,text,text,uuid,date,text,text,text,text,numeric,jsonb) owner to postgres;
revoke all on function public.importar_compra_historica_admin(uuid,text,text,uuid,date,text,text,text,text,numeric,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.importar_compra_historica_admin(uuid,text,text,uuid,date,text,text,text,text,numeric,jsonb) to authenticated;
alter function public.obtener_compra_gasto_admin(uuid) owner to postgres;
revoke all on function public.obtener_compra_gasto_admin(uuid) from public,anon,authenticated,service_role;
grant execute on function public.obtener_compra_gasto_admin(uuid) to authenticated;
alter function public.obtener_financiacion_compra_admin(uuid) owner to postgres;
revoke all on function public.obtener_financiacion_compra_admin(uuid) from public,anon,authenticated,service_role;
grant execute on function public.obtener_financiacion_compra_admin(uuid) to authenticated;

alter function public.proteger_corte_historico_obligacion_tarjeta() owner to postgres;
revoke all on function public.proteger_corte_historico_obligacion_tarjeta() from public,anon,authenticated,service_role;

set constraints all immediate;
commit;
