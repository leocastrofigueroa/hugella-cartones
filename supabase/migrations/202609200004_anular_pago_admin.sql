begin;

create function public.anular_pago_admin(
  p_pago_id uuid,
  p_operacion_id uuid,
  p_motivo text
)
returns table(
  operacion_id uuid,
  pago_id uuid,
  credito_id uuid,
  estado_pago text,
  anulado_at timestamptz,
  anulado_por uuid,
  motivo_anulacion text,
  estado_credito text,
  ya_procesada boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid;
  v_motivo text;
  v_solicitud jsonb;
  v_operacion public.operaciones_pagos%rowtype;
  v_pago public.pagos%rowtype;
  v_credito_id uuid;
  v_estado_credito text;
  v_id_pago_sheets text;
  v_anulado_at timestamptz;
  v_colisiones integer;
begin
  v_actor_id := auth.uid();

  if v_actor_id is null or not public.es_admin_hugella() then
    raise exception 'Acceso no autorizado'
      using errcode = '42501';
  end if;

  if p_pago_id is null then
    raise exception 'El pago es obligatorio'
      using errcode = '22023';
  end if;
  if p_operacion_id is null then
    raise exception 'El identificador de operación es obligatorio'
      using errcode = '22023';
  end if;

  v_motivo := nullif(btrim(p_motivo), '');
  if v_motivo is null then
    raise exception 'El motivo de anulación es obligatorio'
      using errcode = '22023';
  end if;

  v_solicitud := jsonb_build_object(
    'pago_id', p_pago_id,
    'motivo', v_motivo
  );

  -- Serializa reintentos concurrentes del mismo UUID de operación.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_operacion_id::text, 0)
  );

  select op.*
  into v_operacion
  from public.operaciones_pagos as op
  where op.id = p_operacion_id;

  if found then
    if v_operacion.tipo <> 'ANULACION'
      or v_operacion.pago_original_id <> p_pago_id
      or v_operacion.pago_nuevo_id is not null
      or v_operacion.actor_id <> v_actor_id
      or v_operacion.motivo <> v_motivo
      or v_operacion.solicitud <> v_solicitud
    then
      raise exception 'El identificador de operación ya fue utilizado con otra solicitud'
        using errcode = '22023';
    end if;

    select pg.*
    into v_pago
    from public.pagos as pg
    where pg.id = p_pago_id;

    if not found
      or v_pago.estado <> 'ANULADO'
      or v_pago.anulado_por <> v_actor_id
      or v_pago.motivo_anulacion <> v_motivo
    then
      raise exception 'La operación registrada no coincide con el estado del pago'
        using errcode = '23514';
    end if;

    select cr.estado::text
    into v_estado_credito
    from public.creditos as cr
    where cr.id = v_pago.credito_id;

    if not found then
      raise exception 'La operación registrada no coincide con el estado del crédito'
        using errcode = '23514';
    end if;

    return query select
      p_operacion_id,
      v_pago.id,
      v_pago.credito_id,
      v_pago.estado,
      v_pago.anulado_at,
      v_pago.anulado_por,
      v_pago.motivo_anulacion,
      v_estado_credito,
      true;
    return;
  end if;

  -- Se obtiene primero la identidad del crédito sin bloquear el pago. Todas las
  -- escrituras financieras bloquean después el crédito y luego sus pagos.
  select pg.credito_id
  into v_credito_id
  from public.pagos as pg
  where pg.id = p_pago_id;

  if not found then
    raise exception 'Pago no encontrado'
      using errcode = 'P0002';
  end if;

  perform 1
  from public.creditos as cr
  where cr.id = v_credito_id
  for update;

  if not found then
    raise exception 'Crédito no encontrado'
      using errcode = 'P0002';
  end if;

  select pg.*
  into v_pago
  from public.pagos as pg
  where pg.id = p_pago_id
  for update;

  if not found or v_pago.credito_id <> v_credito_id then
    raise exception 'El pago cambió durante la operación; vuelva a intentarlo'
      using errcode = '40001';
  end if;

  if v_pago.estado = 'ANULADO' then
    raise exception 'El pago ya está anulado'
      using errcode = '22023';
  end if;
  if v_pago.estado <> 'VALIDO' then
    raise exception 'El pago tiene un estado no soportado'
      using errcode = '23514';
  end if;

  if v_pago.origen = 'SHEETS' then
    if v_pago.referencia_importacion is null
      or v_pago.referencia_importacion !~ '^SHEETS-.+$'
    then
      raise exception 'No se puede determinar inequívocamente el ID de Sheets del pago'
        using errcode = '23514';
    end if;
    v_id_pago_sheets := substr(v_pago.referencia_importacion, 8);
  elsif v_pago.origen = 'ADMIN' then
    if v_pago.referencia_importacion is not null then
      raise exception 'No se puede determinar inequívocamente el ID de Sheets del pago'
        using errcode = '23514';
    end if;

    v_id_pago_sheets := 'ADM-'
      || upper(substr(replace(v_pago.id::text, '-', ''), 1, 12));

    select count(*)::integer
    into v_colisiones
    from public.pagos as otro
    where otro.origen = 'ADMIN'
      and 'ADM-' || upper(substr(replace(otro.id::text, '-', ''), 1, 12))
        = v_id_pago_sheets;

    if v_colisiones <> 1 then
      raise exception 'El ID histórico de Sheets del pago no es inequívoco'
        using errcode = '23505';
    end if;
  else
    raise exception 'El origen del pago no permite determinar su ID de Sheets'
      using errcode = '23514';
  end if;

  v_anulado_at := clock_timestamp();

  update public.pagos as pg
  set estado = 'ANULADO',
      anulado_at = v_anulado_at,
      anulado_por = v_actor_id,
      motivo_anulacion = v_motivo
  where pg.id = p_pago_id;

  insert into public.operaciones_pagos (
    id,
    tipo,
    pago_original_id,
    pago_nuevo_id,
    actor_id,
    motivo,
    solicitud
  ) values (
    p_operacion_id,
    'ANULACION',
    p_pago_id,
    null,
    v_actor_id,
    v_motivo,
    v_solicitud
  );

  select r.estado
  into v_estado_credito
  from public.recalcular_pagos_credito(v_credito_id) as r;

  insert into public.eventos_pagos_sheets (
    tipo,
    pago_id,
    operacion_id,
    id_pago_sheets
  ) values (
    'RETIRAR',
    p_pago_id,
    p_operacion_id,
    v_id_pago_sheets
  );

  select pg.*
  into v_pago
  from public.pagos as pg
  where pg.id = p_pago_id;

  return query select
    p_operacion_id,
    v_pago.id,
    v_pago.credito_id,
    v_pago.estado,
    v_pago.anulado_at,
    v_pago.anulado_por,
    v_pago.motivo_anulacion,
    v_estado_credito,
    false;
