begin;

-- Migración local pendiente. No modifica datos ni la migración base ya aplicada.
-- Fallar ante drift: no reemplazar silenciosamente una definición más reciente.
do $preflight$
declare v record;
begin
  if to_regclass('public.devoluciones_tarjetas') is null then raise exception 'Falta la base 202610260001'; end if;
  for v in select * from (values
 ('public.listar_resumenes_tarjeta_admin(uuid,integer,integer)','e05d6bc1dd3296e6458dc052f5ead326'),
 ('public.obtener_financiacion_compra_admin(uuid)','ebf18fcf1ceceedb9af5688e84623438'),
 ('public.obtener_compra_gasto_admin(uuid)','1f667e1cdf9958869837c73e87142a02'),
 ('public.obtener_detalle_financiacion_compra_admin(uuid)','0700b89c468f40adc441a0df7b2c6378'),
 ('public.obtener_saldo_periodo_tarjeta_admin(uuid)','58918cbcc91441e1691ec2082232eee5'),
 ('public.registrar_pago_resumen_tarjeta_admin(uuid,uuid,date,numeric,text)','1c6da450633b0d32d51083caddfb2d52'),
 ('public.iniciar_operacion_financiera_compras(uuid,text,jsonb)','24f3395e9cd1e4f902cfcc111a2fa4ff'),
 ('public.listar_calendario_financiero_admin()','5967743e30e3a39a983b90076f2ea354')
  ) x(firma,hash) loop
    if not exists(select 1 from pg_catalog.pg_proc where oid=to_regprocedure(v.firma)
      and md5(prosrc)=v.hash and prosecdef and proowner='postgres'::regrole
      and proconfig=array['search_path=""']) then
      raise exception 'Definición financiera incompatible: %',v.firma;
    end if;
  end loop;
end;
$preflight$;


-- ============================================================
-- 1. SALDO BASE DE CADA OBLIGACIÓN
--
-- Todavía sin aplicar devoluciones.
-- Sí contempla:
-- - cortes históricos
-- - pagos reales
-- - anulaciones completas
-- - cancelaciones financieras de cuotas
-- ============================================================

create or replace view public.vw_obligaciones_tarjetas_base_financiera as
with cortes as (
  select
    c.obligacion_id,
    coalesce(sum(c.importe), 0::numeric) as importe_cortado
  from public.cortes_historicos_obligaciones_tarjeta c
  group by c.obligacion_id
),
aplicaciones as (
  select
    a.obligacion_id,
    coalesce(sum(a.importe), 0::numeric) as importe_pagado
  from public.aplicaciones_pagos_obligaciones a
  group by a.obligacion_id
)
select
  ot.id,
  ot.compra_id,
  ot.tramo_id,
  ot.tarjeta_id,
  tc.nombre as tarjeta,
  ot.numero_cuota,
  ot.cantidad_cuotas,
  ot.importe,

  coalesce(c.importe_cortado, 0::numeric)
    as importe_cortado_historico,

  coalesce(a.importe_pagado, 0::numeric)
    as importe_pagado_real,

  case
    when ac.compra_gasto_id is not null
      or cot.obligacion_id is not null
      then 0::numeric

    else greatest(
      ot.importe
      - coalesce(c.importe_cortado, 0::numeric)
      - coalesce(a.importe_pagado, 0::numeric),
      0::numeric
    )
  end as saldo_base,

  ot.periodo_id,
  pt.orden as periodo_orden,
  pt.fecha_cierre,
  pt.fecha_vencimiento,

  case
    when ot.periodo_id is null
      then 'SIN_PERIODO'::text
    else 'CON_VENCIMIENTO'::text
  end as estado_periodo

from public.obligaciones_tarjetas ot
join public.financiaciones_compras f on f.compra_id=ot.compra_id and f.estado='CONFIRMADA'

join public.tarjetas_credito tc
  on tc.id = ot.tarjeta_id

left join public.periodos_tarjetas pt
  on pt.id = ot.periodo_id

left join cortes c
  on c.obligacion_id = ot.id

left join aplicaciones a
  on a.obligacion_id = ot.id

left join public.anulaciones_compras_gastos ac
  on ac.compra_gasto_id = ot.compra_id

left join public.cancelaciones_obligaciones_tarjeta cot
  on cot.obligacion_id = ot.id;


alter view public.vw_obligaciones_tarjetas_base_financiera
  owner to postgres;

revoke all
on public.vw_obligaciones_tarjetas_base_financiera
from public, anon, authenticated;


-- ============================================================
-- 2. SITUACIÓN FINANCIERA DE CADA PERÍODO
--
-- Calculamos:
-- obligaciones todavía pendientes
-- devoluciones acreditadas
-- crédito proveniente del período anterior
-- saldo a favor que pasa al siguiente
-- ============================================================

create or replace view public.vw_periodos_tarjetas_financieros as
with recursive

devoluciones as (
  select
    a.periodo_id,
    coalesce(sum(a.importe), 0::numeric) as importe
  from public.acreditaciones_devoluciones_tarjetas a
  group by a.periodo_id
),

