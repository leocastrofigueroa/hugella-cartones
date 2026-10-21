create or replace function public.get_carton_publico(p_token uuid)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  select jsonb_build_object(
    'nombre_cliente', cl.nombre,
    'codigo_credito', cr.codigo,
    'producto', cr.producto,
    'fecha_inicio', cr.fecha_inicio,
    'cantidad_cuotas', cr.cantidad_cuotas,
    'importe_cuota', cr.importe_cuota,

    'estado', public.hugella_estado_credito(
      cr.cantidad_cuotas,
      paid.cuotas_pagadas,
      situacion.cuotas_exigibles
    ),

    'cuotas_pagadas', paid.cuotas_pagadas,

    'cuotas_pendientes',
      greatest(
        cr.cantidad_cuotas - paid.cuotas_pagadas,
        0
      ),

    'cuotas_exigibles',
      situacion.cuotas_exigibles,

    'diferencia_cuotas',
      paid.cuotas_pagadas - situacion.cuotas_exigibles,

    'cuotas_atrasadas',
      greatest(
        situacion.cuotas_exigibles - paid.cuotas_pagadas,
        0
      ),

    'cuotas_adelantadas',
      greatest(
        paid.cuotas_pagadas - situacion.cuotas_exigibles,
        0
      ),

    'pagos', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'fecha_pago', pg.fecha_pago,
          'medio_pago', pg.medio_pago,
          'importe', pg.importe,
          'cuotas_aplicadas',
            greatest(
              coalesce(pg.cuotas_aplicadas, 0),
              0
            )
        )
        order by
          pg.fecha_pago desc,
          pg.created_at desc
      )
      from public.pagos as pg
      where pg.credito_id = cr.id
        and pg.estado = 'VALIDO'
    ), '[]'::jsonb)
  )

  from (
    select base.*
    from public.creditos base
    where not exists (
      select 1
      from public.cierres_creditos cierre
      where cierre.credito_id = base.id
    )
  ) cr

  inner join public.clientes as cl
    on cl.id = cr.cliente_id

  cross join lateral (
    select least(
      cr.cantidad_cuotas,
      coalesce(
        sum(
          greatest(
            coalesce(pg.cuotas_aplicadas, 0),
            0
          )
        )::integer,
        0
      )
    ) as cuotas_pagadas
    from public.pagos as pg
    where pg.credito_id = cr.id
      and pg.estado = 'VALIDO'
  ) as paid

  cross join lateral (
    select public.hugella_cuotas_exigibles(
      cr.fecha_inicio,
      cr.cantidad_cuotas
    ) as cuotas_exigibles
  ) as situacion

  where cr.access_token = p_token

  limit 1;
$function$;