end;
$$;

revoke all on function public.anular_pago_admin(uuid, uuid, text)
  from public, anon;
grant execute on function public.anular_pago_admin(uuid, uuid, text)
  to authenticated;

-- La definición de esta RPC no estaba versionada cuando se creó la migración.
-- Se modifica únicamente el cuerpo instalado y se conserva todo su contrato,
-- atributos, propietario y ACL. Una forma inesperada aborta la migración.
do $migration$
declare
  v_oid oid := to_regprocedure(
    'public.obtener_pagos_admin_pendientes_sheets()'
  );
  v_before jsonb;
  v_after jsonb;
  v_source text;
  v_patched text;
  v_definition text;
  v_origin_pattern text :=
    $pattern$(\m([a-z_][a-z0-9_]*)\.origen\s*=\s*'ADMIN')$pattern$;
begin
  if v_oid is null then
    raise exception 'Revisión requerida: falta obtener_pagos_admin_pendientes_sheets()';
  end if;

  select to_jsonb(p) - 'prosrc', p.prosrc, pg_get_functiondef(p.oid)
  into v_before, v_source, v_definition
  from pg_proc as p
  where p.oid = v_oid;

  if regexp_count(v_source, v_origin_pattern, 1, 'i') <> 1
    or regexp_count(v_source, '\mestado\s*=\s*''VALIDO''', 1, 'i') <> 0
  then
    raise exception 'Revisión requerida: el filtro de la RPC de pendientes difiere del esperado';
  end if;

  v_patched := regexp_replace(
    v_source,
    v_origin_pattern,
    E'\\1\n    and \\2.estado = ''VALIDO''',
    'i'
  );

  if v_patched = v_source
    or regexp_count(v_patched, '\mestado\s*=\s*''VALIDO''', 1, 'i') <> 1
  then
    raise exception 'Revisión requerida: no se pudo agregar el filtro de pagos válidos';
  end if;

  v_definition := replace(v_definition, v_source, v_patched);
  execute v_definition;

  select to_jsonb(p) - 'prosrc'
  into v_after
  from pg_proc as p
  where p.oid = v_oid;

  if v_after is distinct from v_before
    or (select p.prosrc from pg_proc as p where p.oid = v_oid)
      is distinct from v_patched
  then
    raise exception 'La RPC de pendientes cambió metadatos o ACL inesperadamente';
  end if;
end;
$migration$;

commit;