base as (
  select
    p.id as periodo_id,
    p.tarjeta_id,
    tc.nombre as tarjeta,
    p.orden,
    p.fecha_cierre,
    p.fecha_vencimiento,

    coalesce(
      sum(o.saldo_base),
      0::numeric
    ) as obligaciones_pendientes,

    coalesce(
      d.importe,
      0::numeric
    ) as devoluciones_acreditadas

  from public.periodos_tarjetas p

  join public.tarjetas_credito tc
    on tc.id = p.tarjeta_id

  left join public.vw_obligaciones_tarjetas_base_financiera o
    on o.periodo_id = p.id

  left join devoluciones d
    on d.periodo_id = p.id

  group by
    p.id,
    p.tarjeta_id,
    tc.nombre,
    p.orden,
    p.fecha_cierre,
    p.fecha_vencimiento,
    d.importe
),

ordenados as (
  select
    b.*,
    row_number() over (
      partition by b.tarjeta_id
      order by b.orden, b.periodo_id
    ) as rn
  from base b
),

recorrido as (
  select
    o.periodo_id,
    o.tarjeta_id,
    o.tarjeta,
    o.orden,
    o.fecha_cierre,
    o.fecha_vencimiento,
    o.obligaciones_pendientes,
    o.devoluciones_acreditadas,
    o.rn,

    0::numeric as saldo_a_favor_entrante,

    o.devoluciones_acreditadas
      as credito_disponible,

    greatest(
      o.obligaciones_pendientes
      - o.devoluciones_acreditadas,
      0::numeric
    ) as saldo_a_pagar,

    greatest(
      o.devoluciones_acreditadas
      - o.obligaciones_pendientes,
      0::numeric
    ) as saldo_a_favor

  from ordenados o
  where o.rn = 1

  union all

  select
    o.periodo_id,
    o.tarjeta_id,
    o.tarjeta,
    o.orden,
    o.fecha_cierre,
    o.fecha_vencimiento,
    o.obligaciones_pendientes,
    o.devoluciones_acreditadas,
    o.rn,

    r.saldo_a_favor
      as saldo_a_favor_entrante,

    r.saldo_a_favor
      + o.devoluciones_acreditadas
      as credito_disponible,

    greatest(
      o.obligaciones_pendientes
      - r.saldo_a_favor
      - o.devoluciones_acreditadas,
      0::numeric
    ) as saldo_a_pagar,

    greatest(
      r.saldo_a_favor
      + o.devoluciones_acreditadas
      - o.obligaciones_pendientes,
      0::numeric
    ) as saldo_a_favor

  from recorrido r

  join ordenados o
    on o.tarjeta_id = r.tarjeta_id
   and o.rn = r.rn + 1
)

select
  periodo_id,
  tarjeta_id,
  tarjeta,
  orden,
  fecha_cierre,
  fecha_vencimiento,
  obligaciones_pendientes,
  devoluciones_acreditadas,
  saldo_a_favor_entrante,
  credito_disponible,
  saldo_a_pagar,
  saldo_a_favor
from recorrido;


alter view public.vw_periodos_tarjetas_financieros
  owner to postgres;

revoke all
on public.vw_periodos_tarjetas_financieros
from public, anon, authenticated;


-- ============================================================
-- 3. VISTA FINANCIERA FINAL DE OBLIGACIONES
--
-- Repartimos el crédito disponible del período entre las
-- obligaciones pendientes manteniendo un orden determinista.
--
-- Esta vista conserva exactamente las columnas que ya consumen
-- Panel, Calendario y Proyección.
-- ============================================================

create or replace view public.vw_obligaciones_tarjetas_financieras as
with distribucion as (
  select
    o.*,

    coalesce(
      p.credito_disponible,
      0::numeric
    ) as credito_disponible,

    coalesce(
      sum(o.saldo_base) over (
        partition by o.periodo_id
        order by
          o.numero_cuota,
          o.compra_id,
          o.tramo_id,
          o.id
        rows between unbounded preceding and 1 preceding
      ),
      0::numeric
    ) as saldo_anterior

  from public.vw_obligaciones_tarjetas_base_financiera o

  left join public.vw_periodos_tarjetas_financieros p
    on p.periodo_id = o.periodo_id
)

select
  d.id,
  d.compra_id,
  d.tramo_id,
  d.tarjeta_id,
  d.tarjeta,
  d.numero_cuota,
  d.cantidad_cuotas,
  d.importe,
  d.importe_cortado_historico,
  d.importe_pagado_real,

  case
    when d.periodo_id is null then
      d.saldo_base

    else greatest(
      d.saldo_base
      -
      greatest(
        least(
          d.credito_disponible - d.saldo_anterior,
          d.saldo_base
        ),
        0::numeric
      ),
      0::numeric
    )
  end as saldo_pendiente,

  d.periodo_id,
  d.periodo_orden,
  d.fecha_cierre,
  d.fecha_vencimiento,
  d.estado_periodo

from distribucion d;


alter view public.vw_obligaciones_tarjetas_financieras
  owner to postgres;

revoke all
on public.vw_obligaciones_tarjetas_financieras
from public, anon, authenticated;


