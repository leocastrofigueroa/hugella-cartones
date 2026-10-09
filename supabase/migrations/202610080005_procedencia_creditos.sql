-- Local preparation. Review read-only preflight before manual installation.
-- Rollback: disable new Admin writes; keep provenance if any Admin credit exists.
-- Never restore the legacy adoption behavior while Admin credits exist.
begin;
lock table public.creditos, public.operaciones_altas_creditos in access exclusive mode;
do $$
begin
  -- One-time installation snapshot, not a permanent business limit.
  if (select count(*) from public.creditos) <> 44 then
    raise exception 'Revisión requerida: cantidad histórica cambió';
  end if;
  if exists(select 1 from public.operaciones_altas_creditos) then
    raise exception 'Revisión requerida: existen altas Admin';
  end if;
  if exists(select 1 from public.creditos where codigo !~ '^CR-[0-9]+$')
    or exists(select 1 from public.creditos group by substring(codigo from 4)::numeric having count(*)>1)
    or (select max(substring(codigo from 4)::numeric) from public.creditos) is distinct from 47::numeric then
    raise exception 'Revisión requerida: fotografía histórica incompatible';
  end if;
  if exists(select 1 from pg_catalog.pg_attribute where attrelid='public.creditos'::regclass and attname='origen' and not attisdropped) then
    raise exception 'Revisión requerida: origen ya existe';
  end if;
end;
$$;
alter table public.creditos add column origen text;
update public.creditos set origen='SHEETS';
alter table public.creditos alter column origen set not null;
alter table public.creditos add constraint creditos_origen_check check(origen in ('SHEETS','ADMIN'));
create function public.proteger_origen_credito() returns trigger
language plpgsql set search_path='' as $$
begin
  if new.origen is distinct from old.origen then
    raise exception 'El origen del crédito es inmutable' using errcode='23514';
  end if;
  return new;
end;
$$;
revoke all on function public.proteger_origen_credito() from public,anon,authenticated,service_role;
create trigger creditos_origen_inmutable before update on public.creditos
for each row execute function public.proteger_origen_credito();
do $patch$
declare
  target oid := to_regprocedure('public.importar_credito_hugella(text,text,text,text,text,text,date,integer,numeric)');
  definition text; previous text; before_metadata jsonb;
  replacement text := $body$
declare
  v_cliente_id uuid;
  v_credito_id uuid;
  v_origen text;
  v_constraint text;
  v_codigo_constraint text;
begin
  -- Esta RPC NO debe quedar disponible públicamente.
  if auth.role() <> 'authenticated'
     or not public.es_admin_hugella() then
    raise exception 'No autorizado';
  end if;

  if nullif(trim(p_codigo), '') is null
     or nullif(trim(p_nombre), '') is null
     or nullif(trim(p_dni), '') is null
     or nullif(trim(p_telefono), '') is null
     or nullif(trim(p_producto), '') is null
     or p_fecha_inicio is null
     or p_cantidad_cuotas <= 0
     or p_importe_cuota <= 0 then
    raise exception 'Datos de crédito inválidos';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('hugella:alta:codigo:' || trim(p_codigo), 0));
  -- Evitar duplicar créditos ya importados.
  select id, origen
  into v_credito_id, v_origen
  from public.creditos
  where codigo = trim(p_codigo);

  if v_credito_id is not null then
    if v_origen is distinct from 'SHEETS' then
      raise exception 'El código pertenece a un crédito Admin' using errcode = '22023';
    end if;
    return v_credito_id;
  end if;

  select c.conname into strict v_codigo_constraint
  from pg_catalog.pg_constraint c
  where c.conrelid = 'public.creditos'::regclass and c.contype = 'u'
    and c.conkey = array[(select a.attnum from pg_catalog.pg_attribute a
      where a.attrelid = c.conrelid and a.attname = 'codigo')]::smallint[];
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'hugella:alta:dni:' || regexp_replace(p_dni, '[^0-9]', '', 'g'), 0));
  BEGIN
  -- Buscar al cliente por DNI normalizado.
  select id
  into v_cliente_id
  from public.clientes
  where regexp_replace(coalesce(dni, ''), '\D', '', 'g')
        = regexp_replace(p_dni, '\D', '', 'g')
  limit 1;

  -- Si todavía no existe, crearlo.
  if v_cliente_id is null then
    insert into public.clientes (
      nombre,
      dni,
      telefono,
      domicilio
    )
    values (
      trim(p_nombre),
      regexp_replace(p_dni, '\D', '', 'g'),
      trim(p_telefono),
      nullif(trim(coalesce(p_domicilio, '')), '')
    )
    returning id into v_cliente_id;
  end if;

  insert into public.creditos (
    cliente_id,
    codigo,
    producto,
    fecha_inicio,
    cantidad_cuotas,
    importe_cuota,
    estado, origen
  )
  values (
    v_cliente_id,
    trim(p_codigo),
    trim(p_producto),
    p_fecha_inicio,
    p_cantidad_cuotas,
    p_importe_cuota,
    'AL DIA', 'SHEETS'
  )
  returning id into v_credito_id;

  EXCEPTION WHEN unique_violation THEN
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint is distinct from v_codigo_constraint then raise; end if;
    -- The nested block rolled back any provisional client before inspecting the winner.
    select cr.id, cr.origen into v_credito_id, v_origen
    from public.creditos cr where cr.codigo = trim(p_codigo);
    if not found then raise; end if;
    if v_origen is distinct from 'SHEETS' then
      raise exception 'El código pertenece a un crédito Admin' using errcode = '22023';
    end if;
  END;
  return v_credito_id;
