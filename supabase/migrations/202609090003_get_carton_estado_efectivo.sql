-- LOCAL REVIEW ONLY. Same signature, JSON fields, SECURITY DEFINER and search_path.
-- CREATE OR REPLACE preserves current ownership and grants; no RLS/grant changes.
create or replace function public.get_carton_publico(p_token uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
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
      public.hugella_cuotas_exigibles(cr.fecha_inicio, cr.cantidad_cuotas)
    ),
    'cuotas_pagadas', paid.cuotas_pagadas,
    'cuotas_pendientes', greatest(cr.cantidad_cuotas - paid.cuotas_pagadas, 0),
    'pagos', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'fecha_pago', pg.fecha_pago,
          'medio_pago', pg.medio_pago,
          'importe', pg.importe,
          'cuotas_aplicadas', greatest(coalesce(pg.cuotas_aplicadas, 0), 0)
        )
        order by pg.fecha_pago desc, pg.created_at desc
      )
      from public.pagos as pg
      where pg.credito_id = cr.id
    ), '[]'::jsonb)
  )
  from public.creditos as cr
  inner join public.clientes as cl on cl.id = cr.cliente_id
  cross join lateral (
    -- Preserve the existing monetary allocation: SUM cuotas_aplicadas, not COUNT.
    -- Do not add remanente again or derive installments from payment row count.
    select least(cr.cantidad_cuotas, coalesce(
      sum(greatest(coalesce(pg.cuotas_aplicadas, 0), 0))::integer, 0
    )) as cuotas_pagadas
    from public.pagos as pg where pg.credito_id = cr.id
  ) as paid
  where cr.access_token = p_token
  limit 1;
$$;
