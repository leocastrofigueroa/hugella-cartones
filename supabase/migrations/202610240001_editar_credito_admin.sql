begin;

create table public.cambios_creditos_admin (
  operacion_id uuid primary key,
  credito_id uuid not null references public.creditos(id) on delete restrict,
  valor_anterior jsonb not null
    check (jsonb_typeof(valor_anterior) = 'object'),
  valor_nuevo jsonb not null
    check (jsonb_typeof(valor_nuevo) = 'object'),
  actor_id uuid not null references auth.users(id) on delete restrict,
  motivo text not null
    check (length(btrim(motivo)) between 1 and 1000),
  solicitud jsonb not null
    check (jsonb_typeof(solicitud) = 'object'),
  created_at timestamptz not null default clock_timestamp()
);

create index cambios_creditos_admin_credito_idx
  on public.cambios_creditos_admin(credito_id, created_at desc);

alter table public.cambios_creditos_admin owner to postgres;
alter table public.cambios_creditos_admin enable row level security;

revoke all on table public.cambios_creditos_admin
  from public, anon, authenticated, service_role;


create function public.proteger_cambio_credito_admin()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'La auditoría de modificaciones de créditos es inmutable'
    using errcode = '23514';
end;
$$;

alter function public.proteger_cambio_credito_admin()
  owner to postgres;

revoke all on function public.proteger_cambio_credito_admin()
  from public, anon, authenticated, service_role;

create trigger cambios_creditos_admin_inmutables
before update or delete
on public.cambios_creditos_admin
for each row
execute function public.proteger_cambio_credito_admin();