end;
$body$;
begin
  if target is null then raise exception 'Falta RPC importar_credito_hugella'; end if;
  if not (select prosecdef and provolatile='v' from pg_catalog.pg_proc where oid=target)
     or not pg_catalog.has_function_privilege('authenticated',target,'EXECUTE')
     or pg_catalog.has_function_privilege('anon',target,'EXECUTE')
     or pg_catalog.has_function_privilege('service_role',target,'EXECUTE') then
    raise exception 'Seguridad RPC inesperada';
  end if;
  select prosrc, pg_get_functiondef(oid), to_jsonb(p)-'prosrc'-'proconfig'
    into previous, definition, before_metadata from pg_catalog.pg_proc p where oid=target;
  if md5(previous)<>'f560efc659dc70a2dabb77c02b055931' then raise exception 'Cuerpo inesperado: importar_credito_hugella'; end if;
  execute replace(definition, previous, replacement);
  execute 'alter function public.importar_credito_hugella(text,text,text,text,text,text,date,integer,numeric) set search_path to ''''';
  if (select to_jsonb(p)-'prosrc'-'proconfig' from pg_catalog.pg_proc p where oid=target)
      is distinct from before_metadata then raise exception 'Metadatos cambiaron: importar_credito_hugella'; end if;
end;
$patch$;

do $patch$
declare
  target oid := to_regprocedure('public.actualizar_credito_desde_sheets(text,text,text,text,text,text,date,integer,numeric)');
  definition text; previous text; before_metadata jsonb;
  replacement text := $body$
declare
  v_credito_id uuid;
  v_cliente_id uuid;
begin

  select
    id,
    cliente_id
  into
    v_credito_id,
    v_cliente_id
  from public.creditos
  where codigo = p_codigo
  limit 1;

  if v_credito_id is null then
    raise exception 'No existe el crédito %', p_codigo;
  end if;

  if v_cliente_id is null then
    raise exception 'El crédito % no tiene cliente asociado', p_codigo;
  end if;


  -- Identity is checked under locks before the only remaining write.
  DECLARE
    identity_credit public.creditos%ROWTYPE;
    identity_client public.clientes%ROWTYPE;
    sheet_dni text;
    stored_dni text;
    sheet_name text;
    stored_name text;
  BEGIN
    IF nullif(btrim(p_codigo), '') IS NULL THEN
      RAISE EXCEPTION 'Crédito %: código vacío', p_codigo USING ERRCODE = '22023';
    END IF;
    BEGIN
      SELECT * INTO STRICT identity_credit FROM public.creditos
      WHERE codigo = p_codigo FOR UPDATE;
    EXCEPTION
      WHEN no_data_found OR too_many_rows THEN
        RAISE EXCEPTION 'Crédito %: código inexistente o ambiguo', p_codigo USING ERRCODE = '22023';
    END;
    IF identity_credit.origen IS DISTINCT FROM 'SHEETS' THEN
      RAISE EXCEPTION 'No se puede actualizar un crédito Admin desde Sheets' USING ERRCODE = '22023';
    END IF;
    IF identity_credit.id IS DISTINCT FROM v_credito_id
       OR identity_credit.cliente_id IS DISTINCT FROM v_cliente_id THEN
      RAISE EXCEPTION 'Crédito %: asociación modificada concurrentemente', p_codigo USING ERRCODE = '22023';
    END IF;
    SELECT * INTO identity_client FROM public.clientes
    WHERE id = identity_credit.cliente_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Crédito %: cliente asociado inexistente', p_codigo USING ERRCODE = '22023';
    END IF;
    sheet_dni := regexp_replace(coalesce(p_dni, ''), '[^0-9]', '', 'g');
    stored_dni := regexp_replace(coalesce(identity_client.dni, ''), '[^0-9]', '', 'g');
    IF sheet_dni = '' OR stored_dni = '' OR sheet_dni <> stored_dni THEN
      RAISE EXCEPTION 'Crédito %: DNI vacío o diferente del cliente asociado; no se aplicaron cambios', p_codigo USING ERRCODE = '22023';
    END IF;
    sheet_name := upper(btrim(regexp_replace(coalesce(p_nombre, ''), '[[:space:]]+', ' ', 'g')));
    stored_name := upper(btrim(regexp_replace(coalesce(identity_client.nombre, ''), '[[:space:]]+', ' ', 'g')));
    IF sheet_name = '' OR stored_name = '' OR sheet_name <> stored_name THEN
      RAISE EXCEPTION 'Crédito %: nombre vacío o diferente del cliente asociado; no se aplicaron cambios', p_codigo USING ERRCODE = '22023';
    END IF;
    IF nullif(regexp_replace(coalesce(p_producto, ''), '[[:space:]]', '', 'g'), '') IS NULL
       OR p_fecha_inicio IS NULL OR NOT isfinite(p_fecha_inicio)
       OR p_cantidad_cuotas IS NULL OR p_cantidad_cuotas <= 0
       OR p_importe_cuota IS NULL OR p_importe_cuota <= 0
       OR p_importe_cuota::text IN ('NaN', 'Infinity', '-Infinity') THEN
      RAISE EXCEPTION 'Crédito %: producto, fecha, cantidad de cuotas o importe inválido', p_codigo USING ERRCODE = '22023';
    END IF;
    -- p_telefono and p_domicilio remain accepted only for API compatibility.
  END;


  update public.creditos
  set
    producto = p_producto,
    fecha_inicio = p_fecha_inicio,
    cantidad_cuotas = p_cantidad_cuotas,
    importe_cuota = p_importe_cuota
  where id = v_credito_id;

  return jsonb_build_object(
    'ok', true,
    'codigo', p_codigo,
    'credito_id', v_credito_id,
    'cliente_id', v_cliente_id
  );

end;
$body$;
begin
  if target is null then raise exception 'Falta RPC actualizar_credito_desde_sheets'; end if;
  if not (select prosecdef and provolatile='v' from pg_catalog.pg_proc where oid=target)
     or not pg_catalog.has_function_privilege('authenticated',target,'EXECUTE')
     or pg_catalog.has_function_privilege('anon',target,'EXECUTE')
     or pg_catalog.has_function_privilege('service_role',target,'EXECUTE') then
    raise exception 'Seguridad RPC inesperada';
  end if;
  select prosrc, pg_get_functiondef(oid), to_jsonb(p)-'prosrc'-'proconfig'
    into previous, definition, before_metadata from pg_catalog.pg_proc p where oid=target;
  if md5(previous)<>'a9598ba11814ba0a804f271401bacba0' then raise exception 'Cuerpo inesperado: actualizar_credito_desde_sheets'; end if;
  execute replace(definition, previous, replacement);
  execute 'alter function public.actualizar_credito_desde_sheets(text,text,text,text,text,text,date,integer,numeric) set search_path to ''''';
  if (select to_jsonb(p)-'prosrc'-'proconfig' from pg_catalog.pg_proc p where oid=target)
      is distinct from before_metadata then raise exception 'Metadatos cambiaron: actualizar_credito_desde_sheets'; end if;