-- ============================================================
-- 4. SALDO DE UN RESUMEN
--
-- Conservamos la respuesta existente y agregamos información
-- de devoluciones y saldo a favor.
-- ============================================================

create or replace function public.obtener_saldo_periodo_tarjeta_admin(
  p_periodo_id uuid
)
returns jsonb language plpgsql stable security definer
set search_path = '' as $rpc$
declare
  v_total numeric;
  v_pagado numeric;
  v_corte numeric;
  v_cancelado numeric;
  v_fin public.vw_periodos_tarjetas_financieros%rowtype;
begin
  if auth.uid() is null or public.es_admin_hugella() is not true then
    raise exception 'No autorizado' using errcode='42501';
  end if;

  perform 1 from public.periodos_tarjetas where id=p_periodo_id;
  if not found then
    raise exception 'Período inexistente' using errcode='22023';
  end if;

  -- Importe original: no borrar cuotas canceladas del historial.
  select coalesce(sum(o.importe),0)
  into v_total
  from public.obligaciones_tarjetas o
  join public.financiaciones_compras f on f.compra_id=o.compra_id
  where o.periodo_id=p_periodo_id
    and f.estado='CONFIRMADA'
    and not exists (
      select 1 from public.anulaciones_compras_gastos ac
      where ac.compra_gasto_id=o.compra_id
    );

  select coalesce(sum(p.importe),0)
  into v_pagado
  from public.pagos_resumenes_tarjetas p
  where p.periodo_id=p_periodo_id;

  select coalesce(sum(ch.importe),0)
  into v_corte
  from public.cortes_historicos_obligaciones_tarjeta ch
  join public.obligaciones_tarjetas o on o.id=ch.obligacion_id
  where o.periodo_id=p_periodo_id
    and not exists (
      select 1 from public.anulaciones_compras_gastos ac
      where ac.compra_gasto_id=o.compra_id
    );

  -- Conservar el rechazo previo de inconsistencias entre hechos originales.
  if v_total-v_corte-v_pagado<0 then
    raise exception 'Saldo financiero inconsistente' using errcode='23514';
  end if;

  select coalesce(sum(o.importe),0)
  into v_cancelado
  from public.obligaciones_tarjetas o
  join public.cancelaciones_obligaciones_tarjeta c
    on c.obligacion_id=o.id
  where o.periodo_id=p_periodo_id;

  select * into v_fin
  from public.vw_periodos_tarjetas_financieros
  where periodo_id=p_periodo_id;

  return jsonb_build_object(
    'periodo_id',p_periodo_id,
    'total_obligaciones_hugella',v_total,
    'total_pagado',v_pagado,
    'total_corte_historico',v_corte,
    'total_cuotas_canceladas',v_cancelado,
    'devoluciones_acreditadas',
      coalesce(v_fin.devoluciones_acreditadas,0),
    'saldo_a_favor_entrante',
      coalesce(v_fin.saldo_a_favor_entrante,0),
    'saldo',coalesce(v_fin.saldo_a_pagar,0),
    'saldo_a_favor',coalesce(v_fin.saldo_a_favor,0),
    'estado',
      case
        when coalesce(v_fin.saldo_a_favor,0)>0
          then 'SALDO_A_FAVOR'
        when v_total=0 and v_pagado=0
          and coalesce(v_fin.devoluciones_acreditadas,0)=0
          then 'SIN_OBLIGACIONES'
        when coalesce(v_fin.saldo_a_pagar,0)=0 and v_cancelado=v_total and v_total>0
          then 'CANCELADA'
        when coalesce(v_fin.saldo_a_pagar,0)=0
          then 'PAGADO'
        when v_pagado+v_corte=0
          then 'PENDIENTE'
        else 'PAGO_PARCIAL'
      end
  );
end;
$rpc$;

alter function public.obtener_saldo_periodo_tarjeta_admin(uuid)
  owner to postgres;

revoke all
on function public.obtener_saldo_periodo_tarjeta_admin(uuid)
from public, anon, authenticated, service_role;

grant execute
on function public.obtener_saldo_periodo_tarjeta_admin(uuid)
to authenticated;



-- ============================================================
-- 5. REGISTRO DE PAGOS CON DEVOLUCIONES
-- ============================================================

create or replace function public.registrar_pago_resumen_tarjeta_admin(
  p_operacion_id uuid,
  p_periodo_id uuid,
  p_fecha_pago date,
  p_importe numeric,
  p_referencia text default null
)
returns jsonb language plpgsql volatile security definer
set search_path='' as $rpc$
declare
  v_req jsonb;
  v_res jsonb;
  v_pago uuid;
  v_restante numeric;
  v_aplicar numeric;
  v_saldo_neto numeric;
  o record;