create function public.editar_credito_admin(
  p_operacion_id uuid,
  p_credito_id uuid,
  p_valor_anterior_esperado jsonb,
  p_producto text,
  p_fecha_inicio date,
  p_cantidad_cuotas integer,
  p_importe_cuota numeric,
  p_inversion numeric,
  p_motivo text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_credito public.creditos%rowtype;
  v_evento public.cambios_creditos_admin%rowtype;

  v_producto text := btrim(coalesce(p_producto, ''));
  v_motivo text := btrim(coalesce(p_motivo, ''));

  v_anterior jsonb;
  v_nuevo jsonb;
  v_solicitud jsonb;

  v_cambia_producto boolean;
  v_cambia_fecha boolean;
  v_cambia_cantidad boolean;
  v_cambia_importe boolean;

  v_hay_pagos_validos boolean;
  v_hay_contrato_activo boolean;
begin
  if v_actor is null
    or public.es_admin_hugella() is not true then
    raise exception 'No autorizado'
      using errcode = '42501';
  end if;

  if p_operacion_id is null
    or p_credito_id is null
    or p_valor_anterior_esperado is null
    or jsonb_typeof(p_valor_anterior_esperado) <> 'object'
    or v_producto = ''
    or p_fecha_inicio is null
    or not isfinite(p_fecha_inicio)
    or p_cantidad_cuotas is null
    or p_cantidad_cuotas <= 0
    or p_importe_cuota is null
    or p_importe_cuota <= 0
    or p_importe_cuota::text in ('NaN', 'Infinity', '-Infinity')
    or (
      p_inversion is not null
      and (
        p_inversion <= 0
        or p_inversion::text in ('NaN', 'Infinity', '-Infinity')
      )
    )
    or v_motivo = ''
    or length(v_motivo) > 1000 then
    raise exception 'Datos de modificación inválidos'
      using errcode = '22023';
  end if;

  if extract(isodow from p_fecha_inicio) = 7 then
    raise exception 'La fecha de entrega no puede ser domingo'
      using errcode = '22023';
  end if;

  v_solicitud := jsonb_build_object(
    'credito_id', p_credito_id,
    'valor_anterior_esperado', p_valor_anterior_esperado,
    'producto', v_producto,
    'fecha_inicio', p_fecha_inicio,
    'cantidad_cuotas', p_cantidad_cuotas,
    'importe_cuota', p_importe_cuota,
    'inversion', p_inversion,
    'motivo', v_motivo
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'hugella:editar_credito:' || p_operacion_id::text,
      0
    )
  );

  select cca.*
  into v_evento
  from public.cambios_creditos_admin as cca
  where cca.operacion_id = p_operacion_id;

  if found then
    if v_evento.actor_id is distinct from v_actor
      or v_evento.solicitud is distinct from v_solicitud then
      raise exception 'El identificador de operación ya fue utilizado con otra solicitud'
        using errcode = '22023';
    end if;

    return jsonb_build_object(
      'operacion_id', v_evento.operacion_id,
      'credito_id', v_evento.credito_id,
      'valor_anterior', v_evento.valor_anterior,
      'valor_nuevo', v_evento.valor_nuevo,
      'motivo', v_evento.motivo,
      'created_at', v_evento.created_at,
      'ya_procesada', true
    );
  end if;

  select cr.*
  into v_credito
  from public.creditos as cr
  where cr.id = p_credito_id
  for update;

  if not found then
    raise exception 'Crédito inexistente'
      using errcode = 'P0002';
  end if;

  v_anterior := jsonb_build_object(
    'producto', v_credito.producto,
    'fecha_inicio', v_credito.fecha_inicio,
    'cantidad_cuotas', v_credito.cantidad_cuotas,
    'importe_cuota', v_credito.importe_cuota,
    'inversion', v_credito.inversion
  );

  if v_anterior is distinct from p_valor_anterior_esperado then
    raise exception 'El crédito cambió desde la última consulta. Volvé a cargar la ficha antes de modificarlo.'
      using errcode = '40001';
  end if;

  v_nuevo := jsonb_build_object(
    'producto', v_producto,
    'fecha_inicio', p_fecha_inicio,
    'cantidad_cuotas', p_cantidad_cuotas,
    'importe_cuota', p_importe_cuota,
    'inversion', p_inversion
  );

  if v_anterior = v_nuevo then
    raise exception 'No hay cambios para guardar'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.cierres_creditos as cc
    where cc.credito_id = p_credito_id
  ) then
    raise exception 'El crédito está cerrado y no puede modificarse'
      using errcode = '23514';
  end if;

  v_cambia_producto :=
    v_credito.producto is distinct from v_producto;

  v_cambia_fecha :=
    v_credito.fecha_inicio is distinct from p_fecha_inicio;

  v_cambia_cantidad :=
    v_credito.cantidad_cuotas is distinct from p_cantidad_cuotas;

  v_cambia_importe :=
    v_credito.importe_cuota is distinct from p_importe_cuota;

  select exists (
    select 1
    from public.pagos as pg
    where pg.credito_id = p_credito_id
      and pg.estado = 'VALIDO'
  )
  into v_hay_pagos_validos;

  if v_hay_pagos_validos
    and (v_cambia_cantidad or v_cambia_importe) then
    raise exception 'El crédito ya tiene pagos válidos. No se puede modificar la cantidad de cuotas ni el importe de cuota mediante una edición común.'
      using errcode = '23514';
  end if;

  select exists (
    select 1
    from public.contratos as ct
    where ct.credito_id = p_credito_id
      and ct.estado in (
        'BORRADOR',
        'PENDIENTE_APROBACION',
        'APROBADO',
        'ENVIADO',
        'VISTO',
        'FIRMADO',
        'REVOCACION_SOLICITADA'
      )
  )
  into v_hay_contrato_activo;

  if v_hay_contrato_activo
    and (
      v_cambia_producto
      or v_cambia_fecha
      or v_cambia_cantidad
      or v_cambia_importe
    ) then
    raise exception 'El crédito tiene un contrato activo. Los datos contractuales no pueden modificarse desde el editor del crédito.'
      using errcode = '23514';
  end if;

  update public.creditos as cr
  set
    producto = v_producto,
    fecha_inicio = p_fecha_inicio,
    cantidad_cuotas = p_cantidad_cuotas,
    importe_cuota = p_importe_cuota,
    inversion = p_inversion
  where cr.id = p_credito_id;

  if v_cambia_fecha
    or v_cambia_cantidad
    or v_cambia_importe then
    perform public.recalcular_pagos_credito(p_credito_id);
  end if;

  insert into public.cambios_creditos_admin (
    operacion_id,
    credito_id,
    valor_anterior,
    valor_nuevo,
    actor_id,
    motivo,
    solicitud
  )
  values (
    p_operacion_id,
    p_credito_id,
    v_anterior,
    v_nuevo,
    v_actor,
    v_motivo,
    v_solicitud
  )
  returning *
  into v_evento;

  return jsonb_build_object(
    'operacion_id', v_evento.operacion_id,
    'credito_id', v_evento.credito_id,
    'valor_anterior', v_evento.valor_anterior,
    'valor_nuevo', v_evento.valor_nuevo,
    'motivo', v_evento.motivo,
    'created_at', v_evento.created_at,
    'ya_procesada', false
  );
end;
$$;

alter function public.editar_credito_admin(
  uuid,
  uuid,
  jsonb,
  text,
  date,
  integer,
  numeric,
  numeric,
  text
) owner to postgres;

revoke all on function public.editar_credito_admin(
  uuid,
  uuid,
  jsonb,
  text,
  date,
  integer,
  numeric,
  numeric,
  text
) from public, anon, authenticated, service_role;

grant execute on function public.editar_credito_admin(
  uuid,
  uuid,
  jsonb,
  text,
  date,
  integer,
  numeric,
  numeric,
  text
) to authenticated;

commit;
