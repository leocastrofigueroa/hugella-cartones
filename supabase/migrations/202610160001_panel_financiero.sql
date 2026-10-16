begin;

create or replace view public.vw_creditos_financieros as
with pagos_validos as (
  select
    pagos.credito_id,
    coalesce(sum(pagos.importe), 0::numeric) as total_pagado
  from public.pagos
  where pagos.estado = 'VALIDO'::text
  group by pagos.credito_id
),
cierres as (
  select
    cierres_creditos.credito_id,
    bool_or(cierres_creditos.tipo = 'DEVUELTO'::text) as devuelto,
    max(cierres_creditos.fecha)
      filter (where cierres_creditos.tipo = 'DEVUELTO'::text) as fecha_devolucion
  from public.cierres_creditos
  group by cierres_creditos.credito_id
),
base as (
  select
    cr.id,
    cr.codigo,
    cr.cliente_id,
    cl.nombre as cliente,
    cr.producto,
    cr.fecha_inicio,
    cr.cantidad_cuotas,
    cr.importe_cuota,
    cr.inversion,
    cr.cantidad_cuotas::numeric * cr.importe_cuota as total_credito,
    coalesce(pv.total_pagado, 0::numeric) as total_pagado,
    coalesce(c.devuelto, false) as devuelto,
    c.fecha_devolucion
  from public.creditos cr
  join public.clientes cl
    on cl.id = cr.cliente_id
  left join pagos_validos pv
    on pv.credito_id = cr.id
  left join cierres c
    on c.credito_id = cr.id
),
calculo as (
  select
    b.id,
    b.codigo,
    b.cliente_id,
    b.cliente,
    b.producto,
    b.fecha_inicio,
    b.cantidad_cuotas,
    b.importe_cuota,
    b.inversion,
    b.total_credito,
    b.total_pagado,
    b.devuelto,
    b.fecha_devolucion,
    least(
      b.cantidad_cuotas,
      floor(b.total_pagado / b.importe_cuota)::integer
    ) as cuotas_cubiertas,
    round(
      b.total_pagado
      - floor(b.total_pagado / b.importe_cuota) * b.importe_cuota,
      2
    ) as saldo_parcial,
    least(
      b.cantidad_cuotas::bigint,
      (
        select count(*)
        from generate_series(
          b.fecha_inicio::timestamp with time zone,
          (now() at time zone 'America/Argentina/Buenos_Aires')::date::timestamp with time zone,
          '1 day'::interval
        ) d(fecha)
        where extract(isodow from d.fecha) <> 7::numeric
      )
    )::integer as cuotas_que_deberia_llevar
  from base b
)
select
  id,
  codigo,
  cliente_id,
  cliente,
  producto,
  fecha_inicio,
  cantidad_cuotas,
  importe_cuota,
  inversion,
  total_credito,
  total_pagado,
  greatest(total_credito - total_pagado, 0::numeric) as saldo_pendiente,
  cuotas_cubiertas,
  saldo_parcial,
  cuotas_que_deberia_llevar,
  greatest(
    cuotas_que_deberia_llevar::numeric * importe_cuota - total_pagado,
    0::numeric
  ) as importe_atrasado,
  case
    when devuelto then 'DEVUELTO'::text
    when total_pagado > cuotas_que_deberia_llevar::numeric * importe_cuota
      then 'ADELANTADO'::text
    when total_pagado = cuotas_que_deberia_llevar::numeric * importe_cuota
      then 'AL DIA'::text
    else 'ATRASADO'::text
  end as estado_financiero,
  devuelto,
  fecha_devolucion,
  case
    when inversion is not null then total_credito - inversion
    else null::numeric
  end as ganancia_bruta_proyectada
from calculo;


