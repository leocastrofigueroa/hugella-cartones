begin;

create or replace function public.obtener_cliente_admin(
  p_cliente_id uuid
)
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

  if p_cliente_id is null then
    raise exception 'Cliente obligatorio'
      using errcode = '22023';
  end if;

  return query
    select
      cl.id,
      cl.nombre,
      cl.dni,
      cl.telefono,
      cl.domicilio,
      cl.ubicacion,
      count(cr.id)::bigint
    from public.clientes cl
    left join public.creditos cr
      on cr.cliente_id = cl.id
    where cl.id = p_cliente_id
    group by
      cl.id,
      cl.nombre,
      cl.dni,
      cl.telefono,
      cl.domicilio,
      cl.ubicacion;
end;
$$;

revoke all
on function public.obtener_cliente_admin(uuid)
from public, anon, authenticated, service_role;

grant execute
on function public.obtener_cliente_admin(uuid)
to authenticated, service_role;


create or replace function public.actualizar_cliente_admin(
  p_cliente_id uuid,
  p_nombre text,
  p_dni text,
  p_telefono text,
  p_domicilio text,
  p_ubicacion text
)
returns table(
  id uuid,
  nombre text,
  dni text,
  telefono text,
  domicilio text,
  ubicacion text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_nombre text := nullif(btrim(p_nombre), '');
  v_dni text := nullif(
    regexp_replace(coalesce(p_dni, ''), '[^0-9]', '', 'g'),
    ''
  );
  v_telefono text := nullif(btrim(p_telefono), '');
  v_domicilio text := nullif(btrim(p_domicilio), '');
  v_ubicacion text := nullif(btrim(p_ubicacion), '');
begin
  if auth.uid() is null or public.es_admin_hugella() is not true then
    raise exception 'No autorizado'
      using errcode = '42501';
  end if;

  if p_cliente_id is null then
    raise exception 'Cliente obligatorio'
      using errcode = '22023';
  end if;

  if v_nombre is null then
    raise exception 'El nombre del cliente es obligatorio'
      using errcode = '22023';
  end if;

  if v_dni is null or length(v_dni) not between 7 and 9 then
    raise exception 'El DNI debe contener entre 7 y 9 dígitos'
      using errcode = '22023';
  end if;

  if v_ubicacion is not null and length(v_ubicacion) > 2000 then
    raise exception 'La ubicación no puede superar los 2000 caracteres'
      using errcode = '22023';
  end if;

  perform 1
  from public.clientes cl
  where cl.id = p_cliente_id
  for update;

  if not found then
    raise exception 'Cliente inexistente'
      using errcode = 'P0002';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'hugella:cliente:dni:' || v_dni,
      0
    )
  );

  if exists (
    select 1
    from public.clientes cl
    where cl.id <> p_cliente_id
      and nullif(
        regexp_replace(
          coalesce(cl.dni, ''),
          '[^0-9]',
          '',
          'g'
        ),
        ''
      ) = v_dni
  ) then
    raise exception 'El DNI ya pertenece a otro cliente'
      using errcode = '23505';
  end if;

  begin
    update public.clientes cl
    set
      nombre = v_nombre,
      dni = v_dni,
      telefono = v_telefono,
      domicilio = v_domicilio,
      ubicacion = v_ubicacion
    where cl.id = p_cliente_id;
  exception
    when unique_violation then
      raise exception 'El DNI ya pertenece a otro cliente'
        using errcode = '23505';
  end;

  return query
    select
      cl.id,
      cl.nombre,
      cl.dni,
      cl.telefono,
      cl.domicilio,
      cl.ubicacion
    from public.clientes cl
    where cl.id = p_cliente_id;
end;
$$;

revoke all
on function public.actualizar_cliente_admin(
  uuid,
  text,
  text,
  text,
  text,
  text
)
from public, anon, authenticated, service_role;

grant execute
on function public.actualizar_cliente_admin(
  uuid,
  text,
  text,
  text,
  text,
  text
)
to authenticated, service_role;

commit;
