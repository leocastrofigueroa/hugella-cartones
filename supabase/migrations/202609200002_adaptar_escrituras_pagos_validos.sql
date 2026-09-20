begin;

create or replace function public.importar_pago_hugella(
  p_codigo_credito text,
  p_fecha_pago date,
  p_importe numeric,
  p_medio_pago text,
  p_observaciones text default null::text
)
returns uuid
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_credito_id uuid;
  v_pago_id uuid;
begin
  if auth.role() <> 'authenticated'
     or not public.es_admin_hugella() then
    raise exception 'No autorizado';
  end if;

  if nullif(trim(p_codigo_credito), '') is null
     or p_fecha_pago is null
     or p_importe <= 0
     or nullif(trim(p_medio_pago), '') is null then
    raise exception 'Datos de pago inválidos';
  end if;

  select cr.id
  into v_credito_id
  from public.creditos as cr
  where cr.codigo = trim(p_codigo_credito)
  for update;

  if v_credito_id is null then
    raise exception 'Crédito no encontrado';
  end if;

  insert into public.pagos (
    credito_id,
    fecha_pago,
    importe,
    medio_pago,
    cuotas_aplicadas,
    remanente,
    observaciones
  )
  values (
    v_credito_id,
    p_fecha_pago,
    p_importe,
    trim(p_medio_pago),
    0,
    0,
    nullif(trim(coalesce(p_observaciones, '')), '')
  )
  returning id into v_pago_id;

  perform public.recalcular_pagos_credito(v_credito_id);

  return v_pago_id;
end;
$$;

create or replace function public.importar_pago_hugella(
  p_codigo_credito text,
  p_fecha_pago date,
  p_importe numeric,
  p_medio_pago text,
  p_observaciones text default null::text,
  p_referencia_importacion text default null::text
)
returns uuid
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_credito_id uuid;
  v_pago_id uuid;
  v_pago_estado text;
  v_referencia text;
begin
  if auth.role() <> 'authenticated'
     or not public.es_admin_hugella() then
    raise exception 'No autorizado';
  end if;

  if nullif(trim(p_codigo_credito), '') is null
     or p_fecha_pago is null
     or p_importe <= 0
     or nullif(trim(p_medio_pago), '') is null then
    raise exception 'Datos de pago inválidos';
  end if;

  v_referencia := nullif(trim(coalesce(p_referencia_importacion, '')), '');

  if v_referencia is not null then
    select pg.id, pg.estado
    into v_pago_id, v_pago_estado
    from public.pagos as pg
    where pg.referencia_importacion = v_referencia;

    if v_pago_id is not null then
      if v_pago_estado = 'ANULADO' then
        raise exception 'La referencia de importación corresponde a un pago anulado'
          using errcode = '22023';
      end if;
      return v_pago_id;
    end if;
  end if;

  select cr.id
  into v_credito_id
  from public.creditos as cr
  where cr.codigo = trim(p_codigo_credito)
  for update;

  if v_credito_id is null then
    raise exception 'Crédito no encontrado';
  end if;

  -- Repetir la comprobacion bajo el bloqueo del credito evita duplicados si
  -- dos sincronizaciones del mismo credito procesan juntas una referencia.
  if v_referencia is not null then
    select pg.id, pg.estado
    into v_pago_id, v_pago_estado
    from public.pagos as pg
    where pg.referencia_importacion = v_referencia;

    if v_pago_id is not null then
      if v_pago_estado = 'ANULADO' then
        raise exception 'La referencia de importación corresponde a un pago anulado'
          using errcode = '22023';
      end if;
      return v_pago_id;
    end if;
  end if;

  insert into public.pagos (
    credito_id,
    fecha_pago,
    importe,
    medio_pago,
    cuotas_aplicadas,
    remanente,
    observaciones,
    referencia_importacion
  )
  values (
    v_credito_id,
    p_fecha_pago,
    p_importe,
    trim(p_medio_pago),
    0,
    0,
    nullif(trim(coalesce(p_observaciones, '')), ''),
    v_referencia
  )
  returning id into v_pago_id;

  perform public.recalcular_pagos_credito(v_credito_id);

  return v_pago_id;
