-- LOCAL ONLY. Install before the new UI. No historical values are backfilled.
-- Rollback: deploy the prior UI and disable new creation; preserve facts/audit.
-- Do not restore investment-free creation or recycle sequence numbers.
begin;
lock table public.creditos, public.clientes, public.operaciones_altas_creditos in access exclusive mode;
alter table public.creditos add column inversion numeric(12,2)
  constraint creditos_inversion_check check(inversion is null or
    (inversion > 0 and inversion::text not in ('NaN','Infinity','-Infinity')));
alter table public.clientes add column ubicacion text
  constraint clientes_ubicacion_check check(ubicacion is null or
    (length(btrim(ubicacion)) between 1 and 2000));
do $patch$
declare
  target oid := to_regprocedure('public.crear_credito_admin(uuid,text,boolean,uuid,text,text,text,text,date,integer,numeric)');
  owner_name text; definition text; previous text; metadata jsonb;
begin
  if target is null or not (select prosecdef and provolatile='v' and proconfig=array['search_path=""']
      and md5(prosrc)='281aba8a75208439dac203c5c83d15ab' from pg_catalog.pg_proc where oid=target)
    or not pg_catalog.has_function_privilege('authenticated',target,'EXECUTE')
    or pg_catalog.has_function_privilege('anon',target,'EXECUTE')
    or pg_catalog.has_function_privilege('service_role',target,'EXECUTE') then
    raise exception 'Revisión requerida: alta anterior incompatible';
  end if;
  select prosrc,pg_get_functiondef(oid),pg_get_userbyid(proowner),to_jsonb(p)-'prosrc'
    into previous,definition,owner_name,metadata from pg_catalog.pg_proc p where oid=target;
  execute replace(definition,previous,$legacy$
declare
  v_actor uuid := auth.uid();
  v_dni text := nullif(regexp_replace(coalesce(p_dni, ''), '[^0-9]', '', 'g'), '');
  v_nombre text := nullif(btrim(p_nombre), '');
  v_telefono text := nullif(btrim(p_telefono), '');
  v_domicilio text := nullif(btrim(p_domicilio), '');
  v_codigo text;
  v_numero bigint;
  v_intentos integer := 0;
  v_codigo_constraint text;
  v_producto text := nullif(btrim(p_producto), '');
  v_solicitud jsonb;
  v_operacion public.operaciones_altas_creditos%rowtype;
  v_cliente public.clientes%rowtype;
  v_credito public.creditos%rowtype;
  v_estado text;
  v_constraint text;
begin
  if v_actor is null or public.es_admin_hugella() is not true then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if p_operacion_id is null or p_cliente_nuevo is null
    or v_dni is null or length(v_dni) not between 7 and 9 then
    raise exception 'Operación, modalidad y DNI de 7 a 9 dígitos son obligatorios'
      using errcode = '22023';
  end if;
  if p_cliente_nuevo then
    if p_cliente_id_esperado is not null or v_nombre is null then
      raise exception 'Cliente nuevo requiere nombre y no admite UUID esperado'
        using errcode = '22023';
    end if;
  elsif p_cliente_id_esperado is null
    or v_nombre is not null or v_telefono is not null or v_domicilio is not null then
    raise exception 'Cliente existente requiere UUID y no admite cambios de datos'
      using errcode = '22023';
  end if;
  if v_producto is null
    or p_fecha_inicio is null or not isfinite(p_fecha_inicio)
    or p_cantidad_cuotas is null or p_cantidad_cuotas <= 0
    or p_importe_cuota is null or p_importe_cuota <= 0
    or p_importe_cuota::text in ('NaN', 'Infinity', '-Infinity')
    or p_importe_cuota > 9999999999.99
    or p_importe_cuota <> round(p_importe_cuota, 2) then
    raise exception 'Código, producto, fecha, cuotas o importe numeric(12,2) inválidos'
      using errcode = '22023';
  end if;
  -- Regla documentada en docs/estado-efectivo.md: entrega nunca en domingo.
  if extract(isodow from p_fecha_inicio) = 7 then
    raise exception 'La fecha de entrega no puede ser domingo' using errcode = '22023';
  end if;

  -- Canonicaliza formato, no cambia mayúsculas, ceros ni reglas comerciales.
  v_solicitud := jsonb_build_object(
    'dni', v_dni, 'cliente_nuevo', p_cliente_nuevo,
    'cliente_id_esperado', p_cliente_id_esperado,
    'nombre', v_nombre, 'telefono', v_telefono, 'domicilio', v_domicilio,
    'producto', v_producto, 'fecha_inicio', p_fecha_inicio,
    'cantidad_cuotas', p_cantidad_cuotas, 'importe_cuota', p_importe_cuota
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('hugella:alta:operacion:' || p_operacion_id::text, 0)
  );
  select op.* into v_operacion from public.operaciones_altas_creditos op
    where op.operacion_id = p_operacion_id;
  if found then
    if v_operacion.actor_id <> v_actor or v_operacion.solicitud <> v_solicitud then
      raise exception 'El identificador de operación ya fue utilizado con otra solicitud'
        using errcode = '22023';
    end if;
    select cr.* into v_credito from public.creditos cr where cr.id = v_operacion.credito_id;
    if not found or v_credito.origen is distinct from 'ADMIN' or v_credito.access_token is null
      or v_credito.cliente_id is distinct from v_operacion.cliente_id then
      raise exception 'La operación registrada no coincide con el crédito'
        using errcode = '23514';
    end if;
    return query select p_operacion_id, v_operacion.cliente_id, v_operacion.credito_id,
      v_credito.codigo::text, v_credito.access_token, v_operacion.cliente_creado, true;
    return;
  end if;

  raise exception 'Esta firma solo permite reintentar altas confirmadas; use el alta con inversión' using errcode = '22023';
end;
$legacy$);
  if (select to_jsonb(p)-'prosrc' from pg_catalog.pg_proc p where oid=target) is distinct from metadata then
    raise exception 'Metadatos del alta anterior cambiaron';
  end if;
