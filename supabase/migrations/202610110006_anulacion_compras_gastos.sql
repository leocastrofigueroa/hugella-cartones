-- Anulación lógica auditada. Nunca elimina ni modifica hechos económicos históricos.
-- Los validadores/triggers financieros instalados permanecen intactos.
begin;
lock table public.operaciones_financieras_compras in access exclusive mode;
do $preflight$
declare v record;
begin
  if to_regclass('public.anulaciones_compras_gastos') is not null
    or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname in ('anular_compra_gasto_admin','proteger_anulaciones_compras_gastos')) then
    raise exception 'Anulación ya instalada o incompatible';
  end if;
  for v in select * from (values
    ('public.asignar_obligaciones_tarjeta_interno(uuid)','f01c251acd5a323056f71722f73398ea'),
    ('public.registrar_pago_resumen_tarjeta_admin(uuid,uuid,date,numeric,text)','a5cd54586dc5e8b3b0dc8de8ba88f59c'),
    ('public.obtener_saldo_periodo_tarjeta_admin(uuid)','d62ddafec982e9930fdb8ee4b0f77853'),
    ('public.listar_resumenes_tarjeta_admin(uuid,integer,integer)','6feefc9f9160cbfbaa21dc828a8a33de'),
    ('public.confirmar_financiacion_compra_admin(uuid,uuid,jsonb)','a67b8009a725553ecf4d8f7bf364f146'),
    ('public.seleccionar_primer_periodo_tramo_admin(uuid,uuid,uuid)','67638713461c5f22eae28d841f6d4b5b'),
    ('public.obtener_financiacion_compra_admin(uuid)','68a8cec7d027821a4b28abb9cbb5b19b'),
    ('public.obtener_detalle_financiacion_compra_admin(uuid)','8d8c7b397ae4a184c355ab99cacfff83'),
    ('public.obtener_compra_gasto_admin(uuid)','42f8faf12e053351e3a7c4ada6ae2185'),
    ('public.buscar_compras_gastos_admin(integer,integer)','451086e64c4637a1a7bf120e63d02278'),
    ('public.iniciar_operacion_financiera_compras(uuid,text,jsonb)','24f3395e9cd1e4f902cfcc111a2fa4ff'),
    ('public.finalizar_operacion_financiera_compras(uuid,text,jsonb,jsonb)','1f5cbf8eb06f5d71c8d3ad4abd262512')
  ) x(firma,hash) loop
    if not exists(select 1 from pg_proc where oid=to_regprocedure(v.firma)
      and md5(prosrc)=v.hash and prosecdef and pg_get_userbyid(proowner)='postgres'
      and proconfig=ARRAY['search_path=""']) then
      raise exception 'Función previa incompatible: %',v.firma;
    end if;
  end loop;
  if not exists(select 1 from pg_constraint where conrelid='public.operaciones_financieras_compras'::regclass
    and conname='operaciones_financieras_compras_accion_check' and convalidated
    and pg_get_constraintdef(oid)=$$CHECK ((accion = ANY (ARRAY['TARJETA'::text, 'PERIODO'::text, 'FINANCIACION'::text, 'PRIMER_PERIODO'::text, 'PAGO_RESUMEN'::text, 'COMPRA_FINANCIADA'::text, 'EDICION_TARJETA'::text])))$$) then
    raise exception 'Acciones financieras incompatibles';
  end if;
end;
$preflight$;
create table public.anulaciones_compras_gastos (
  compra_gasto_id uuid primary key references public.compras_gastos(id) on delete restrict,
  operacion_id uuid not null unique references public.operaciones_financieras_compras(operacion_id)
    on delete restrict deferrable initially deferred,
  motivo text not null check(motivo=btrim(motivo) and length(motivo)>0),
  created_at timestamptz not null default clock_timestamp(),
  actor_id uuid not null references auth.users(id) on delete restrict
);
alter table public.anulaciones_compras_gastos owner to postgres;
alter table public.anulaciones_compras_gastos enable row level security;
revoke all on table public.anulaciones_compras_gastos from public,anon,authenticated,service_role;
create function public.proteger_anulaciones_compras_gastos() returns trigger
language plpgsql security definer set search_path='' as $fn$
begin
  raise exception 'La anulación auditada es inmutable' using errcode='23514';