begin
  v_req:=jsonb_build_object(
    'periodo_id',p_periodo_id,
    'fecha_pago',p_fecha_pago,
    'importe',p_importe,
    'referencia',nullif(btrim(p_referencia),'')
  );

  v_res:=public.iniciar_operacion_financiera_compras(
    p_operacion_id,'PAGO_RESUMEN',v_req
  );

  if v_res is not null then return v_res; end if;

  if p_periodo_id is null
     or p_fecha_pago is null
     or not isfinite(p_fecha_pago)
     or p_importe is null
     or p_importe<=0
     or p_importe>=1000000000000000000
     or p_importe<>round(p_importe,2)
  then
    raise exception 'Pago inválido' using errcode='22023';
  end if;

  perform 1
  from public.periodos_tarjetas
  where id=p_periodo_id
  for update;

  if not found then
    raise exception 'Período inexistente' using errcode='22023';
  end if;

  select coalesce(saldo_a_pagar,0)
  into v_saldo_neto
  from public.vw_periodos_tarjetas_financieros
  where periodo_id=p_periodo_id;

  if p_importe>v_saldo_neto then
    raise exception
      'Pago superior al saldo pendiente del resumen: %',
      v_saldo_neto
      using errcode='23514';
  end if;

  insert into public.pagos_resumenes_tarjetas(
    periodo_id,fecha_pago,importe,referencia,actor_id
  )
  values(
    p_periodo_id,p_fecha_pago,p_importe,
    nullif(btrim(p_referencia),''),auth.uid()
  )
  returning id into v_pago;

  v_restante:=p_importe;

  for o in
    select
      ob.id,
      ob.importe
      - coalesce((
          select ch.importe
          from public.cortes_historicos_obligaciones_tarjeta ch
          where ch.obligacion_id=ob.id
        ),0)
      - coalesce((
          select sum(a.importe)
          from public.aplicaciones_pagos_obligaciones a
          where a.obligacion_id=ob.id
        ),0) as saldo
    from public.obligaciones_tarjetas ob
    join public.financiaciones_compras f
      on f.compra_id=ob.compra_id
    where ob.periodo_id=p_periodo_id
      and f.estado='CONFIRMADA'
      and not exists (
        select 1
        from public.anulaciones_compras_gastos ac
        where ac.compra_gasto_id=ob.compra_id
      )
      and not exists (
        select 1
        from public.cancelaciones_obligaciones_tarjeta co
        where co.obligacion_id=ob.id
      )
    order by ob.numero_cuota,ob.compra_id,ob.tramo_id,ob.id
  loop

    if o.saldo<0 then
      raise exception 'Saldo de obligación inconsistente'
        using errcode='23514';
    end if;

    if o.saldo=0 then continue; end if;

    v_aplicar:=least(v_restante,o.saldo);

    insert into public.aplicaciones_pagos_obligaciones(
      pago_id,obligacion_id,importe
    )
    values(v_pago,o.id,v_aplicar);

    v_restante:=v_restante-v_aplicar;

    if v_restante=0 then exit; end if;
  end loop;

  if v_restante<>0 then
    raise exception 'Pago excede saldo distribuible'
      using errcode='23514';
  end if;

  return public.finalizar_operacion_financiera_compras(
    p_operacion_id,'PAGO_RESUMEN',v_req,
    jsonb_build_object(
      'operacion_id',p_operacion_id,
      'pago_id',v_pago,
      'importe',p_importe,
      'aplicaciones',(
        select jsonb_agg(to_jsonb(a) order by a.obligacion_id)
        from public.aplicaciones_pagos_obligaciones a
        where a.pago_id=v_pago
      )
    )
  );
end;
$rpc$;

alter function public.registrar_pago_resumen_tarjeta_admin(
  uuid,uuid,date,numeric,text
) owner to postgres;

revoke all on function
public.registrar_pago_resumen_tarjeta_admin(
  uuid,uuid,date,numeric,text
) from public,anon,authenticated,service_role;

grant execute on function
public.registrar_pago_resumen_tarjeta_admin(
  uuid,uuid,date,numeric,text
) to authenticated;

-- Sólo hechos nuevos: no modifica compras, pagos, cuotas ni cortes existentes.
create function public.operar_devolucion_compra_admin(
  p_operacion_id uuid, p_compra_id uuid, p_accion text, p_datos jsonb
) returns jsonb language plpgsql volatile security definer set search_path='' as $rpc$
declare
  v_req jsonb:=jsonb_build_object('compra_id',p_compra_id,'accion',p_accion,'datos',p_datos);
  v_res jsonb; v_accion text; v_id uuid; v_tarjeta uuid; v_tramo uuid;
  v_fecha date; v_motivo text; v_importe numeric; v_limite numeric; v_cuotas uuid[];
