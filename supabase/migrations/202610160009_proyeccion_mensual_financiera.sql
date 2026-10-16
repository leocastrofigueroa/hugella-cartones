begin;

create or replace function public.obtener_proyeccion_mensual_financiera_admin()
returns table(
  mes date,
  tipo_mes text,
  cobrado_real numeric,
  cobranza_proyectada numeric,
  tarjetas_pagadas_reconocidas numeric,
  tarjetas_a_pagar numeric,
  diferencia numeric
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
  with
  cobranzas_reales as (
    select
      date_trunc('month', pg.fecha_pago::timestamp)::date as mes,
      round(sum(pg.importe), 2) as importe
    from public.pagos pg
    join public.creditos cr
      on cr.id = pg.credito_id
    where pg.estado = 'VALIDO'
      and cr.codigo <> 'CR-0048'
    group by 1
  ),

  cobranza_futura as (
    select
      p.mes,
      round(sum(p.recaudacion_programada), 2) as importe
    from public.vw_proyeccion_cobranza_mensual p
    group by p.mes
  ),

  tarjetas_historicas as (
    select
      date_trunc(
        'month',
        p.fecha_vencimiento::timestamp
      )::date as mes,
      round(sum(ch.importe), 2) as importe
    from public.cortes_historicos_obligaciones_tarjeta ch
    join public.obligaciones_tarjetas o
      on o.id = ch.obligacion_id
    join public.periodos_tarjetas p
      on p.id = o.periodo_id
    group by 1
  ),

  tarjetas_pagadas_reales as (
    select
      date_trunc('month', pr.fecha_pago::timestamp)::date as mes,
      round(sum(pr.importe), 2) as importe
    from public.pagos_resumenes_tarjetas pr
    group by 1
  ),

  tarjetas_pagadas as (
    select
      x.mes,
      round(sum(x.importe), 2) as importe
    from (
      select th.mes, th.importe
      from tarjetas_historicas th

      union all

      select tpr.mes, tpr.importe
      from tarjetas_pagadas_reales tpr
    ) x
    group by x.mes
  ),

  tarjetas_pendientes as (
    select
      date_trunc(
        'month',
        v.fecha_vencimiento::timestamp
      )::date as mes,
      round(sum(v.saldo_pendiente), 2) as importe
    from public.vw_obligaciones_tarjetas_financieras v
    where v.saldo_pendiente > 0
      and v.fecha_vencimiento is not null
      and not exists (
        select 1
        from public.anulaciones_compras_gastos a
        where a.compra_gasto_id = v.compra_id
      )
    group by 1
  ),

  meses as (
    select cr.mes from cobranzas_reales cr
    union
    select cf.mes from cobranza_futura cf
    union
    select tp.mes from tarjetas_pagadas tp
    union
    select tpend.mes from tarjetas_pendientes tpend
  )

  select
    m.mes,

    case
      when m.mes <
        date_trunc(
          'month',
          (now() at time zone 'America/Argentina/Buenos_Aires')
        )::date
        then 'HISTORICO'

      when m.mes =
        date_trunc(
          'month',
          (now() at time zone 'America/Argentina/Buenos_Aires')
        )::date
        then 'ACTUAL'

      else 'FUTURO'
    end as tipo_mes,

    coalesce(cr.importe, 0::numeric) as cobrado_real,

    coalesce(cf.importe, 0::numeric) as cobranza_proyectada,

    coalesce(tp.importe, 0::numeric) as tarjetas_pagadas_reconocidas,

    coalesce(tpend.importe, 0::numeric) as tarjetas_a_pagar,

    round(
      coalesce(cr.importe, 0::numeric)
      + coalesce(cf.importe, 0::numeric)
      - coalesce(tp.importe, 0::numeric)
      - coalesce(tpend.importe, 0::numeric),
      2
    ) as diferencia

  from meses m

  left join cobranzas_reales cr
    on cr.mes = m.mes

  left join cobranza_futura cf
    on cf.mes = m.mes

  left join tarjetas_pagadas tp
    on tp.mes = m.mes

  left join tarjetas_pendientes tpend
    on tpend.mes = m.mes

  order by m.mes;
end;
$$;

revoke all
on function public.obtener_proyeccion_mensual_financiera_admin()
from public, anon;

grant execute
on function public.obtener_proyeccion_mensual_financiera_admin()
to authenticated, service_role;

commit;
