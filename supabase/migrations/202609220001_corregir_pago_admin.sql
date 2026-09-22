begin;

-- One transaction: original history is retained, replacement and audit are atomic.
create function public.corregir_pago_admin(
  p_pago_id uuid,
  p_operacion_id uuid,
  p_fecha_pago date,
  p_importe numeric,
  p_medio_pago text,
  p_observaciones text,
  p_motivo text
)
returns table(
  operacion_id uuid,
  pago_original_id uuid,
  pago_nuevo_id uuid,
  credito_id uuid,
  ya_procesada boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_motivo text := nullif(btrim(p_motivo), '');
  v_medio text := nullif(btrim(p_medio_pago), '');
  v_observaciones text := nullif(btrim(p_observaciones), '');
  v_solicitud jsonb;
  v_operacion public.operaciones_pagos%rowtype;
  v_pago public.pagos%rowtype;
  v_credito_id uuid;
  v_nuevo_id uuid;
  v_id_pago_sheets text;
  v_colisiones integer;
begin
  if v_actor_id is null or not public.es_admin_hugella() then
    raise exception 'Acceso no autorizado' using errcode = '42501';
  end if;
  if p_pago_id is null or p_operacion_id is null then
    raise exception 'Pago y operación son obligatorios' using errcode = '22023';
  end if;
  if p_fecha_pago is null or not isfinite(p_fecha_pago)
    or p_importe is null or p_importe <= 0
    or p_importe::text in ('NaN', 'Infinity', '-Infinity')
    or v_medio is null or v_motivo is null then
    raise exception 'Fecha, importe positivo, medio y motivo son obligatorios'
      using errcode = '22023';
  end if;

  v_solicitud := jsonb_build_object(
    'pago_id', p_pago_id, 'fecha_pago', p_fecha_pago, 'importe', p_importe,
    'medio_pago', v_medio, 'observaciones', v_observaciones, 'motivo', v_motivo
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_operacion_id::text, 0)
  );
  select op.* into v_operacion from public.operaciones_pagos as op
  where op.id = p_operacion_id;
  if found then
    if v_operacion.tipo <> 'CORRECCION'
      or v_operacion.actor_id <> v_actor_id
      or v_operacion.pago_original_id <> p_pago_id
      or v_operacion.solicitud <> v_solicitud then
      raise exception 'El identificador de operación ya fue utilizado con otra solicitud'
        using errcode = '22023';
    end if;
    -- A retry also succeeds if the replacement was subsequently corrected/annulled.
    select pg.credito_id into v_credito_id from public.pagos as pg
    where pg.id = v_operacion.pago_nuevo_id;
    return query select p_operacion_id, p_pago_id, v_operacion.pago_nuevo_id,
      v_credito_id, true;
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

  update public.pagos as pg
  set estado = 'ANULADO', anulado_at = clock_timestamp(),
      anulado_por = v_actor_id, motivo_anulacion = v_motivo
  where pg.id = p_pago_id;

  insert into public.pagos (
    credito_id, fecha_pago, importe, medio_pago, observaciones,
    cuotas_aplicadas, remanente, estado, origen, referencia_importacion,
    sincronizado_sheets_at, reemplaza_pago_id
  ) values (
    v_credito_id, p_fecha_pago, p_importe, v_medio, v_observaciones,
    0, 0, 'VALIDO', 'ADMIN', null, null, p_pago_id
  ) returning id into v_nuevo_id;

  -- The legacy publisher uses the first 12 UUID digits. Fail rather than
  -- silently treating a colliding ID as an already published replacement.
  if exists (
    select 1 from public.pagos as otro
    where otro.origen = 'ADMIN' and otro.id <> v_nuevo_id
      and upper(substr(replace(otro.id::text, '-', ''), 1, 12))
        = upper(substr(replace(v_nuevo_id::text, '-', ''), 1, 12))
  ) then
    raise exception 'El ID de Sheets del nuevo pago no es inequívoco'
      using errcode = '23505';
  end if;

  insert into public.operaciones_pagos (
    id, tipo, pago_original_id, pago_nuevo_id, actor_id, motivo, solicitud
  ) values (
    p_operacion_id, 'CORRECCION', p_pago_id, v_nuevo_id,
    v_actor_id, v_motivo, v_solicitud
  );

  -- Also validates the resulting total against the credit value; failure
  -- rolls back the annulment, replacement and audit together.
  perform public.recalcular_pagos_credito(v_credito_id);

  insert into public.eventos_pagos_sheets (
    tipo, pago_id, operacion_id, id_pago_sheets
  ) values ('RETIRAR', p_pago_id, p_operacion_id, v_id_pago_sheets);

  return query select p_operacion_id, p_pago_id, v_nuevo_id, v_credito_id, false;
end;
$$;

revoke all on function public.corregir_pago_admin(uuid, uuid, date, numeric, text, text, text)
  from public, anon;
grant execute on function public.corregir_pago_admin(uuid, uuid, date, numeric, text, text, text)
  to authenticated;

drop function public.obtener_historial_pagos_admin(uuid);

create function public.obtener_historial_pagos_admin(p_credito_id uuid)
returns table(
  pago_id uuid,
  fecha_pago date,
  importe numeric,
  medio_pago text,
  cuotas_aplicadas integer,
  remanente numeric,
  observaciones text,
  origen text,
  created_at timestamptz,
  estado text,
  motivo_anulacion text,
  anulado_at timestamptz,
  reemplaza_pago_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not public.es_admin_hugella() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if p_credito_id is null then
    raise exception 'Credit id is required' using errcode = '42501';
  end if;
  return query
    select pg.id, pg.fecha_pago, pg.importe, pg.medio_pago,
      pg.cuotas_aplicadas, pg.remanente, pg.observaciones, pg.origen,
      pg.created_at, pg.estado, pg.motivo_anulacion, pg.anulado_at, pg.reemplaza_pago_id
    from public.pagos as pg
    where pg.credito_id = p_credito_id
    order by pg.fecha_pago desc, pg.created_at desc;
end;
$$;

revoke all on function public.obtener_historial_pagos_admin(uuid)
  from public, anon;
grant execute on function public.obtener_historial_pagos_admin(uuid)
  to authenticated;

commit;
