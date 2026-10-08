begin;

create function public.buscar_cliente_por_dni_admin(p_dni text)
returns table(
  id uuid,
  nombre text,
  dni text,
  telefono text,
  domicilio text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_dni text;
  v_cantidad bigint;
begin
  if auth.uid() is null or public.es_admin_hugella() is not true then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  -- Misma expresión de identidad que clientes_dni_normalizado_unique.
  v_dni := nullif(regexp_replace(coalesce(p_dni, ''), '[^0-9]', '', 'g'), '');
  if v_dni is null or length(v_dni) not between 7 and 9 then
    raise exception 'El DNI debe contener entre 7 y 9 dígitos'
      using errcode = '22023';
  end if;

  -- Se devuelve el DNI almacenado, sin reescribirlo ni limitar coincidencias.
  return query
    select cl.id, cl.nombre, cl.dni, cl.telefono, cl.domicilio
    from public.clientes as cl
    where nullif(regexp_replace(coalesce(cl.dni, ''), '[^0-9]', '', 'g'), '') = v_dni;

  get diagnostics v_cantidad = row_count;
  if v_cantidad > 1 then
    raise exception 'Identidad de cliente ambigua'
      using errcode = '23514';
  end if;
end;
$$;

revoke all on function public.buscar_cliente_por_dni_admin(text)
  from public, anon, authenticated, service_role;
grant execute on function public.buscar_cliente_por_dni_admin(text)
  to authenticated;

commit;
