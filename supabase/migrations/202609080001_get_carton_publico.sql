-- Public, read-only access to a single virtual payment card by opaque token.
-- This migration intentionally creates no public SELECT policies.

alter table public.clientes enable row level security;
alter table public.creditos enable row level security;
alter table public.pagos enable row level security;

-- The token identifies exactly one credit. NULL values remain allowed.
create unique index if not exists creditos_access_token_unique
  on public.creditos (access_token)
  where access_token is not null;

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
    'estado', cr.estado,
    'cuotas_pagadas', least(
      cr.cantidad_cuotas,
      coalesce((
        select sum(greatest(coalesce(pg.cuotas_aplicadas, 0), 0))::integer
        from public.pagos as pg
        where pg.credito_id = cr.id
      ), 0)
    ),
    'cuotas_pendientes', greatest(
      cr.cantidad_cuotas - least(
        cr.cantidad_cuotas,
        coalesce((
          select sum(greatest(coalesce(pg.cuotas_aplicadas, 0), 0))::integer
          from public.pagos as pg
          where pg.credito_id = cr.id
        ), 0)
      ),
      0
    ),
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
  where cr.access_token = p_token
  limit 1;
$$;

-- Functions are executable by PUBLIC by default, so close that default first.
revoke all on function public.get_carton_publico(uuid) from public;
revoke all on function public.get_carton_publico(uuid) from authenticated;
revoke all on function public.get_carton_publico(uuid) from anon;
grant execute on function public.get_carton_publico(uuid) to anon;

-- Anonymous users must not access the underlying tables directly.
revoke all on table public.clientes from anon;
revoke all on table public.creditos from anon;
revoke all on table public.pagos from anon;
