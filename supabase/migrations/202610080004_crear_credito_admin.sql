-- Preparación local: no ejecutar en producción sin revisar defaults y reglas.
begin;

-- No sustituir ni inventar el generador actual del token público.
do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_attribute a
    join pg_catalog.pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where a.attrelid = 'public.creditos'::regclass
      and a.attname = 'access_token' and not a.attisdropped
      and a.atttypid = 'uuid'::regtype and a.attnotnull
  ) then
    raise exception 'Revisión requerida: access_token debe tener su default UUID actual y NOT NULL';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_index i
    where i.indexrelid = to_regclass('public.clientes_dni_normalizado_unique')
      and i.indrelid = 'public.clientes'::regclass
      and i.indisunique and i.indisvalid and i.indisready
  ) then
    raise exception 'Revisión requerida: falta el índice válido de identidad por DNI';
  end if;
end;
$$;

create table public.operaciones_altas_creditos (
  operacion_id uuid primary key,
  actor_id uuid not null references auth.users(id),
  created_at timestamptz not null default clock_timestamp(),
  cliente_id uuid not null references public.clientes(id),
  credito_id uuid not null unique references public.creditos(id),
  cliente_creado boolean not null,
  solicitud jsonb not null check (jsonb_typeof(solicitud) = 'object')
);
alter table public.operaciones_altas_creditos enable row level security;
revoke all on table public.operaciones_altas_creditos
  from public, anon, authenticated, service_role;

create function public.crear_credito_admin(
  p_operacion_id uuid,
  p_dni text,
  p_cliente_nuevo boolean,
  p_cliente_id_esperado uuid,
  p_nombre text,
  p_telefono text,
  p_domicilio text,
  p_codigo text,
  p_producto text,
  p_fecha_inicio date,
  p_cantidad_cuotas integer,
  p_importe_cuota numeric
)
returns table(
  operacion_id uuid,
  cliente_id uuid,
  credito_id uuid,
  codigo text,
  access_token uuid,
  cliente_creado boolean,
  ya_procesada boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
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
    if not found or v_credito.access_token is null
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
      cantidad_cuotas, importe_cuota, estado)
    values(gen_random_uuid(), v_cliente.id, v_codigo, v_producto, p_fecha_inicio,
      p_cantidad_cuotas, p_importe_cuota, v_estado)
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
$$;

revoke all on function public.crear_credito_admin(uuid,text,boolean,uuid,text,text,text,text,text,date,integer,numeric)
  from public, anon, authenticated, service_role;
grant execute on function public.crear_credito_admin(uuid,text,boolean,uuid,text,text,text,text,text,date,integer,numeric)
  to authenticated;

commit;
