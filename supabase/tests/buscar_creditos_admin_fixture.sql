-- LOCAL TEST FIXTURE ONLY, reconstructed from the user-supplied contract.
-- Not a production migration or a claim to reproduce unknown source bytes.
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('test.uid', true), '')::uuid;
$$;
create function public.es_admin_hugella() returns boolean language sql stable as $$
  select coalesce(current_setting('test.admin', true), '') = 'yes';
$$;
create table public.clientes(id uuid primary key, nombre text);
create table public.creditos(id uuid primary key, cliente_id uuid, codigo text,
  producto text, importe_cuota numeric, cantidad_cuotas integer, estado text, fecha_inicio date);
create table public.pagos(id text primary key, credito_id uuid, cuotas_aplicadas integer);

create function public.buscar_creditos_admin(p_busqueda text)
returns table(credito_id uuid, nombre_cliente text, codigo_credito text, producto text,
  importe_cuota numeric, cantidad_cuotas integer, cuotas_pagadas integer,
  cuotas_pendientes integer, estado text)
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if not public.es_admin_hugella() then raise exception 'Admin required' using errcode='42501'; end if;
  if nullif(btrim(p_busqueda), '') is null then raise exception 'Empty search'; end if;
  return query
  select cr.id, cl.nombre::text, cr.codigo::text, cr.producto::text,
    cr.importe_cuota, cr.cantidad_cuotas,
    least(cr.cantidad_cuotas, coalesce(sum(greatest(coalesce(pg.cuotas_aplicadas,0),0))::integer,0)),
    greatest(cr.cantidad_cuotas - least(cr.cantidad_cuotas,
      coalesce(sum(greatest(coalesce(pg.cuotas_aplicadas,0),0))::integer,0)),0),
    cr.estado::text
  from public.creditos cr
  join public.clientes cl on cl.id=cr.cliente_id
  left join public.pagos pg on pg.credito_id=cr.id
  where cr.codigo ilike '%' || btrim(p_busqueda) || '%'
     or cl.nombre ilike '%' || btrim(p_busqueda) || '%'
  group by cr.id, cl.nombre, cr.codigo, cr.producto, cr.importe_cuota, cr.cantidad_cuotas, cr.estado
  order by (cr.codigo=btrim(p_busqueda)) desc, cl.nombre, cr.codigo
  limit 20;
end;
$$;
revoke all on function public.buscar_creditos_admin(text) from public, anon;
grant execute on function public.buscar_creditos_admin(text) to authenticated;