end;
$patch$;

do $patch$
declare
  target oid := to_regprocedure('public.crear_credito_admin(uuid,text,boolean,uuid,text,text,text,text,text,date,integer,numeric)');
  definition text; previous text; before_metadata jsonb;
  replacement text := $body$
declare
  v_actor uuid := auth.uid();
  v_dni text := nullif(regexp_replace(coalesce(p_dni, ''), '[^0-9]', '', 'g'), '');
  v_nombre text := nullif(btrim(p_nombre), '');
  v_telefono text := nullif(btrim(p_telefono), '');
  v_domicilio text := nullif(btrim(p_domicilio), '');
  v_codigo text := nullif(btrim(p_codigo), '');
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
  if v_codigo is null or v_producto is null
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
    'codigo', v_codigo, 'producto', v_producto, 'fecha_inicio', p_fecha_inicio,
    'cantidad_cuotas', p_cantidad_cuotas, 'importe_cuota', p_importe_cuota
  );
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('hugella:alta:codigo:' || v_codigo, 0));
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
      or v_credito.codigo is distinct from v_solicitud->>'codigo'
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
      insert into public.clientes(id, nombre, dni, telefono, domicilio)
        values(gen_random_uuid(), v_nombre, v_dni, v_telefono, v_domicilio)
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
  begin
    -- access_token y created_at usan sus defaults actuales, sin duplicar lógica.
    insert into public.creditos(id, cliente_id, codigo, producto, fecha_inicio,
      cantidad_cuotas, importe_cuota, estado, origen)
    values(gen_random_uuid(), v_cliente.id, v_codigo, v_producto, p_fecha_inicio,
      p_cantidad_cuotas, p_importe_cuota, v_estado, 'ADMIN')
    returning * into v_credito;
  exception when unique_violation then
    if exists (select 1 from public.creditos cr where cr.codigo = v_codigo) then
      raise exception 'El código de crédito ya existe' using errcode = '23505';
    end if;
    raise;
  end;
  insert into public.operaciones_altas_creditos(
    operacion_id, actor_id, cliente_id, credito_id, cliente_creado, solicitud)
  values(p_operacion_id, v_actor, v_cliente.id, v_credito.id, p_cliente_nuevo, v_solicitud);

  return query select p_operacion_id, v_cliente.id, v_credito.id,
    v_credito.codigo::text, v_credito.access_token, p_cliente_nuevo, false;
