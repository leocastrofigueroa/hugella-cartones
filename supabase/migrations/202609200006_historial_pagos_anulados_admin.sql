begin;

drop function public.obtener_historial_pagos_admin(uuid);

create function public.obtener_historial_pagos_admin(p_credito_id uuid)
returns table(
  pago_id uuid,
  fecha_pago date,
  importe numeric,
  medio_pago text,
  cuotas_aplicadas integer,
  remanente numeric,
  observaciones text,
  origen text,
  created_at timestamptz,
  estado text,
  motivo_anulacion text,
  anulado_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not public.es_admin_hugella() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if p_credito_id is null then
    raise exception 'Credit id is required' using errcode = '42501';
  end if;
  return query
    select pg.id, pg.fecha_pago, pg.importe, pg.medio_pago,
      pg.cuotas_aplicadas, pg.remanente, pg.observaciones, pg.origen,
      pg.created_at, pg.estado, pg.motivo_anulacion, pg.anulado_at
    from public.pagos as pg
    where pg.credito_id = p_credito_id
    order by pg.fecha_pago desc, pg.created_at desc;
end;
$$;

revoke all on function public.obtener_historial_pagos_admin(uuid)
  from public, anon;
grant execute on function public.obtener_historial_pagos_admin(uuid)
  to authenticated;

commit;
