-- 11D.5.3 LOCAL: operaciones financieras Admin. No carga histórica ni semillas.
begin;

do $preflight$
declare v record;
begin
  for v in select * from (values
    ('validar_financiacion_compras_integridad','b7fd97c260a4dfb2526ea88b463a3722'),
    ('proteger_financiacion_compras','5a7ff422d4ee99474154a431b09d0a58'),
    ('proteger_pagos_tarjetas','1d9e9b8a038def57bc431e687f140e6a'),
    ('proteger_periodos_tarjetas','b0f74a8189fcae71a409c101aba21fa1')) x(nombre,hash) loop
    if not exists(select 1 from pg_catalog.pg_proc p
      where p.oid=pg_catalog.to_regprocedure('public.'||v.nombre||'()')
      and md5(p.prosrc)=v.hash and p.proowner='postgres'::regrole
      and p.prosecdef and p.proconfig=array['search_path=""']) then
      raise exception 'Baseline financiero incompatible: %',v.nombre;
    end if;
  end loop;
  if exists(select 1 from pg_catalog.pg_class c where c.oid in (
    'public.tarjetas_credito'::regclass,'public.financiaciones_compras'::regclass,
    'public.periodos_tarjetas'::regclass,'public.tramos_pago_compras'::regclass,
    'public.obligaciones_tarjetas'::regclass,'public.pagos_resumenes_tarjetas'::regclass,
    'public.aplicaciones_pagos_obligaciones'::regclass)
    and (c.relowner<>'postgres'::regrole or not c.relrowsecurity)) then
    raise exception 'Seguridad financiera incompatible';
  end if;
  if exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in (
      'iniciar_operacion_financiera_compras','finalizar_operacion_financiera_compras','asignar_obligaciones_tarjeta_interno',
      'crear_tarjeta_credito_admin','registrar_periodo_tarjeta_admin','confirmar_financiacion_compra_admin',
      'seleccionar_primer_periodo_tramo_admin','registrar_pago_resumen_tarjeta_admin',
      'obtener_financiacion_compra_admin','obtener_saldo_periodo_tarjeta_admin','listar_tarjetas_financieras_admin','listar_periodos_tarjeta_admin')) then
    raise exception 'RPC financiera existente: revisión requerida';
  end if;
  if not exists(select 1 from pg_catalog.pg_attribute a join pg_catalog.pg_attrdef d
    on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid='public.items_compras_gastos'::regclass
    and a.attname='total' and a.attgenerated='s'
    and pg_catalog.pg_get_expr(d.adbin,d.adrelid)='round((cantidad * costo_unitario), 2)') then
    raise exception 'Total económico incompatible';
  end if;
  for v in select * from (values
    ('compras_gastos','compra_financiada_inmutable','proteger_financiacion_compras',27,false),
    ('items_compras_gastos','items_compra_financiada_inmutables','proteger_financiacion_compras',31,false),
    ('financiaciones_compras','financiacion_confirmada_inmutable','proteger_financiacion_compras',31,false),
    ('tramos_pago_compras','tramo_confirmado_inmutable','proteger_financiacion_compras',31,false),
    ('obligaciones_tarjetas','obligacion_confirmada_inmutable','proteger_financiacion_compras',31,false),
    ('periodos_tarjetas','periodo_utilizado_inmutable','proteger_periodos_tarjetas',31,false),
    ('pagos_resumenes_tarjetas','pago_resumen_inmutable','proteger_pagos_tarjetas',31,false),
    ('aplicaciones_pagos_obligaciones','aplicacion_pago_inmutable','proteger_pagos_tarjetas',31,false),
    ('financiaciones_compras','financiacion_integridad','validar_financiacion_compras_integridad',29,true),
    ('tramos_pago_compras','tramos_integridad','validar_financiacion_compras_integridad',29,true),
    ('obligaciones_tarjetas','obligaciones_integridad','validar_financiacion_compras_integridad',29,true),
    ('periodos_tarjetas','periodos_integridad','validar_financiacion_compras_integridad',29,true),
    ('pagos_resumenes_tarjetas','pagos_resumen_integridad','validar_financiacion_compras_integridad',29,true),
    ('aplicaciones_pagos_obligaciones','aplicaciones_integridad','validar_financiacion_compras_integridad',29,true)
  ) x(tabla,nombre,funcion,tipo,diferido) loop
    if not exists(select 1 from pg_catalog.pg_trigger t
      where t.tgrelid=pg_catalog.to_regclass('public.'||v.tabla) and t.tgname=v.nombre
      and not t.tgisinternal and t.tgenabled='O' and t.tgtype=v.tipo
      and t.tgfoid=pg_catalog.to_regprocedure('public.'||v.funcion||'()')
      and t.tgdeferrable=v.diferido and t.tginitdeferred=v.diferido
      and ((t.tgconstraint<>0)=v.diferido) and t.tgqual is null and t.tgnargs=0) then
      raise exception 'Trigger financiero incompatible: %',v.nombre;
    end if;
  end loop;