begin
  v_accion:=case p_accion when 'CANCELAR' then 'CANCELACION_FINANCIERA_COMPRA'
    when 'DEVOLUCION' then 'DEVOLUCION_TARJETA' when 'ACREDITAR' then 'ACREDITACION_DEVOLUCION_TARJETA' end;
  if v_accion is null then raise exception 'Acción inválida' using errcode='22023'; end if;
  -- Incluye autorización, idempotencia por actor/payload y lock global de escrituras.
  v_res:=public.iniciar_operacion_financiera_compras(p_operacion_id,v_accion,v_req);
  if v_res is not null then return v_res; end if;
  if jsonb_typeof(p_datos) is distinct from 'object' then raise exception 'Datos inválidos' using errcode='22023'; end if;
  perform 1 from public.compras_gastos where id=p_compra_id for update;
  if not found then raise exception 'Compra inexistente' using errcode='22023'; end if;
  if exists(select 1 from public.anulaciones_compras_gastos where compra_gasto_id=p_compra_id)
    or not exists(select 1 from public.financiaciones_compras where compra_id=p_compra_id and estado='CONFIRMADA') then
    raise exception 'La compra no tiene financiación operativa' using errcode='23514'; end if;
  v_fecha:=(p_datos->>'fecha')::date;
  if v_fecha is null or not isfinite(v_fecha) then raise exception 'Fecha inválida' using errcode='22023'; end if;
  if p_accion='CANCELAR' then
    if (p_datos - array['fecha','motivo','obligaciones']) <> '{}'::jsonb
      or jsonb_typeof(p_datos->'obligaciones') is distinct from 'array' then
      raise exception 'Cuotas inválidas' using errcode='22023'; end if;
    v_motivo:=btrim(p_datos->>'motivo');
    if v_motivo is null or length(v_motivo) not between 1 and 1000 then raise exception 'Motivo obligatorio' using errcode='22023'; end if;
    select coalesce(array_agg(value::uuid),'{}'::uuid[]) into v_cuotas from jsonb_array_elements_text(p_datos->'obligaciones');
    if cardinality(v_cuotas)<>(select count(distinct x) from unnest(v_cuotas) x) then raise exception 'Cuotas duplicadas' using errcode='22023'; end if;
    if exists(select 1 from unnest(v_cuotas) x where not exists (
      select 1 from public.obligaciones_tarjetas o left join public.periodos_tarjetas p on p.id=o.periodo_id
      where o.id=x and o.compra_id=p_compra_id and (o.periodo_id is null or p.fecha_cierre>v_fecha)
      and not exists(select 1 from public.aplicaciones_pagos_obligaciones a where a.obligacion_id=o.id)
      and not exists(select 1 from public.cortes_historicos_obligaciones_tarjeta c where c.obligacion_id=o.id)
    )) then raise exception 'Sólo se pueden cancelar cuotas futuras sin pagos ni cortes históricos' using errcode='23514'; end if;
    -- Evita descontar simultáneamente la misma porción como cuota y devolución.
    if exists(select 1 from public.tramos_pago_compras t where t.compra_id=p_compra_id and
      coalesce((select sum(o.importe) from public.obligaciones_tarjetas o where o.tramo_id=t.id and o.id=any(v_cuotas)),0)
      +coalesce((select sum(d.importe_esperado) from public.devoluciones_tarjetas d where d.tramo_id=t.id),0)>t.importe)
    then raise exception 'Cancelación y devoluciones superan el tramo' using errcode='23514'; end if;
    insert into public.cancelaciones_financieras_compras(compra_id,operacion_id,fecha_cancelacion,motivo,actor_id)
      values(p_compra_id,p_operacion_id,v_fecha,v_motivo,auth.uid());
    insert into public.cancelaciones_obligaciones_tarjeta(obligacion_id,compra_id,actor_id)
      select x,p_compra_id,auth.uid() from unnest(v_cuotas) x;
    v_id:=p_compra_id;
  elsif p_accion='DEVOLUCION' then
    if (p_datos-array['fecha','motivo','tramo_id','importe'])<>'{}'::jsonb then raise exception 'Datos inválidos' using errcode='22023'; end if;
    v_motivo:=btrim(p_datos->>'motivo'); v_tramo:=(p_datos->>'tramo_id')::uuid;
    v_importe:=(p_datos->>'importe')::numeric;
    select t.tarjeta_id,t.importe
      -coalesce((select sum(o.importe) from public.obligaciones_tarjetas o join public.cancelaciones_obligaciones_tarjeta c on c.obligacion_id=o.id where o.tramo_id=t.id),0)
      -coalesce((select sum(d.importe_esperado) from public.devoluciones_tarjetas d where d.tramo_id=t.id),0)
      into v_tarjeta,v_limite from public.tramos_pago_compras t
      where t.id=v_tramo and t.compra_id=p_compra_id and t.medio='TARJETA_CREDITO';
    if not found or v_importe is null or v_importe<=0 or v_importe>v_limite or v_importe<>round(v_importe,2)
      or v_motivo is null or length(v_motivo) not between 1 and 1000 then
      raise exception 'Devolución inválida o superior al importe no cancelado del tramo' using errcode='23514'; end if;
    insert into public.devoluciones_tarjetas(compra_id,tramo_id,tarjeta_id,operacion_id,importe_esperado,fecha_solicitud,motivo,actor_id)
      values(p_compra_id,v_tramo,v_tarjeta,p_operacion_id,v_importe,v_fecha,v_motivo,auth.uid()) returning id into v_id;
  else
    if (p_datos-array['fecha','devolucion_id','periodo_id','importe','referencia'])<>'{}'::jsonb then raise exception 'Datos inválidos' using errcode='22023'; end if;
    select d.tarjeta_id into v_tarjeta from public.devoluciones_tarjetas d
      where d.id=(p_datos->>'devolucion_id')::uuid and d.compra_id=p_compra_id for update;
    if not found then raise exception 'Devolución inexistente' using errcode='22023'; end if;
    if not exists(select 1 from public.periodos_tarjetas p where p.id=(p_datos->>'periodo_id')::uuid and p.tarjeta_id=v_tarjeta) then
      raise exception 'Período de otra tarjeta o inexistente' using errcode='22023'; end if;
    insert into public.acreditaciones_devoluciones_tarjetas(devolucion_id,tarjeta_id,periodo_id,operacion_id,fecha_acreditacion,importe,referencia,actor_id)
      values((p_datos->>'devolucion_id')::uuid,v_tarjeta,(p_datos->>'periodo_id')::uuid,p_operacion_id,v_fecha,
        (p_datos->>'importe')::numeric,p_datos->>'referencia',auth.uid()) returning id into v_id;
  end if;
  return public.finalizar_operacion_financiera_compras(p_operacion_id,v_accion,v_req,
    jsonb_build_object('operacion_id',p_operacion_id,'compra_id',p_compra_id,'id',v_id,'accion',p_accion));
