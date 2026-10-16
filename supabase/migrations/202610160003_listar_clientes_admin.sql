begin;

create or replace function public.listar_clientes_admin()
returns table(
  id uuid,
  nombre text,
  dni text,
  telefono text,
  domicilio text,
  ubicacion text,
  cantidad_creditos bigint
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
      cl.id,
      cl.nombre,
      cl.dni,
      cl.telefono,
      cl.domicilio,
      cl.ubicacion,
      count(cr.id)::bigint as cantidad_creditos
    from public.clientes cl
    left join public.creditos cr
      on cr.cliente_id = cl.id
    group by
      cl.id,
      cl.nombre,
      cl.dni,
      cl.telefono,
      cl.domicilio,
      cl.ubicacion
    order by
      cl.nombre nulls last,
      cl.dni nulls last;
end;
$$;

revoke all
on function public.listar_clientes_admin()
from public, anon;

grant execute
on function public.listar_clientes_admin()
to authenticated, service_role;

commit;