end;
$patch$;
create function public.crear_credito_admin(
 p_operacion_id uuid,p_dni text,p_cliente_nuevo boolean,p_cliente_id_esperado uuid,
 p_nombre text,p_telefono text,p_domicilio text,p_producto text,p_fecha_inicio date,
 p_cantidad_cuotas integer,p_importe_cuota numeric,p_inversion numeric,p_ubicacion text
)
returns table(operacion_id uuid,cliente_id uuid,credito_id uuid,codigo text,
 access_token uuid,cliente_creado boolean,ya_procesada boolean)
language plpgsql volatile security definer set search_path='' as $new$
declare
  v_actor uuid := auth.uid();
  v_dni text := nullif(regexp_replace(coalesce(p_dni, ''), '[^0-9]', '', 'g'), '');
  v_nombre text := nullif(btrim(p_nombre), '');
  v_telefono text := nullif(btrim(p_telefono), '');
  v_domicilio text := nullif(btrim(p_domicilio), '');
  v_inversion numeric := p_inversion;
  v_ubicacion text := nullif(btrim(p_ubicacion), '');
  v_codigo text;
  v_numero bigint;
  v_intentos integer := 0;
  v_codigo_constraint text;
  v_producto text := nullif(btrim(p_producto), '');
  v_solicitud jsonb;
  v_operacion public.operaciones_altas_creditos%rowtype;
  v_cliente public.clientes%rowtype;
  v_credito public.creditos%rowtype;
  v_estado text;
  v_constraint text;