end;
$preflight$;

create table public.operaciones_financieras_compras (
  operacion_id uuid primary key,
  actor_id uuid not null references auth.users(id) on delete restrict,
  accion text not null check (accion in ('TARJETA','PERIODO','FINANCIACION','PRIMER_PERIODO','PAGO_RESUMEN')),
  solicitud jsonb not null check (jsonb_typeof(solicitud)='object'),
  resultado jsonb not null check (jsonb_typeof(resultado)='object'),
  created_at timestamptz not null default clock_timestamp()
);
-- Ancla explícita: no se infiere inclusión bancaria desde la fecha de compra.
create table public.inicios_tramos_tarjeta (
  tramo_id uuid primary key references public.tramos_pago_compras(id) on delete restrict,
  primer_periodo_id uuid not null references public.periodos_tarjetas(id) on delete restrict,
  actor_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp()
);
create unique index tarjetas_credito_identidad_logica_idx
  on public.tarjetas_credito(lower(btrim(entidad)),lower(btrim(nombre)));

create function public.iniciar_operacion_financiera_compras(p_id uuid,p_accion text,p_solicitud jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $fn$
declare v public.operaciones_financieras_compras%rowtype; v_actor uuid:=auth.uid();
begin
  if v_actor is null or public.es_admin_hugella() is not true then
    raise exception 'No autorizado' using errcode='42501';
  end if;
  -- Snapshot fresco tras esperar locks: fallar cerrado en aislamientos con snapshot fijo.
  if pg_catalog.current_setting('transaction_isolation')<>'read committed' then
    raise exception 'Operaciones financieras requieren READ COMMITTED' using errcode='25000';
  end if;
  if p_id is null then raise exception 'Operación obligatoria' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('hugella:finanzas:operacion:'||p_id::text,0));
  select * into v from public.operaciones_financieras_compras where operacion_id=p_id;
  if found then
    if v.actor_id is distinct from v_actor or v.accion is distinct from p_accion
      or v.solicitud is distinct from p_solicitud then
      raise exception 'Operación utilizada con otro actor o solicitud' using errcode='22023';
    end if;
    return v.resultado;
  end if;
  -- Volumen HUGELLA: serializa escrituras RPC, además de locks de fila existentes.
  -- Evita inversiones de orden compra/tarjeta/período entre distintas RPC.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('hugella:finanzas:escritura',0));
  return null;
end;
$fn$;