end;
$$;

create or replace function public.registrar_pago_admin(
  p_credito_id uuid,
  p_fecha_pago date,
  p_importe numeric,
  p_medio_pago text,
  p_observaciones text default null::text
)
returns table(
  pago_id uuid,
  cuotas_aplicadas integer,
  remanente numeric,
  cuotas_pagadas integer,
  cuotas_pendientes integer
)
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_importe_cuota numeric;
  v_cantidad_cuotas integer;
  v_valor_total_credito numeric;
  v_total_pagado_antes numeric;
  v_importe_restante numeric;
  v_cuotas_completas_antes integer;
  v_pago_id uuid;
  v_pago_cuotas_aplicadas integer;
  v_pago_remanente numeric;
  v_cuotas_pagadas integer;
  v_cuotas_pendientes integer;
begin
  if auth.uid() is null or not public.es_admin_hugella() then
    raise exception 'Acceso no autorizado'
      using errcode = '42501';
  end if;

  if p_credito_id is null then
    raise exception 'El crédito es obligatorio'
      using errcode = '22023';
  end if;
  if p_fecha_pago is null then
    raise exception 'La fecha de pago es obligatoria'
      using errcode = '22023';
  end if;
  if p_importe is null or p_importe <= 0 then
    raise exception 'El importe debe ser mayor que cero'
      using errcode = '22023';
  end if;
  if nullif(btrim(p_medio_pago), '') is null then
    raise exception 'El medio de pago es obligatorio'
      using errcode = '22023';
  end if;

  select cr.importe_cuota, cr.cantidad_cuotas
  into v_importe_cuota, v_cantidad_cuotas
  from public.creditos as cr
  where cr.id = p_credito_id
  for update;

  if not found then
    raise exception 'Crédito no encontrado'
      using errcode = 'P0002';
  end if;
  if v_importe_cuota is null or v_importe_cuota <= 0 then
    raise exception 'El crédito tiene un importe de cuota inválido'
      using errcode = '22023';
  end if;
  if v_cantidad_cuotas is null or v_cantidad_cuotas <= 0 then
    raise exception 'El crédito tiene una cantidad de cuotas inválida'
      using errcode = '22023';
  end if;

  v_valor_total_credito := v_importe_cuota * v_cantidad_cuotas;

  select coalesce(sum(greatest(coalesce(pg.importe, 0), 0)), 0)
  into v_total_pagado_antes
  from public.pagos as pg
  where pg.credito_id = p_credito_id
    and pg.estado = 'VALIDO';

  v_cuotas_completas_antes := least(
    v_cantidad_cuotas,
    floor(v_total_pagado_antes / v_importe_cuota)::integer
  );

  if v_cuotas_completas_antes >= v_cantidad_cuotas then
    raise exception 'El crédito ya está totalmente cancelado'
      using errcode = '22023';
  end if;

  v_importe_restante := greatest(
    v_valor_total_credito - v_total_pagado_antes,
    0
  );

  if p_importe > v_importe_restante then
    raise exception 'El importe supera el valor pendiente del crédito'
      using
        errcode = '22023',
        detail = format('Importe máximo permitido: %s', v_importe_restante);
  end if;

  insert into public.pagos (
    credito_id,
    fecha_pago,
    importe,
    medio_pago,
    cuotas_aplicadas,
    remanente,
    observaciones
  )
  values (
    p_credito_id,
    p_fecha_pago,
    p_importe,
    btrim(p_medio_pago),
    0,
    0,
    nullif(btrim(p_observaciones), '')
  )
  returning id into v_pago_id;

  select r.cuotas_pagadas, r.cuotas_pendientes
  into v_cuotas_pagadas, v_cuotas_pendientes
  from public.recalcular_pagos_credito(p_credito_id) as r;

  select pg.cuotas_aplicadas, pg.remanente
  into v_pago_cuotas_aplicadas, v_pago_remanente
  from public.pagos as pg
  where pg.id = v_pago_id;

  return query select
    v_pago_id,
    v_pago_cuotas_aplicadas,
    v_pago_remanente,
    v_cuotas_pagadas,
    v_cuotas_pendientes;
end;
$$;

commit;
