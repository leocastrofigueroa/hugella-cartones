begin;

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

    'cobranzas_historicas',
    jsonb_build_object(

      'total',
      coalesce(
        (
          select sum(pg.importe)
          from public.pagos pg
          join public.creditos cr
            on cr.id = pg.credito_id
          where pg.estado = 'VALIDO'
            and cr.codigo <> 'CR-0048'
        ),
        0
      ),

      'activos',
      coalesce(
        (
          select sum(pg.importe)
          from public.pagos pg
          join public.creditos cr
            on cr.id = pg.credito_id
          where pg.estado = 'VALIDO'
            and cr.codigo <> 'CR-0048'
            and not exists (
              select 1
              from public.cierres_creditos cc
              where cc.credito_id = cr.id
                and cc.tipo = 'DEVUELTO'
            )
        ),
        0
      ),

      'devueltos',
      coalesce(
        (
          select sum(pg.importe)
          from public.pagos pg
          join public.creditos cr
            on cr.id = pg.credito_id
          where pg.estado = 'VALIDO'
            and cr.codigo <> 'CR-0048'
            and exists (
              select 1
              from public.cierres_creditos cc
              where cc.credito_id = cr.id
                and cc.tipo = 'DEVUELTO'
            )
        ),
        0
      ),

      'por_mes',
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'mes', mensual.mes,
              'cantidad_pagos', mensual.cantidad_pagos,
              'importe', mensual.importe
            )
            order by mensual.mes
          )
          from (
            select
              date_trunc(
                'month',
                pg.fecha_pago::timestamp
              )::date as mes,
              count(*)::integer as cantidad_pagos,
              round(sum(pg.importe), 2) as importe
            from public.pagos pg
            join public.creditos cr
              on cr.id = pg.credito_id
            where pg.estado = 'VALIDO'
              and cr.codigo <> 'CR-0048'
            group by
              date_trunc(
                'month',
                pg.fecha_pago::timestamp
              )::date
          ) mensual
        ),
        '[]'::jsonb
      )
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