create function public.finalizar_operacion_financiera_compras(p_id uuid,p_accion text,p_solicitud jsonb,p_resultado jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $fn$
begin
  insert into public.operaciones_financieras_compras(operacion_id,actor_id,accion,solicitud,resultado)
    values(p_id,auth.uid(),p_accion,p_solicitud,p_resultado);
  return p_resultado;
end;
$fn$;

create function public.asignar_obligaciones_tarjeta_interno(p_tarjeta uuid)
returns void language plpgsql volatile security definer set search_path='' as $fn$
declare v record; o record; v_orden integer; v_periodo uuid;
begin
  -- Solo tramos confirmados con primer período explícito. No mueve asignadas.
  for v in select t.id,t.compra_id,i.primer_periodo_id
    from public.tramos_pago_compras t join public.inicios_tramos_tarjeta i on i.tramo_id=t.id
    join public.financiaciones_compras f on f.compra_id=t.compra_id
    where t.tarjeta_id=p_tarjeta and f.estado='CONFIRMADA'
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

create function public.crear_tarjeta_credito_admin(p_operacion_id uuid,p_nombre text,p_entidad text)
returns jsonb language plpgsql volatile security definer set search_path='' as $rpc$
declare v_req jsonb; v_res jsonb; v_id uuid;
begin
  v_req:=jsonb_build_object('nombre',nullif(btrim(p_nombre),''),'entidad',nullif(btrim(p_entidad),''));
  v_res:=public.iniciar_operacion_financiera_compras(p_operacion_id,'TARJETA',v_req);
  if v_res is not null then return v_res; end if;
  if v_req->>'nombre' is null or v_req->>'entidad' is null then
    raise exception 'Nombre y entidad obligatorios' using errcode='22023';
  end if;
  insert into public.tarjetas_credito(nombre,entidad,actor_id)
    values(v_req->>'nombre',v_req->>'entidad',auth.uid()) returning id into v_id;
  return public.finalizar_operacion_financiera_compras(p_operacion_id,'TARJETA',v_req,
    jsonb_build_object('operacion_id',p_operacion_id,'tarjeta_id',v_id));
end;
$rpc$;

create function public.registrar_periodo_tarjeta_admin(p_operacion_id uuid,p_tarjeta_id uuid,p_fecha_cierre date,p_fecha_vencimiento date)
returns jsonb language plpgsql volatile security definer set search_path='' as $rpc$
declare v_req jsonb; v_res jsonb; v_id uuid; v_orden integer; v_cierre date; v_vencimiento date;
begin
  v_req:=jsonb_build_object('tarjeta_id',p_tarjeta_id,'fecha_cierre',p_fecha_cierre,'fecha_vencimiento',p_fecha_vencimiento);
  v_res:=public.iniciar_operacion_financiera_compras(p_operacion_id,'PERIODO',v_req);
  if v_res is not null then return v_res; end if;
  if p_tarjeta_id is null or p_fecha_cierre is null or not isfinite(p_fecha_cierre)
    or p_fecha_vencimiento is null or not isfinite(p_fecha_vencimiento) or p_fecha_vencimiento<p_fecha_cierre then
    raise exception 'Período inválido' using errcode='22023';
  end if;
  perform 1 from public.tarjetas_credito where id=p_tarjeta_id and activo for update;
  if not found then raise exception 'Tarjeta inexistente o inactiva' using errcode='22023'; end if;
  select orden,fecha_cierre,fecha_vencimiento into v_orden,v_cierre,v_vencimiento
    from public.periodos_tarjetas where tarjeta_id=p_tarjeta_id order by orden desc limit 1;
  if found and (p_fecha_cierre<=v_cierre or p_fecha_vencimiento<=v_vencimiento) then
    raise exception 'Nuevo período debe ser posterior; backfill requiere corrección auditada' using errcode='22023';
  end if;
  v_orden:=coalesce(v_orden,0)+1;
  insert into public.periodos_tarjetas(tarjeta_id,orden,fecha_cierre,fecha_vencimiento,actor_id)
    values(p_tarjeta_id,v_orden,p_fecha_cierre,p_fecha_vencimiento,auth.uid()) returning id into v_id;
  perform public.asignar_obligaciones_tarjeta_interno(p_tarjeta_id);
  return public.finalizar_operacion_financiera_compras(p_operacion_id,'PERIODO',v_req,
    jsonb_build_object('operacion_id',p_operacion_id,'periodo_id',v_id,'orden',v_orden));
end;
$rpc$;

create function public.confirmar_financiacion_compra_admin(p_operacion_id uuid,p_compra_id uuid,p_tramos jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $rpc$
declare
  v_req jsonb; v_res jsonb; x jsonb; v_tramos jsonb:='[]'; v_total numeric; v_suma numeric:=0;
  v_pos integer; v_medio text; v_importe numeric; v_cuotas integer; v_tarjeta uuid; v_primero uuid;
  v_fecha date; v_tramo uuid; v_centavos numeric;
begin
  -- Autorización antes de procesar payload; también se exige en el helper.
  if auth.uid() is null or public.es_admin_hugella() is not true then raise exception 'No autorizado' using errcode='42501'; end if;
  if p_compra_id is null or p_tramos is null or jsonb_typeof(p_tramos)<>'array'
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
  v_req:=jsonb_build_object('compra_id',p_compra_id,'tramos',v_tramos);
  v_res:=public.iniciar_operacion_financiera_compras(p_operacion_id,'FINANCIACION',v_req);
  if v_res is not null then return v_res; end if;
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
    perform public.asignar_obligaciones_tarjeta_interno(v_tarjeta);
  end loop;
  v_res:=jsonb_build_object('operacion_id',p_operacion_id,'compra_id',p_compra_id,'estado','CONFIRMADA',
    'tramos',(select jsonb_agg(to_jsonb(t) order by t.posicion) from public.tramos_pago_compras t where t.compra_id=p_compra_id));
  return public.finalizar_operacion_financiera_compras(p_operacion_id,'FINANCIACION',v_req,v_res);
end;
$rpc$;

create function public.seleccionar_primer_periodo_tramo_admin(p_operacion_id uuid,p_tramo_id uuid,p_periodo_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $rpc$
declare v_req jsonb; v_res jsonb; v public.tramos_pago_compras%rowtype;
begin
  v_req:=jsonb_build_object('tramo_id',p_tramo_id,'periodo_id',p_periodo_id);
  v_res:=public.iniciar_operacion_financiera_compras(p_operacion_id,'PRIMER_PERIODO',v_req);
  if v_res is not null then return v_res; end if;
  select * into v from public.tramos_pago_compras where id=p_tramo_id;
  if not found or v.medio<>'TARJETA_CREDITO' then raise exception 'Tramo de tarjeta inexistente' using errcode='22023'; end if;
  perform 1 from public.compras_gastos where id=v.compra_id for update;
  perform 1 from public.tarjetas_credito where id=v.tarjeta_id for update;
  perform 1 from public.periodos_tarjetas where id=p_periodo_id and tarjeta_id=v.tarjeta_id for update;
  if not found or not exists(select 1 from public.financiaciones_compras where compra_id=v.compra_id and estado='CONFIRMADA') then
    raise exception 'Período o financiación incompatible' using errcode='22023'; end if;
  if exists(select 1 from public.inicios_tramos_tarjeta where tramo_id=v.id)
    or exists(select 1 from public.obligaciones_tarjetas where tramo_id=v.id and periodo_id is not null) then
    raise exception 'Primer período ya seleccionado o tramo utilizado' using errcode='22023'; end if;
  insert into public.inicios_tramos_tarjeta(tramo_id,primer_periodo_id,actor_id) values(v.id,p_periodo_id,auth.uid());
  perform public.asignar_obligaciones_tarjeta_interno(v.tarjeta_id);
  return public.finalizar_operacion_financiera_compras(p_operacion_id,'PRIMER_PERIODO',v_req,
    jsonb_build_object('operacion_id',p_operacion_id,'tramo_id',v.id,'primer_periodo_id',p_periodo_id));
end;
$rpc$;

create function public.registrar_pago_resumen_tarjeta_admin(p_operacion_id uuid,p_periodo_id uuid,p_fecha_pago date,p_importe numeric,p_referencia text default null)
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
  for o in select ob.id,ob.importe-coalesce((select sum(a.importe) from public.aplicaciones_pagos_obligaciones a where a.obligacion_id=ob.id),0) saldo
    from public.obligaciones_tarjetas ob join public.financiaciones_compras f on f.compra_id=ob.compra_id
    where ob.periodo_id=p_periodo_id and f.estado='CONFIRMADA'
    order by ob.numero_cuota,ob.compra_id,ob.tramo_id,ob.id loop
    if o.saldo<=0 then continue; end if;
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

create function public.obtener_financiacion_compra_admin(p_compra_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $rpc$
declare v_total numeric; v_pagado numeric; v_estado text;
begin
  if auth.uid() is null or public.es_admin_hugella() is not true then raise exception 'No autorizado' using errcode='42501'; end if;
  perform 1 from public.compras_gastos where id=p_compra_id;
  if not found then raise exception 'Compra inexistente' using errcode='22023'; end if;
  select sum(total) into v_total from public.items_compras_gastos where compra_gasto_id=p_compra_id;
  select estado into v_estado from public.financiaciones_compras where compra_id=p_compra_id;
  if v_estado is distinct from 'CONFIRMADA' then
    return jsonb_build_object('compra_id',p_compra_id,'total_compra',v_total,'total_pagado',null,'saldo_pendiente',null,
      'estado','FINANCIACION_NO_REGISTRADA','estado_financiacion',v_estado);
  end if;
  select coalesce(sum(importe),0) into v_pagado from public.tramos_pago_compras where compra_id=p_compra_id and medio<>'TARJETA_CREDITO';
  v_pagado:=v_pagado+coalesce((select sum(a.importe) from public.aplicaciones_pagos_obligaciones a
    join public.obligaciones_tarjetas o on o.id=a.obligacion_id where o.compra_id=p_compra_id),0);
  return jsonb_build_object('compra_id',p_compra_id,'total_compra',v_total,'total_pagado',v_pagado,'saldo_pendiente',v_total-v_pagado,
    'estado',case when v_total=v_pagado then 'CANCELADA' else 'ACTIVA' end,'estado_financiacion',v_estado);
end;
$rpc$;

create function public.obtener_saldo_periodo_tarjeta_admin(p_periodo_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $rpc$
declare v_total numeric; v_pagado numeric;
begin
  if auth.uid() is null or public.es_admin_hugella() is not true then raise exception 'No autorizado' using errcode='42501'; end if;
  perform 1 from public.periodos_tarjetas where id=p_periodo_id;
  if not found then raise exception 'Período inexistente' using errcode='22023'; end if;
  select coalesce(sum(o.importe),0) into v_total from public.obligaciones_tarjetas o
    join public.financiaciones_compras f on f.compra_id=o.compra_id where o.periodo_id=p_periodo_id and f.estado='CONFIRMADA';
  select coalesce(sum(importe),0) into v_pagado from public.pagos_resumenes_tarjetas where periodo_id=p_periodo_id;
  return jsonb_build_object('periodo_id',p_periodo_id,'total_obligaciones_hugella',v_total,'total_pagado',v_pagado,'saldo',v_total-v_pagado,
    'estado',case when v_total=0 and v_pagado=0 then 'SIN_OBLIGACIONES' when v_total=v_pagado then 'PAGADO' when v_pagado=0 then 'PENDIENTE' else 'PAGO_PARCIAL' end);
end;
$rpc$;

create function public.listar_tarjetas_financieras_admin()
returns setof public.tarjetas_credito language plpgsql stable security definer set search_path='' as $rpc$
begin
  if auth.uid() is null or public.es_admin_hugella() is not true then raise exception 'No autorizado' using errcode='42501'; end if;
  return query select * from public.tarjetas_credito order by entidad,nombre,id;
end;
$rpc$;
create function public.listar_periodos_tarjeta_admin(p_tarjeta_id uuid,p_limite integer default 50,p_offset integer default 0)
returns setof public.periodos_tarjetas language plpgsql stable security definer set search_path='' as $rpc$
begin
  if auth.uid() is null or public.es_admin_hugella() is not true then raise exception 'No autorizado' using errcode='42501'; end if;
  if p_tarjeta_id is null or p_limite is null or p_limite not between 1 and 100 or p_offset is null or p_offset<0 then
    raise exception 'Paginación inválida' using errcode='22023'; end if;
  return query select * from public.periodos_tarjetas where tarjeta_id=p_tarjeta_id order by orden limit p_limite offset p_offset;
end;
$rpc$;

alter table public.operaciones_financieras_compras owner to postgres;
alter table public.operaciones_financieras_compras enable row level security;
revoke all on table public.operaciones_financieras_compras from public,anon,authenticated,service_role;
alter table public.inicios_tramos_tarjeta owner to postgres;
alter table public.inicios_tramos_tarjeta enable row level security;
revoke all on table public.inicios_tramos_tarjeta from public,anon,authenticated,service_role;

do $security$
declare v record;
begin
  for v in select p.oid,p.proname from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in (
      'iniciar_operacion_financiera_compras','finalizar_operacion_financiera_compras','asignar_obligaciones_tarjeta_interno',
      'crear_tarjeta_credito_admin','registrar_periodo_tarjeta_admin','confirmar_financiacion_compra_admin',
      'seleccionar_primer_periodo_tramo_admin','registrar_pago_resumen_tarjeta_admin',
      'obtener_financiacion_compra_admin','obtener_saldo_periodo_tarjeta_admin','listar_tarjetas_financieras_admin','listar_periodos_tarjeta_admin') loop
    execute format('alter function %s owner to postgres',v.oid::regprocedure);
    execute format('revoke all on function %s from public,anon,authenticated,service_role',v.oid::regprocedure);
    if v.proname not in ('iniciar_operacion_financiera_compras','finalizar_operacion_financiera_compras','asignar_obligaciones_tarjeta_interno') then
      execute format('grant execute on function %s to authenticated',v.oid::regprocedure);
    end if;
  end loop;
end;
$security$;
commit;