end;
$rpc$;
alter function public.operar_devolucion_compra_admin(uuid,uuid,text,jsonb) owner to postgres;
revoke all on function public.operar_devolucion_compra_admin(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.operar_devolucion_compra_admin(uuid,uuid,text,jsonb) to authenticated;

create or replace function public.obtener_financiacion_compra_admin(p_compra_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $rpc$
declare v_total numeric; v_pagado numeric; v_estado text; v_anulacion jsonb; v_saldo_operativo numeric; v_corte numeric; v_cancelacion jsonb; v_evidencia jsonb;
begin
  if auth.uid() is null or public.es_admin_hugella() is not true then raise exception 'No autorizado' using errcode='42501'; end if;
  perform 1 from public.compras_gastos where id=p_compra_id;
  if not found then raise exception 'Compra inexistente' using errcode='22023'; end if;
  select to_jsonb(c) into v_cancelacion from public.cancelaciones_financieras_compras c where c.compra_id=p_compra_id;
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
  v_saldo_operativo:=case when v_anulacion is not null then 0 else coalesce((select sum(saldo_pendiente) from public.vw_obligaciones_tarjetas_financieras where compra_id=p_compra_id),0) end;
  return jsonb_build_object('compra_id',p_compra_id,'total_compra',v_total,'total_pagado',v_pagado,
    'total_corte_historico',v_corte,'saldo_historico',v_total-v_pagado,'saldo_operativo',v_saldo_operativo,'saldo_pendiente',v_saldo_operativo,
    'anulacion',v_anulacion,'cancelacion_financiera',v_cancelacion,'estado',case when v_anulacion is not null then 'ANULADA' when v_cancelacion is not null then 'CANCELADA' when v_saldo_operativo=0 then 'PAGADA' else 'PENDIENTE' end,'estado_financiacion',v_estado);
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
    'saldo_operativo',vf.saldo_pendiente,
    'saldo',vf.saldo_pendiente,
    'estado',case when v_res->>'estado'='ANULADA' then 'ANULADA' when co.obligacion_id is not null then 'CANCELADA' when ch.obligacion_id is not null then 'SALDADA_HISTORICAMENTE' when vf.saldo_pendiente=0 then 'PAGADA' when a.pagado=0 then 'PENDIENTE' when a.pagado=o.importe then 'PAGADA' else 'PAGO_PARCIAL' end)
    order by t.posicion,o.numero_cuota),'[]') into v_cuotas
    from public.obligaciones_tarjetas o join public.tramos_pago_compras t on t.id=o.tramo_id
    join public.vw_obligaciones_tarjetas_financieras vf on vf.id=o.id
    left join public.cancelaciones_obligaciones_tarjeta co on co.obligacion_id=o.id
    left join public.cortes_historicos_obligaciones_tarjeta ch on ch.obligacion_id=o.id
    left join public.periodos_tarjetas p on p.id=o.periodo_id
    cross join lateral (select coalesce(sum(ap.importe),0) pagado
      from public.aplicaciones_pagos_obligaciones ap where ap.obligacion_id=o.id) a
    where o.compra_id=p_compra_id;
  return v_res||jsonb_build_object('formas_pago',v_formas,'cuotas',v_cuotas,'devoluciones',coalesce((
    select jsonb_agg(to_jsonb(d)||jsonb_build_object('importe_acreditado',a.total,'importe_pendiente',d.importe_esperado-a.total,
      'estado',case when c.devolucion_id is not null then 'CANCELADA' when a.total=0 then 'PENDIENTE' when a.total=d.importe_esperado then 'ACREDITADA' else 'PARCIAL' end,
      'acreditaciones',coalesce(a.movimientos,'[]'::jsonb)) order by d.created_at,d.id)
    from public.devoluciones_tarjetas d
    left join public.cancelaciones_devoluciones_tarjetas c on c.devolucion_id=d.id
    cross join lateral (select coalesce(sum(ac.importe),0) total,jsonb_agg(to_jsonb(ac) order by ac.created_at,ac.id) movimientos
      from public.acreditaciones_devoluciones_tarjetas ac where ac.devolucion_id=d.id) a
    where d.compra_id=p_compra_id),'[]'::jsonb));