end;
$body$;
begin
  if target is null then raise exception 'Falta RPC crear_credito_admin'; end if;
  if not (select prosecdef and provolatile='v' from pg_catalog.pg_proc where oid=target)
     or not pg_catalog.has_function_privilege('authenticated',target,'EXECUTE')
     or pg_catalog.has_function_privilege('anon',target,'EXECUTE')
     or pg_catalog.has_function_privilege('service_role',target,'EXECUTE') then
    raise exception 'Seguridad RPC inesperada';
  end if;
  select prosrc, pg_get_functiondef(oid), to_jsonb(p)-'prosrc'-'proconfig'
    into previous, definition, before_metadata from pg_catalog.pg_proc p where oid=target;
  if md5(previous)<>'227072cbf25f0f8f30c183ea4fbffee4' then raise exception 'Cuerpo inesperado: crear_credito_admin'; end if;
  execute replace(definition, previous, replacement);
  execute 'alter function public.crear_credito_admin(uuid,text,boolean,uuid,text,text,text,text,text,date,integer,numeric) set search_path to ''''';
  if (select to_jsonb(p)-'prosrc'-'proconfig' from pg_catalog.pg_proc p where oid=target)
      is distinct from before_metadata then raise exception 'Metadatos cambiaron: crear_credito_admin'; end if;
end;
$patch$;
commit;
