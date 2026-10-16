begin;

create or replace function public.listar_cobros_admin()
returns table(
  pago_id uuid,
  fecha_pago date,
  cliente text,
  codigo_credito text,
  producto text,
  importe numeric,
  medio_pago text,
  estado text,
  origen text,
  observaciones text,
  motivo_anulacion text,
  created_at timestamptz
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
    select
      pg.id,
      pg.fecha_pago,
      cl.nombre,
      cr.codigo,
      cr.producto,
      pg.importe,
      pg.medio_pago,
      pg.estado,
      pg.origen,
      pg.observaciones,
      pg.motivo_anulacion,
      pg.created_at
    from public.pagos pg
    join public.creditos cr
      on cr.id = pg.credito_id
    join public.clientes cl
      on cl.id = cr.cliente_id
    order by
      pg.fecha_pago desc,
      pg.created_at desc;
end;
$$;

revoke all
on function public.listar_cobros_admin()
from public, anon;

grant execute
on function public.listar_cobros_admin()
to authenticated, service_role;

commit;
