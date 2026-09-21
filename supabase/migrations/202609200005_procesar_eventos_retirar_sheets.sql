begin;

alter table public.eventos_pagos_sheets
  add column retiro_preparado_at timestamptz;

create function public.reservar_eventos_pagos_sheets(
  p_limite integer default 20
)
returns table(
  evento_id uuid,
  tipo text,
  pago_id uuid,
  operacion_id uuid,
  id_pago_sheets text,
  intentos integer,
  reserva_token uuid,
  reserva_hasta timestamptz,
  retiro_preparado_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.es_admin_hugella() then
    raise exception 'Acceso no autorizado'
      using errcode = '42501';
  end if;

  if p_limite is null or p_limite < 1 or p_limite > 100 then
    raise exception 'El límite debe estar entre 1 y 100'
      using errcode = '22023';
  end if;

  return query
  with candidatos as (
    select ev.id
    from public.eventos_pagos_sheets as ev
    where ev.tipo = 'RETIRAR'
      and (
        ev.estado = 'PENDIENTE'
        or (
          ev.estado = 'EN_PROCESO'
          and ev.reserva_hasta < now()
        )
      )
      and (
        ev.depende_de_evento_id is null
        or exists (
          select 1
          from public.eventos_pagos_sheets as dependencia
          where dependencia.id = ev.depende_de_evento_id
            and dependencia.estado = 'CONFIRMADO'
        )
      )
    order by ev.created_at asc, ev.id asc
    limit p_limite
    for update of ev skip locked
  )
  update public.eventos_pagos_sheets as ev
  set estado = 'EN_PROCESO',
      reserva_token = gen_random_uuid(),
      reserva_hasta = now() + interval '5 minutes',
      intentos = ev.intentos + 1
  from candidatos
  where ev.id = candidatos.id
  returning
    ev.id,
    ev.tipo,
    ev.pago_id,
    ev.operacion_id,
    ev.id_pago_sheets,
    ev.intentos,
    ev.reserva_token,
    ev.reserva_hasta,
    ev.retiro_preparado_at;
end;
$$;

create function public.preparar_retiro_pago_sheets(
  p_evento_id uuid,
  p_reserva_token uuid
)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_evento public.eventos_pagos_sheets%rowtype;
  v_estado_pago text;
  v_retiro_preparado_at timestamptz;
begin
  if auth.uid() is null or not public.es_admin_hugella() then
    raise exception 'Acceso no autorizado'
      using errcode = '42501';
  end if;

  if p_evento_id is null or p_reserva_token is null then
    raise exception 'Evento y token de reserva son obligatorios'
      using errcode = '22023';
  end if;

  select ev.*
  into v_evento
  from public.eventos_pagos_sheets as ev
  where ev.id = p_evento_id
  for update;

  if not found then
    raise exception 'Evento de Sheets no encontrado'
      using errcode = 'P0002';
  end if;
  if v_evento.tipo <> 'RETIRAR' then
    raise exception 'El evento no es de tipo RETIRAR'
      using errcode = '22023';
  end if;
  if v_evento.estado <> 'EN_PROCESO' then
    raise exception 'El evento no está en proceso'
      using errcode = '22023';
  end if;
  if v_evento.reserva_token is distinct from p_reserva_token then
    raise exception 'El token de reserva no es válido'
      using errcode = '22023';
  end if;
  if v_evento.reserva_hasta is null or v_evento.reserva_hasta <= now() then
    raise exception 'La reserva del evento venció'
      using errcode = '22023';
  end if;

  select pg.estado
  into v_estado_pago
  from public.pagos as pg
  where pg.id = v_evento.pago_id;

  if not found then
    raise exception 'Pago del evento no encontrado'
      using errcode = 'P0002';
  end if;
  if v_estado_pago <> 'ANULADO' then
    raise exception 'El pago del evento ya no está anulado'
      using errcode = '22023';
  end if;

  update public.eventos_pagos_sheets as ev
  set retiro_preparado_at = coalesce(ev.retiro_preparado_at, now())
  where ev.id = p_evento_id
  returning ev.retiro_preparado_at into v_retiro_preparado_at;

  return v_retiro_preparado_at;
end;
$$;

create function public.finalizar_evento_pago_sheets(
  p_evento_id uuid,
  p_reserva_token uuid,
  p_resultado text,
  p_detalle text default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_evento public.eventos_pagos_sheets%rowtype;
  v_resultado text;
  v_detalle text;
  v_estado_pago text;
begin
  if auth.uid() is null or not public.es_admin_hugella() then
    raise exception 'Acceso no autorizado'
      using errcode = '42501';
  end if;

  if p_evento_id is null or p_reserva_token is null then
    raise exception 'Evento y token de reserva son obligatorios'
      using errcode = '22023';
  end if;

  v_resultado := upper(nullif(btrim(p_resultado), ''));
  if v_resultado is null
    or v_resultado not in ('CONFIRMAR', 'BLOQUEAR', 'REINTENTAR')
  then
    raise exception 'Resultado de evento inválido'
      using errcode = '22023';
  end if;

  v_detalle := nullif(btrim(p_detalle), '');
  if v_resultado in ('BLOQUEAR', 'REINTENTAR') and v_detalle is null then
    raise exception 'El detalle del error es obligatorio'
      using errcode = '22023';
  end if;

  select ev.*
  into v_evento
  from public.eventos_pagos_sheets as ev
  where ev.id = p_evento_id
  for update;

  if not found then
    raise exception 'Evento de Sheets no encontrado'
      using errcode = 'P0002';
  end if;
  if v_evento.tipo <> 'RETIRAR' then
    raise exception 'El evento no es de tipo RETIRAR'
      using errcode = '22023';
  end if;
  if v_evento.estado <> 'EN_PROCESO' then
    raise exception 'El evento no está en proceso'
      using errcode = '22023';
  end if;
  if v_evento.reserva_token is distinct from p_reserva_token then
    raise exception 'El token de reserva no es válido'
      using errcode = '22023';
  end if;
  if v_evento.reserva_hasta is null or v_evento.reserva_hasta <= now() then
    raise exception 'La reserva del evento venció'
      using errcode = '22023';
  end if;

  if v_resultado = 'CONFIRMAR' then
    if v_evento.retiro_preparado_at is null then
      raise exception 'El retiro no fue preparado'
        using errcode = '22023';
    end if;

    select pg.estado
    into v_estado_pago
    from public.pagos as pg
    where pg.id = v_evento.pago_id;

    if not found then
      raise exception 'Pago del evento no encontrado'
        using errcode = 'P0002';
    end if;
    if v_estado_pago <> 'ANULADO' then
      raise exception 'El pago del evento ya no está anulado'
        using errcode = '22023';
    end if;

    update public.eventos_pagos_sheets as ev
    set estado = 'CONFIRMADO',
        confirmado_at = now(),
        reserva_token = null,
        reserva_hasta = null,
        ultimo_error = null
    where ev.id = p_evento_id;
  elsif v_resultado = 'BLOQUEAR' then
    update public.eventos_pagos_sheets as ev
    set estado = 'BLOQUEADO',
        confirmado_at = null,
        reserva_token = null,
        reserva_hasta = null,
        ultimo_error = v_detalle
    where ev.id = p_evento_id;
  else
    update public.eventos_pagos_sheets as ev
    set estado = 'PENDIENTE',
        confirmado_at = null,
        reserva_token = null,
        reserva_hasta = null,
        ultimo_error = v_detalle
    where ev.id = p_evento_id;
  end if;
end;
$$;

revoke all on function public.reservar_eventos_pagos_sheets(integer)
  from public, anon;
grant execute on function public.reservar_eventos_pagos_sheets(integer)
  to authenticated;

revoke all on function public.preparar_retiro_pago_sheets(uuid, uuid)
  from public, anon;
grant execute on function public.preparar_retiro_pago_sheets(uuid, uuid)
  to authenticated;

revoke all on function public.finalizar_evento_pago_sheets(uuid, uuid, text, text)
  from public, anon;
grant execute on function public.finalizar_evento_pago_sheets(uuid, uuid, text, text)
  to authenticated;

commit;