begin
  if v_actor is null or public.es_admin_hugella() is not true then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if p_operacion_id is null or p_cliente_nuevo is null
    or v_dni is null or length(v_dni) not between 7 and 9 then
    raise exception 'Operación, modalidad y DNI de 7 a 9 dígitos son obligatorios'
      using errcode = '22023';
  end if;
  if p_cliente_nuevo then
    if p_cliente_id_esperado is not null or v_nombre is null then
      raise exception 'Cliente nuevo requiere nombre y no admite UUID esperado'
        using errcode = '22023';
    end if;
  elsif p_cliente_id_esperado is null
    or v_nombre is not null or v_telefono is not null or v_domicilio is not null then
    raise exception 'Cliente existente requiere UUID y no admite cambios de datos'
      using errcode = '22023';
  end if;
  if v_producto is null
    or p_fecha_inicio is null or not isfinite(p_fecha_inicio)
    or p_cantidad_cuotas is null or p_cantidad_cuotas <= 0
    or p_importe_cuota is null or p_importe_cuota <= 0
    or p_importe_cuota::text in ('NaN', 'Infinity', '-Infinity')
    or p_importe_cuota > 9999999999.99
    or p_importe_cuota <> round(p_importe_cuota, 2) then
    raise exception 'Código, producto, fecha, cuotas o importe numeric(12,2) inválidos'
      using errcode = '22023';
  end if;
  -- Regla documentada en docs/estado-efectivo.md: entrega nunca en domingo.
  if extract(isodow from p_fecha_inicio) = 7 then
    raise exception 'La fecha de entrega no puede ser domingo' using errcode = '22023';
  end if;

  if v_inversion is null or v_inversion <= 0 or v_inversion::text in ('NaN','Infinity','-Infinity')
    or v_inversion > 9999999999.99 or v_inversion <> round(v_inversion,2) then
    raise exception 'Inversión positiva numeric(12,2) obligatoria' using errcode='22023';
  end if;
  if length(v_ubicacion)>2000 or (not p_cliente_nuevo and v_ubicacion is not null) then
    raise exception 'Ubicación inválida o modificación de cliente existente no permitida' using errcode='22023';
  end if;

  -- Canonicaliza formato, no cambia mayúsculas, ceros ni reglas comerciales.
  v_solicitud := jsonb_build_object(
    'dni', v_dni, 'cliente_nuevo', p_cliente_nuevo,
    'cliente_id_esperado', p_cliente_id_esperado,
    'nombre', v_nombre, 'telefono', v_telefono, 'domicilio', v_domicilio,
    'version', 2, 'inversion', v_inversion, 'ubicacion', v_ubicacion,
    'producto', v_producto, 'fecha_inicio', p_fecha_inicio,
    'cantidad_cuotas', p_cantidad_cuotas, 'importe_cuota', p_importe_cuota
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('hugella:alta:operacion:' || p_operacion_id::text, 0)
  );
  select op.* into v_operacion from public.operaciones_altas_creditos op
    where op.operacion_id = p_operacion_id;
  if found then
    if v_operacion.actor_id <> v_actor or v_operacion.solicitud <> v_solicitud then
      raise exception 'El identificador de operación ya fue utilizado con otra solicitud'
        using errcode = '22023';
    end if;
    select cr.* into v_credito from public.creditos cr where cr.id = v_operacion.credito_id;
    if not found or v_credito.origen is distinct from 'ADMIN' or v_credito.access_token is null
      or v_credito.cliente_id is distinct from v_operacion.cliente_id then
      raise exception 'La operación registrada no coincide con el crédito'
        using errcode = '23514';
    end if;
    return query select p_operacion_id, v_operacion.cliente_id, v_operacion.credito_id,
      v_credito.codigo::text, v_credito.access_token, v_operacion.cliente_creado, true;
    return;
  end if;

  -- Serializa altas nuevas; UNIQUE también protege frente a escritores legados.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('hugella:alta:dni:' || v_dni, 0)
  );
  if p_cliente_nuevo then
    if exists (select 1 from public.clientes cl
      where nullif(regexp_replace(coalesce(cl.dni, ''), '[^0-9]', '', 'g'), '') = v_dni) then
      raise exception 'El DNI ya pertenece a un cliente; vuelva a buscarlo'
        using errcode = '23505';
    end if;
    begin
      insert into public.clientes(id, nombre, dni, telefono, domicilio, ubicacion)
        values(gen_random_uuid(), v_nombre, v_dni, v_telefono, v_domicilio, v_ubicacion)
        returning * into v_cliente;
    exception when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'clientes_dni_normalizado_unique' then
        raise exception 'El DNI ya pertenece a un cliente; vuelva a buscarlo'
          using errcode = '23505';
      end if;
      raise;
    end;
  else
    select cl.* into v_cliente from public.clientes cl
      where cl.id = p_cliente_id_esperado for update;
    if not found or nullif(regexp_replace(coalesce(v_cliente.dni, ''), '[^0-9]', '', 'g'), '')
      is distinct from v_dni then
      raise exception 'El cliente esperado ya no corresponde al DNI'
        using errcode = '22023';
    end if;
  end if;

  v_estado := public.hugella_estado_credito(p_cantidad_cuotas, 0::bigint,
    public.hugella_cuotas_exigibles(p_fecha_inicio, p_cantidad_cuotas));
  select c.conname into strict v_codigo_constraint
  from pg_catalog.pg_constraint c
  where c.conrelid='public.creditos'::regclass and c.contype='u'
    and c.conkey=array[(select a.attnum from pg_catalog.pg_attribute a
      where a.attrelid=c.conrelid and a.attname='codigo')]::smallint[];
  loop
    v_intentos := v_intentos + 1;
    if v_intentos > 1000 then
      raise exception 'No se pudo asignar un código; reintente la misma operación' using errcode='54000';
    end if;
    v_numero := pg_catalog.nextval('public.creditos_codigo_seq'::regclass);
    v_codigo := 'CR-' || pg_catalog.lpad(v_numero::text, greatest(4,length(v_numero::text)), '0');
    begin
      insert into public.creditos(id, cliente_id, codigo, producto, fecha_inicio,
        cantidad_cuotas, importe_cuota, estado, origen, inversion)
      values(gen_random_uuid(), v_cliente.id, v_codigo, v_producto, p_fecha_inicio,
        p_cantidad_cuotas, p_importe_cuota, v_estado, 'ADMIN', v_inversion)
      returning * into v_credito;
      exit;
    exception when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint is distinct from v_codigo_constraint then raise; end if;
      -- Retry only the credit INSERT; never adopt the conflicting credit.
    end;
  end loop;
  insert into public.operaciones_altas_creditos(
    operacion_id, actor_id, cliente_id, credito_id, cliente_creado, solicitud)
  values(p_operacion_id, v_actor, v_cliente.id, v_credito.id, p_cliente_nuevo, v_solicitud);

  return query select p_operacion_id, v_cliente.id, v_credito.id,
    v_credito.codigo::text, v_credito.access_token, p_cliente_nuevo, false;