create or replace view public.vw_obligaciones_tarjetas_financieras as
with cortes as (
  select
    cortes_historicos_obligaciones_tarjeta.obligacion_id,
    coalesce(
      sum(cortes_historicos_obligaciones_tarjeta.importe),
      0::numeric
    ) as importe_cortado
  from public.cortes_historicos_obligaciones_tarjeta
  group by cortes_historicos_obligaciones_tarjeta.obligacion_id
),
aplicaciones as (
  select
    aplicaciones_pagos_obligaciones.obligacion_id,
    coalesce(
      sum(aplicaciones_pagos_obligaciones.importe),
      0::numeric
    ) as importe_pagado
  from public.aplicaciones_pagos_obligaciones
  group by aplicaciones_pagos_obligaciones.obligacion_id
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
  coalesce(c.importe_cortado, 0::numeric) as importe_cortado_historico,
  coalesce(a.importe_pagado, 0::numeric) as importe_pagado_real,
  greatest(
    ot.importe
    - coalesce(c.importe_cortado, 0::numeric)
    - coalesce(a.importe_pagado, 0::numeric),
    0::numeric
  ) as saldo_pendiente,
  ot.periodo_id,
  pt.orden as periodo_orden,
  pt.fecha_cierre,
  pt.fecha_vencimiento,
  case
    when ot.periodo_id is null then 'SIN_PERIODO'::text
    else 'CON_VENCIMIENTO'::text
  end as estado_periodo
from public.obligaciones_tarjetas ot
join public.tarjetas_credito tc
  on tc.id = ot.tarjeta_id
left join public.periodos_tarjetas pt
  on pt.id = ot.periodo_id
left join cortes c
  on c.obligacion_id = ot.id
left join aplicaciones a
  on a.obligacion_id = ot.id;


create or replace view public.vw_proyeccion_cobranza_diaria as
with pagos_validos as (
  select
    pagos.credito_id,
    coalesce(sum(pagos.importe), 0::numeric) as total_pagado
  from public.pagos
  where pagos.estado = 'VALIDO'::text
  group by pagos.credito_id
),
base as (
  select
    cr.id,
    cr.codigo,
    cr.fecha_inicio,
    cr.cantidad_cuotas,
    cr.importe_cuota,
    coalesce(pv.total_pagado, 0::numeric) as total_pagado
  from public.creditos cr
  left join pagos_validos pv
    on pv.credito_id = cr.id
  where cr.codigo <> 'CR-0048'::text
    and not exists (
      select 1
      from public.cierres_creditos cc
      where cc.credito_id = cr.id
        and cc.tipo = 'DEVUELTO'::text
    )
),
calendario as (
  select
    b.id,
    b.codigo,
    b.fecha_inicio,
    b.cantidad_cuotas,
    b.importe_cuota,
    b.total_pagado,
    d.fecha::date as fecha_cuota,
    row_number() over (
      partition by b.id
      order by d.fecha
    )::integer as numero_cuota
  from base b
  cross join lateral generate_series(
    b.fecha_inicio::timestamp without time zone,
    b.fecha_inicio
      + (b.cantidad_cuotas * 2)::double precision * '1 day'::interval,
    '1 day'::interval
  ) d(fecha)
  where extract(isodow from d.fecha) <> 7::numeric
),
cuotas as (
  select
    calendario.id,
    calendario.codigo,
    calendario.fecha_cuota,
    calendario.numero_cuota,
    greatest(
      least(
        calendario.importe_cuota,
        calendario.numero_cuota::numeric * calendario.importe_cuota
          - calendario.total_pagado
      ),
      0::numeric
    ) as importe_pendiente
  from calendario
  where calendario.numero_cuota <= calendario.cantidad_cuotas
)
select
  fecha_cuota as fecha,
  count(*) filter (
    where importe_pendiente > 0::numeric
  )::integer as cuotas_con_saldo,
  count(distinct id) filter (
    where importe_pendiente > 0::numeric
  )::integer as creditos_con_cobranza,
  round(
    sum(importe_pendiente) filter (
      where importe_pendiente > 0::numeric
    ),
    2
  ) as cobranza_programada
from cuotas
where fecha_cuota >
  (now() at time zone 'America/Argentina/Buenos_Aires')::date
group by fecha_cuota
having coalesce(
  sum(importe_pendiente) filter (
    where importe_pendiente > 0::numeric
  ),
  0::numeric
) > 0::numeric
order by fecha_cuota;


create or replace view public.vw_proyeccion_cobranza_mensual as
with pagos_validos as (
  select
    pagos.credito_id,
    coalesce(sum(pagos.importe), 0::numeric) as total_pagado
  from public.pagos
  where pagos.estado = 'VALIDO'::text
  group by pagos.credito_id
),
base as (
  select
    cr.id,
    cr.codigo,
    cr.fecha_inicio,
    cr.cantidad_cuotas,
    cr.importe_cuota,
    coalesce(pv.total_pagado, 0::numeric) as total_pagado
  from public.creditos cr
  left join pagos_validos pv
    on pv.credito_id = cr.id
  where cr.codigo <> 'CR-0048'::text
    and not exists (
      select 1
      from public.cierres_creditos cc
      where cc.credito_id = cr.id
        and cc.tipo = 'DEVUELTO'::text
    )
),
calendario as (
  select
    b.id,
    b.codigo,
    b.fecha_inicio,
    b.cantidad_cuotas,
    b.importe_cuota,
    b.total_pagado,
    d.fecha::date as fecha_cuota,
    row_number() over (
      partition by b.id
      order by d.fecha
    )::integer as numero_cuota
  from base b
  cross join lateral generate_series(
    b.fecha_inicio::timestamp without time zone,
    b.fecha_inicio + '500 days'::interval,
    '1 day'::interval
  ) d(fecha)
  where extract(isodow from d.fecha) <> 7::numeric
),
cuotas as (
  select
    calendario.id,
    calendario.codigo,
    calendario.fecha_cuota,
    calendario.numero_cuota,
    calendario.cantidad_cuotas,
    calendario.importe_cuota,
    calendario.total_pagado,
    greatest(
      least(
        calendario.importe_cuota,
        calendario.numero_cuota::numeric * calendario.importe_cuota
          - calendario.total_pagado
      ),
      0::numeric
    ) as importe_pendiente_cuota
  from calendario
  where calendario.numero_cuota <= calendario.cantidad_cuotas
),
futuro as (
  select
    cuotas.id,
    cuotas.codigo,
    cuotas.fecha_cuota,
    cuotas.numero_cuota,
    cuotas.cantidad_cuotas,
    cuotas.importe_cuota,
    cuotas.total_pagado,
    cuotas.importe_pendiente_cuota
  from cuotas
  where cuotas.fecha_cuota >
      (now() at time zone 'America/Argentina/Buenos_Aires')::date
    and cuotas.importe_pendiente_cuota > 0::numeric
)
select
  date_trunc(
    'month'::text,
    fecha_cuota::timestamp with time zone
  )::date as mes,
  count(*)::integer as cuotas_con_saldo,
  count(distinct id)::integer as creditos_con_cobranza,
  round(sum(importe_pendiente_cuota), 2) as recaudacion_programada
from futuro
group by date_trunc(
  'month'::text,
  fecha_cuota::timestamp with time zone
)
order by date_trunc(
  'month'::text,
  fecha_cuota::timestamp with time zone
)::date;


revoke all on public.vw_creditos_financieros
from public, anon, authenticated;

revoke all on public.vw_obligaciones_tarjetas_financieras
from public, anon, authenticated;

revoke all on public.vw_proyeccion_cobranza_diaria
from public, anon, authenticated;

revoke all on public.vw_proyeccion_cobranza_mensual
from public, anon, authenticated;


create or replace function public.obtener_panel_financiero_admin()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_resultado jsonb;
begin
  if v_actor is null or public.es_admin_hugella() is not true then
    raise exception 'No autorizado'
      using errcode = '42501';
  end if;

  select jsonb_build_object(

    'creditos',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'codigo', v.codigo,
            'cliente', v.cliente,
            'inversion', v.inversion,
            'total_credito', v.total_credito,
            'total_pagado', v.total_pagado,
            'saldo_pendiente', v.saldo_pendiente,
            'importe_atrasado', v.importe_atrasado,
            'estado_financiero', v.estado_financiero,
            'devuelto', v.devuelto,
            'ganancia_bruta_proyectada', v.ganancia_bruta_proyectada
          )
          order by v.codigo
        )
        from public.vw_creditos_financieros v
      ),
      '[]'::jsonb
    ),

    'proyeccion',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'mes', v.mes,
            'creditos_con_cobranza', v.creditos_con_cobranza,
            'recaudacion_programada', v.recaudacion_programada
          )
          order by v.mes
        )
        from public.vw_proyeccion_cobranza_mensual v
      ),
      '[]'::jsonb
    ),

    'tarjetas',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'tarjeta', v.tarjeta,
            'saldo_pendiente', v.saldo_pendiente,
            'fecha_vencimiento', v.fecha_vencimiento,
            'estado_periodo', v.estado_periodo
          )
          order by
            v.fecha_vencimiento nulls last,
            v.tarjeta,
            v.numero_cuota
        )
        from public.vw_obligaciones_tarjetas_financieras v
        where v.saldo_pendiente > 0
      ),
      '[]'::jsonb
    )

  )
  into v_resultado;

  return v_resultado;
end;
$$;

revoke all
on function public.obtener_panel_financiero_admin()
from public, anon;

grant execute
on function public.obtener_panel_financiero_admin()
to authenticated, service_role;

commit;