end;
$fn$;
create trigger anulacion_compra_inmutable before update or delete on public.anulaciones_compras_gastos
for each row execute function public.proteger_anulaciones_compras_gastos();
alter function public.proteger_anulaciones_compras_gastos() owner to postgres;
revoke all on function public.proteger_anulaciones_compras_gastos() from public,anon,authenticated,service_role;
alter table public.operaciones_financieras_compras drop constraint operaciones_financieras_compras_accion_check;
alter table public.operaciones_financieras_compras add constraint operaciones_financieras_compras_accion_check
  check(accion in ('TARJETA','PERIODO','FINANCIACION','PRIMER_PERIODO','PAGO_RESUMEN','COMPRA_FINANCIADA','EDICION_TARJETA','ANULACION_COMPRA'));
create function public.anular_compra_gasto_admin(p_operacion_id uuid,p_compra_gasto_id uuid,p_motivo text)
returns jsonb language plpgsql volatile security definer set search_path='' as $rpc$
declare v_req jsonb; v_res jsonb; v public.anulaciones_compras_gastos%rowtype;
  v_motivo text:=nullif(btrim(p_motivo),'');
begin
  v_req:=jsonb_build_object('compra_gasto_id',p_compra_gasto_id,'motivo',v_motivo);
  -- Mismo namespace y lock global que pagos/financiaciones: carrera serializada.
  v_res:=public.iniciar_operacion_financiera_compras(p_operacion_id,'ANULACION_COMPRA',v_req);
  if v_res is not null then return v_res; end if;
  if p_compra_gasto_id is null or v_motivo is null then raise exception 'Compra y motivo obligatorios' using errcode='22023'; end if;
  perform 1 from public.compras_gastos where id=p_compra_gasto_id for update;
  if not found then raise exception 'Compra inexistente' using errcode='22023'; end if;
  if exists(select 1 from public.anulaciones_compras_gastos where compra_gasto_id=p_compra_gasto_id) then
    raise exception 'La compra ya está anulada' using errcode='23514'; end if;
  if exists(select 1 from public.obligaciones_tarjetas o join public.aplicaciones_pagos_obligaciones a
    on a.obligacion_id=o.id where o.compra_id=p_compra_gasto_id) then
    raise exception 'La compra tiene pagos de tarjeta aplicados y requiere corrección financiera' using errcode='23514'; end if;
  insert into public.anulaciones_compras_gastos(compra_gasto_id,operacion_id,motivo,actor_id)
    values(p_compra_gasto_id,p_operacion_id,v_motivo,auth.uid()) returning * into v;
  v_res:=to_jsonb(v)||jsonb_build_object('estado','ANULADA');
  return public.finalizar_operacion_financiera_compras(p_operacion_id,'ANULACION_COMPRA',v_req,v_res);