end;
$rpc$;

create or replace function public.listar_calendario_financiero_admin()
returns table(
  obligacion_id uuid,
  compra_id uuid,
  referencia_compra text,
  fecha_compra date,
  producto text,
  tarjeta text,
  numero_cuota integer,
  cantidad_cuotas integer,
  importe numeric,
  importe_cortado_historico numeric,
  importe_pagado_real numeric,
  saldo_pendiente numeric,
  periodo_orden integer,
  fecha_cierre date,
  fecha_vencimiento date,
  estado text,
  compra_anulada boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or public.es_admin_hugella() is not true then
    raise exception 'No autorizado'
      using errcode = '42501';
  end if;

  return query
  with productos as (
    select
      i.compra_gasto_id,
      string_agg(i.descripcion, ' · ' order by i.posicion) as producto
    from public.items_compras_gastos i
    group by i.compra_gasto_id
  )
  select
    v.id as obligacion_id,
    v.compra_id,
    cg.id_origen as referencia_compra,
    cg.fecha as fecha_compra,
    coalesce(p.producto, 'Sin descripción') as producto,
    v.tarjeta,
    v.numero_cuota,
    v.cantidad_cuotas,
    v.importe,
    v.importe_cortado_historico,
    v.importe_pagado_real,
    case
      when a.compra_gasto_id is not null then 0::numeric
      else v.saldo_pendiente
    end as saldo_pendiente,
    v.periodo_orden,
    v.fecha_cierre,
    v.fecha_vencimiento,
    case
      when a.compra_gasto_id is not null then 'ANULADA'
      when exists(select 1 from public.cancelaciones_obligaciones_tarjeta co where co.obligacion_id=v.id) then 'CANCELADA'
      when v.saldo_pendiente <= 0 then 'PAGADA'
      when v.periodo_id is null then 'SIN_PERIODO'
      else 'PENDIENTE'
    end as estado,
    (a.compra_gasto_id is not null) as compra_anulada
  from public.vw_obligaciones_tarjetas_financieras v
  join public.compras_gastos cg
    on cg.id = v.compra_id
  left join productos p
    on p.compra_gasto_id = cg.id
  left join public.anulaciones_compras_gastos a
    on a.compra_gasto_id = cg.id
  order by
    v.fecha_vencimiento nulls last,
    cg.fecha,
    v.tarjeta,
    v.numero_cuota,
    v.id;
end;
$$;


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
  return v_resultado||jsonb_build_object('financiacion',public.obtener_detalle_financiacion_compra_admin(p_compra_gasto_id))||jsonb_build_object('evidencia_historica',(select to_jsonb(e)-array['actor_id','operacion_id','created_at'] from public.evidencias_financiacion_historica_compras e where e.compra_id=p_compra_gasto_id))||jsonb_build_object('anulacion',(select to_jsonb(ac) from public.anulaciones_compras_gastos ac where ac.compra_gasto_id=p_compra_gasto_id));
end;
$rpc$;

-- Nueva variante aditiva; conserva la firma y consumidores de la RPC anterior.
-- Un solo cálculo financiero para la página completa; no se cachean hechos entre llamadas.
-- El recorrido incluye toda la historia anterior, aunque la página tenga offset.
create function public.listar_resumenes_tarjeta_conjunto_interno(
  p_tarjeta_id uuid,p_limite integer,p_offset integer
) returns setof jsonb language plpgsql stable security definer set search_path='' as $rpc$
declare r record;
begin
  if auth.uid() is null or public.es_admin_hugella() is not true then
    raise exception 'No autorizado' using errcode='42501';
  end if;
  if p_tarjeta_id is null or p_limite is null or p_limite not between 1 and 100 or p_offset is null or p_offset<0 then
    raise exception 'Paginación inválida' using errcode='22023';
  end if;
  if not exists(select 1 from public.tarjetas_credito where id=p_tarjeta_id) then
    raise exception 'Tarjeta inexistente' using errcode='22023';
  end if;

  for r in
    with pagina as materialized (
      select p.id,p.orden,p.fecha_cierre,p.fecha_vencimiento
      from public.periodos_tarjetas p where p.tarjeta_id=p_tarjeta_id
      order by p.orden limit p_limite offset p_offset
    ), totales as materialized (
      select o.periodo_id,
        coalesce(sum(o.importe) filter (where f.estado='CONFIRMADA' and ac.compra_gasto_id is null),0) as total,
        coalesce(sum(ch.importe) filter (where ac.compra_gasto_id is null),0) as corte,
        coalesce(sum(o.importe) filter (where co.obligacion_id is not null),0) as cancelado
      from pagina p join public.obligaciones_tarjetas o on o.periodo_id=p.id
      left join public.financiaciones_compras f on f.compra_id=o.compra_id
      left join public.anulaciones_compras_gastos ac on ac.compra_gasto_id=o.compra_id
      left join public.cortes_historicos_obligaciones_tarjeta ch on ch.obligacion_id=o.id
      left join public.cancelaciones_obligaciones_tarjeta co on co.obligacion_id=o.id
      group by o.periodo_id
    ), pagos as materialized (
      select pr.periodo_id,sum(pr.importe) as pagado
      from pagina p join public.pagos_resumenes_tarjetas pr on pr.periodo_id=p.id
      group by pr.periodo_id
    ), finanzas as materialized (
      select f.* from public.vw_periodos_tarjetas_financieros f where f.tarjeta_id=p_tarjeta_id
    )
    select p.*,coalesce(t.total,0) as total,coalesce(t.corte,0) as corte,
      coalesce(t.cancelado,0) as cancelado,coalesce(pg.pagado,0) as pagado,
      coalesce(f.devoluciones_acreditadas,0) as acreditadas,
      coalesce(f.saldo_a_favor_entrante,0) as entrante,
      coalesce(f.saldo_a_pagar,0) as saldo,coalesce(f.saldo_a_favor,0) as favor
    from pagina p left join totales t on t.periodo_id=p.id
    left join pagos pg on pg.periodo_id=p.id left join finanzas f on f.periodo_id=p.id
    order by p.orden
  loop
    -- Mismo rechazo y misma precedencia de estados que la RPC de saldo individual.
    if r.total-r.corte-r.pagado<0 then
      raise exception 'Saldo financiero inconsistente' using errcode='23514';
    end if;
    return next jsonb_build_object(
      'periodo_id',r.id,'orden',r.orden,'fecha_cierre',r.fecha_cierre,'fecha_vencimiento',r.fecha_vencimiento,
      'total_obligaciones_hugella',r.total,'total_pagado',r.pagado,
      'total_corte_historico',r.corte,'total_cuotas_canceladas',r.cancelado,
      'devoluciones_acreditadas',r.acreditadas,'saldo_a_favor_entrante',r.entrante,
      'saldo',r.saldo,'saldo_a_favor',r.favor,
      'estado',case when r.favor>0 then 'SALDO_A_FAVOR'
        when r.total=0 and r.pagado=0 and r.acreditadas=0 then 'SIN_OBLIGACIONES'
        when r.saldo=0 and r.cancelado=r.total and r.total>0 then 'CANCELADA'
        when r.saldo=0 then 'PAGADO' when r.pagado+r.corte=0 then 'PENDIENTE'
        else 'PAGO_PARCIAL' end
    );
  end loop;
end;
$rpc$;
alter function public.listar_resumenes_tarjeta_conjunto_interno(uuid,integer,integer) owner to postgres;
revoke all on function public.listar_resumenes_tarjeta_conjunto_interno(uuid,integer,integer) from public,anon,authenticated,service_role;

-- Firma, columnas, autorización y paginación compatibles con los consumidores anteriores.
create or replace function public.listar_resumenes_tarjeta_admin(p_tarjeta_id uuid,p_limite integer default 50,p_offset integer default 0)
returns table(periodo_id uuid,orden integer,fecha_cierre date,fecha_vencimiento date,
  total_obligaciones_hugella numeric,total_pagado numeric,saldo numeric,estado text)
language plpgsql stable security definer set search_path='' as $rpc$
begin
  return query select (j->>'periodo_id')::uuid,(j->>'orden')::integer,
    (j->>'fecha_cierre')::date,(j->>'fecha_vencimiento')::date,
    (j->>'total_obligaciones_hugella')::numeric,(j->>'total_pagado')::numeric,
    (j->>'saldo')::numeric,j->>'estado'
  from public.listar_resumenes_tarjeta_conjunto_interno(p_tarjeta_id,p_limite,p_offset) j
  order by (j->>'orden')::integer;
end;
$rpc$;

create function public.listar_resumenes_tarjeta_financieros_admin(p_tarjeta_id uuid,p_limite integer default 50,p_offset integer default 0)
returns setof jsonb language plpgsql stable security definer set search_path='' as $rpc$
begin
  return query select j from public.listar_resumenes_tarjeta_conjunto_interno(p_tarjeta_id,p_limite,p_offset) j
    order by (j->>'orden')::integer;
end;
$rpc$;
alter function public.listar_resumenes_tarjeta_financieros_admin(uuid,integer,integer) owner to postgres;
revoke all on function public.listar_resumenes_tarjeta_financieros_admin(uuid,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.listar_resumenes_tarjeta_financieros_admin(uuid,integer,integer) to authenticated;

-- La anulación técnica no puede borrar el efecto de una devolución ya registrada.
create function public.proteger_anulacion_con_devolucion() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.cancelaciones_financieras_compras where compra_id=new.compra_gasto_id)
    or exists(select 1 from public.devoluciones_tarjetas where compra_id=new.compra_gasto_id) then
    raise exception 'La compra tiene cancelaciones o devoluciones financieras; conserve su historial' using errcode='23514';
  end if;
  return new;
end;
$$;
alter function public.proteger_anulacion_con_devolucion() owner to postgres;
revoke all on function public.proteger_anulacion_con_devolucion() from public,anon,authenticated,service_role;
create trigger proteger_anulacion_con_devolucion before insert on public.anulaciones_compras_gastos
for each row execute function public.proteger_anulacion_con_devolucion();

commit;
