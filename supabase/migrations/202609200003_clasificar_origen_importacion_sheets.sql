begin;

-- Conserva el contrato completo de la sobrecarga. Solo clasifica el origen de
-- las escrituras futuras según exista una referencia de importacion efectiva.
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
    referencia_importacion,
    origen
  )
  values (
    v_credito_id,
    p_fecha_pago,
    p_importe,
    trim(p_medio_pago),
    0,
    0,
    nullif(trim(coalesce(p_observaciones, '')), ''),
    v_referencia,
    case when v_referencia is not null then 'SHEETS' else 'ADMIN' end
  )
  returning id into v_pago_id;

  perform public.recalcular_pagos_credito(v_credito_id);

  return v_pago_id;
end;
$$;

commit;