end;
$rpc$;
alter function public.anular_compra_gasto_admin(uuid,uuid,text) owner to postgres;
revoke all on function public.anular_compra_gasto_admin(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.anular_compra_gasto_admin(uuid,uuid,text) to authenticated;

create or replace function public.asignar_obligaciones_tarjeta_interno(p_tarjeta uuid)
returns void language plpgsql volatile security definer set search_path='' as $fn$
declare v record; o record; v_orden integer; v_periodo uuid;
begin
  -- Solo tramos confirmados con primer período explícito. No mueve asignadas.
  for v in select t.id,t.compra_id,i.primer_periodo_id
    from public.tramos_pago_compras t join public.inicios_tramos_tarjeta i on i.tramo_id=t.id
    join public.financiaciones_compras f on f.compra_id=t.compra_id
    where t.tarjeta_id=p_tarjeta and f.estado='CONFIRMADA' and not exists(select 1 from public.anulaciones_compras_gastos ac where ac.compra_gasto_id=t.compra_id)
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
alter function public.asignar_obligaciones_tarjeta_interno(uuid) owner to postgres;
revoke all on function public.asignar_obligaciones_tarjeta_interno(uuid) from public,anon,authenticated,service_role;

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
  for o in select ob.id,ob.importe-coalesce((select sum(a.importe) from public.aplicaciones_pagos_obligaciones a where a.obligacion_id=ob.id),0) saldo
    from public.obligaciones_tarjetas ob join public.financiaciones_compras f on f.compra_id=ob.compra_id
    where ob.periodo_id=p_periodo_id and f.estado='CONFIRMADA' and not exists(select 1 from public.anulaciones_compras_gastos ac where ac.compra_gasto_id=ob.compra_id)
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
alter function public.registrar_pago_resumen_tarjeta_admin(uuid,uuid,date,numeric,text) owner to postgres;
revoke all on function public.registrar_pago_resumen_tarjeta_admin(uuid,uuid,date,numeric,text) from public,anon,authenticated,service_role;
grant execute on function public.registrar_pago_resumen_tarjeta_admin(uuid,uuid,date,numeric,text) to authenticated;

create or replace function public.obtener_saldo_periodo_tarjeta_admin(p_periodo_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $rpc$
declare v_total numeric; v_pagado numeric;
begin
  if auth.uid() is null or public.es_admin_hugella() is not true then raise exception 'No autorizado' using errcode='42501'; end if;
  perform 1 from public.periodos_tarjetas where id=p_periodo_id;
  if not found then raise exception 'Período inexistente' using errcode='22023'; end if;
  select coalesce(sum(o.importe),0) into v_total from public.obligaciones_tarjetas o
    join public.financiaciones_compras f on f.compra_id=o.compra_id where o.periodo_id=p_periodo_id and f.estado='CONFIRMADA' and not exists(select 1 from public.anulaciones_compras_gastos ac where ac.compra_gasto_id=o.compra_id);
  select coalesce(sum(importe),0) into v_pagado from public.pagos_resumenes_tarjetas where periodo_id=p_periodo_id;
  return jsonb_build_object('periodo_id',p_periodo_id,'total_obligaciones_hugella',v_total,'total_pagado',v_pagado,'saldo',v_total-v_pagado,
    'estado',case when v_total=0 and v_pagado=0 then 'SIN_OBLIGACIONES' when v_total=v_pagado then 'PAGADO' when v_pagado=0 then 'PENDIENTE' else 'PAGO_PARCIAL' end);
end;
$rpc$;
alter function public.obtener_saldo_periodo_tarjeta_admin(uuid) owner to postgres;
revoke all on function public.obtener_saldo_periodo_tarjeta_admin(uuid) from public,anon,authenticated,service_role;
grant execute on function public.obtener_saldo_periodo_tarjeta_admin(uuid) to authenticated;

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
  -- Página primero; agregados independientes evitan multiplicar obligaciones por pagos.
  return query select p.id,p.orden,p.fecha_cierre,p.fecha_vencimiento,o.total,a.pagado,
    o.total-a.pagado,case when o.total=0 and a.pagado=0 then 'SIN_OBLIGACIONES'
      when o.total=a.pagado then 'PAGADO' when a.pagado=0 then 'PENDIENTE' else 'PAGO_PARCIAL' end
    from (select per.* from public.periodos_tarjetas per where per.tarjeta_id=p_tarjeta_id
      order by per.orden limit p_limite offset p_offset) p
    cross join lateral (select coalesce(sum(ob.importe),0) total from public.obligaciones_tarjetas ob
      join public.financiaciones_compras f on f.compra_id=ob.compra_id where ob.periodo_id=p.id and f.estado='CONFIRMADA' and not exists(select 1 from public.anulaciones_compras_gastos ac where ac.compra_gasto_id=ob.compra_id)) o
    cross join lateral (select coalesce(sum(pa.importe),0) pagado from public.pagos_resumenes_tarjetas pa where pa.periodo_id=p.id) a
    order by p.orden;
end;
$rpc$;
alter function public.listar_resumenes_tarjeta_admin(uuid,integer,integer) owner to postgres;
revoke all on function public.listar_resumenes_tarjeta_admin(uuid,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.listar_resumenes_tarjeta_admin(uuid,integer,integer) to authenticated;

create or replace function public.confirmar_financiacion_compra_admin(p_operacion_id uuid,p_compra_id uuid,p_tramos jsonb)
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
    perform public.asignar_obligaciones_tarjeta_interno(v_tarjeta);
  end loop;
  v_res:=jsonb_build_object('operacion_id',p_operacion_id,'compra_id',p_compra_id,'estado','CONFIRMADA',
    'tramos',(select jsonb_agg(to_jsonb(t) order by t.posicion) from public.tramos_pago_compras t where t.compra_id=p_compra_id));
  return public.finalizar_operacion_financiera_compras(p_operacion_id,'FINANCIACION',v_req,v_res);
end;
$rpc$;
alter function public.confirmar_financiacion_compra_admin(uuid,uuid,jsonb) owner to postgres;
revoke all on function public.confirmar_financiacion_compra_admin(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.confirmar_financiacion_compra_admin(uuid,uuid,jsonb) to authenticated;

create or replace function public.seleccionar_primer_periodo_tramo_admin(p_operacion_id uuid,p_tramo_id uuid,p_periodo_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $rpc$
declare v_req jsonb; v_res jsonb; v public.tramos_pago_compras%rowtype;
begin
  v_req:=jsonb_build_object('tramo_id',p_tramo_id,'periodo_id',p_periodo_id);
  v_res:=public.iniciar_operacion_financiera_compras(p_operacion_id,'PRIMER_PERIODO',v_req);
  if v_res is not null then return v_res; end if;
  select * into v from public.tramos_pago_compras where id=p_tramo_id;
  if not found or v.medio<>'TARJETA_CREDITO' then raise exception 'Tramo de tarjeta inexistente' using errcode='22023'; end if;
  perform 1 from public.compras_gastos where id=v.compra_id for update;
  if exists(select 1 from public.anulaciones_compras_gastos where compra_gasto_id=v.compra_id) then raise exception 'Compra anulada; no admite primer período' using errcode='23514'; end if;
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
alter function public.seleccionar_primer_periodo_tramo_admin(uuid,uuid,uuid) owner to postgres;
revoke all on function public.seleccionar_primer_periodo_tramo_admin(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.seleccionar_primer_periodo_tramo_admin(uuid,uuid,uuid) to authenticated;

create or replace function public.obtener_financiacion_compra_admin(p_compra_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $rpc$
declare v_total numeric; v_pagado numeric; v_estado text; v_anulacion jsonb; v_saldo_operativo numeric;
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
  -- Conserva el saldo histórico; el campo compatible saldo_pendiente es operativo.
  v_saldo_operativo:=case when v_anulacion is not null then 0 else v_total-v_pagado end;
  return jsonb_build_object('compra_id',p_compra_id,'total_compra',v_total,'total_pagado',v_pagado,
    'saldo_historico',v_total-v_pagado,'saldo_operativo',v_saldo_operativo,'saldo_pendiente',v_saldo_operativo,
    'anulacion',v_anulacion,'estado',case when v_anulacion is not null then 'ANULADA' when v_total=v_pagado then 'CANCELADA' else 'ACTIVA' end,'estado_financiacion',v_estado);
end;
$rpc$;
alter function public.obtener_financiacion_compra_admin(uuid) owner to postgres;
revoke all on function public.obtener_financiacion_compra_admin(uuid) from public,anon,authenticated,service_role;
grant execute on function public.obtener_financiacion_compra_admin(uuid) to authenticated;

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
    'total_aplicado',a.pagado,'saldo_historico',o.importe-a.pagado,
    'saldo_operativo',case when v_res->>'estado'='ANULADA' then 0 else o.importe-a.pagado end,
    'saldo',case when v_res->>'estado'='ANULADA' then 0 else o.importe-a.pagado end,
    'estado',case when v_res->>'estado'='ANULADA' then 'ANULADA' when a.pagado=0 then 'PENDIENTE' when a.pagado=o.importe then 'PAGADA' else 'PAGO_PARCIAL' end)
    order by t.posicion,o.numero_cuota),'[]') into v_cuotas
    from public.obligaciones_tarjetas o join public.tramos_pago_compras t on t.id=o.tramo_id
    left join public.periodos_tarjetas p on p.id=o.periodo_id
    cross join lateral (select coalesce(sum(ap.importe),0) pagado
      from public.aplicaciones_pagos_obligaciones ap where ap.obligacion_id=o.id) a
    where o.compra_id=p_compra_id;
  return v_res||jsonb_build_object('formas_pago',v_formas,'cuotas',v_cuotas);
end;
$rpc$;
alter function public.obtener_detalle_financiacion_compra_admin(uuid) owner to postgres;
revoke all on function public.obtener_detalle_financiacion_compra_admin(uuid) from public,anon,authenticated,service_role;
grant execute on function public.obtener_detalle_financiacion_compra_admin(uuid) to authenticated;

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
  return v_resultado||jsonb_build_object('anulacion',(select to_jsonb(ac) from public.anulaciones_compras_gastos ac where ac.compra_gasto_id=p_compra_gasto_id));
end;
$rpc$;
alter function public.obtener_compra_gasto_admin(uuid) owner to postgres;
revoke all on function public.obtener_compra_gasto_admin(uuid) from public,anon,authenticated,service_role;
grant execute on function public.obtener_compra_gasto_admin(uuid) to authenticated;

-- Cambia retorno del listado: DROP sin CASCADE; dependencias inesperadas abortan.
drop function public.buscar_compras_gastos_admin(integer,integer);
create function public.buscar_compras_gastos_admin(
  p_limite integer default 50,
  p_offset integer default 0
) returns table(
  id uuid,
  tipo text,
  fecha date,
  proveedor_id uuid,
  proveedor_nombre text,
  moneda text,
  comprobante text,
  observaciones text,
  total numeric,
  cantidad_items bigint,
  created_at timestamptz,
  anulacion jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $rpc$
begin
  if auth.uid() is null or public.es_admin_hugella() is not true then
    raise exception 'No autorizado' using errcode='42501';
  end if;

  if p_limite is null or p_limite not between 1 and 100
     or p_offset is null or p_offset < 0 then
    raise exception 'Paginación inválida' using errcode='22023';
  end if;

  return query
    select
      cg.id,
      cg.tipo,
      cg.fecha,
      cg.proveedor_id,
      pr.nombre,
      cg.moneda,
      cg.comprobante,
      cg.observaciones,
      (select sum(it.total)
         from public.items_compras_gastos it
        where it.compra_gasto_id = cg.id),
      (select count(*)
         from public.items_compras_gastos it
        where it.compra_gasto_id = cg.id),
      cg.created_at,
      (select to_jsonb(ac) from public.anulaciones_compras_gastos ac where ac.compra_gasto_id=cg.id)
    from public.compras_gastos cg
    join public.proveedores pr on pr.id = cg.proveedor_id
    order by cg.created_at desc, cg.id desc
    limit p_limite
    offset p_offset;
end;
$rpc$;
alter function public.buscar_compras_gastos_admin(integer,integer) owner to postgres;
revoke all on function public.buscar_compras_gastos_admin(integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.buscar_compras_gastos_admin(integer,integer) to authenticated;
commit;