end;
$new$;
do $owner$
begin
 execute pg_catalog.format('alter function public.crear_credito_admin(uuid,text,boolean,uuid,text,text,text,text,date,integer,numeric,numeric,text) owner to %I',
   pg_catalog.pg_get_userbyid((select proowner from pg_catalog.pg_proc where oid='public.crear_credito_admin(uuid,text,boolean,uuid,text,text,text,text,date,integer,numeric)'::regprocedure)));
end;
$owner$;
revoke all on function public.crear_credito_admin(uuid,text,boolean,uuid,text,text,text,text,date,integer,numeric,numeric,text) from public,anon,authenticated,service_role;
grant execute on function public.crear_credito_admin(uuid,text,boolean,uuid,text,text,text,text,date,integer,numeric,numeric,text) to authenticated;

create function public.buscar_cliente_por_dni_admin_v2(p_dni text)
returns table(
  id uuid,
  nombre text,
  dni text,
  telefono text,
  domicilio text,
  ubicacion text
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
    select cl.id, cl.nombre, cl.dni, cl.telefono, cl.domicilio, cl.ubicacion
    from public.clientes as cl
    where nullif(regexp_replace(coalesce(cl.dni, ''), '[^0-9]', '', 'g'), '') = v_dni;

  get diagnostics v_cantidad = row_count;
  if v_cantidad > 1 then
    raise exception 'Identidad de cliente ambigua'
      using errcode = '23514';
  end if;
end;
$$;

revoke all on function public.buscar_cliente_por_dni_admin_v2(text)
  from public, anon, authenticated, service_role;
grant execute on function public.buscar_cliente_por_dni_admin_v2(text)
  to authenticated;

commit;
