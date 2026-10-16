begin;

create or replace function public.obtener_cartones_cliente_admin(
  p_cliente_id uuid
)
returns table(
  credito_id uuid,
  codigo text,
  producto text,
  estado text,
  access_token uuid
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

  if p_cliente_id is null then
    raise exception 'Cliente obligatorio'
      using errcode = '22023';
  end if;

  return query
    select
      cr.id,
      cr.codigo,
      cr.producto,
      cr.estado,
      cr.access_token
    from public.creditos cr
    where cr.cliente_id = p_cliente_id
    order by cr.codigo;
end;
$$;

revoke all
on function public.obtener_cartones_cliente_admin(uuid)
from public, anon;

grant execute
on function public.obtener_cartones_cliente_admin(uuid)
to authenticated, service_role;

commit;
