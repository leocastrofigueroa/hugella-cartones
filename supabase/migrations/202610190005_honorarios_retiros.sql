begin;

create table public.honorarios_retiros (
  id uuid primary key default gen_random_uuid(),

  operacion_id uuid not null
    constraint honorarios_retiros_operacion_unique unique,

  fecha date not null
    constraint honorarios_retiros_fecha_check
    check (isfinite(fecha)),

  persona text not null
    constraint honorarios_retiros_persona_check
    check (length(btrim(persona)) between 1 and 120),

  tipo text not null
    constraint honorarios_retiros_tipo_check
    check (
      tipo in (
        'HONORARIO',
        'ADELANTO',
        'RETIRO_EXTRAORDINARIO'
      )
    ),

  importe numeric(16,2) not null
    constraint honorarios_retiros_importe_check
    check (
      importe > 0
      and importe <= 99999999999999.99
    ),

  medio text not null
    constraint honorarios_retiros_medio_check
    check (
      medio in (
        'EFECTIVO',
        'TRANSFERENCIA',
        'OTRO'
      )
    ),

  observaciones text
    constraint honorarios_retiros_observaciones_check
    check (
      observaciones is null
      or length(observaciones) <= 2000
    ),

  actor_id uuid not null
    references auth.users(id)
    on delete restrict,

  created_at timestamptz not null
    default clock_timestamp()
);

alter table public.honorarios_retiros
owner to postgres;

create index honorarios_retiros_fecha_idx
on public.honorarios_retiros(fecha desc, created_at desc);

create index honorarios_retiros_persona_idx
on public.honorarios_retiros(persona);


create table public.anulaciones_honorarios_retiros (
  honorario_retiro_id uuid primary key
    references public.honorarios_retiros(id)
    on delete restrict,

  operacion_id uuid not null
    constraint anulaciones_honorarios_retiros_operacion_unique unique,

  motivo text not null
    constraint anulaciones_honorarios_retiros_motivo_check
    check (length(btrim(motivo)) between 1 and 1000),

  actor_id uuid not null
    references auth.users(id)
    on delete restrict,

  created_at timestamptz not null
    default clock_timestamp()
);

alter table public.anulaciones_honorarios_retiros
owner to postgres;


alter table public.honorarios_retiros
enable row level security;

alter table public.anulaciones_honorarios_retiros
enable row level security;

revoke all
on table
  public.honorarios_retiros,
  public.anulaciones_honorarios_retiros
from public, anon, authenticated, service_role;


create function public.proteger_honorario_retiro()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception
    'Los honorarios, retiros y anulaciones no se modifican ni eliminan directamente'
    using errcode = '55000';
end;
$$;

alter function public.proteger_honorario_retiro()
owner to postgres;

revoke all
on function public.proteger_honorario_retiro()
from public, anon, authenticated, service_role;


create trigger honorario_retiro_inmutable
before update or delete
on public.honorarios_retiros
for each row
execute function public.proteger_honorario_retiro();

create trigger anulacion_honorario_retiro_inmutable
before update or delete
on public.anulaciones_honorarios_retiros
for each row
execute function public.proteger_honorario_retiro();


create function public.registrar_honorario_retiro_admin(
  p_operacion_id uuid,
  p_fecha date,
  p_persona text,
  p_tipo text,
  p_importe numeric,
  p_medio text,
  p_observaciones text default null
)
returns table(
  id uuid,
  operacion_id uuid,
  fecha date,
  persona text,
  tipo text,
  importe numeric,
  medio text,
  observaciones text,
  actor_id uuid,
  created_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_persona text := nullif(btrim(p_persona), '');
  v_tipo text := upper(nullif(btrim(p_tipo), ''));
  v_medio text := upper(nullif(btrim(p_medio), ''));
  v_observaciones text := nullif(btrim(p_observaciones), '');
  v_existente public.honorarios_retiros%rowtype;
begin
  if auth.uid() is null
     or public.es_admin_hugella() is not true then
    raise exception 'No autorizado'
      using errcode = '42501';
  end if;

  if p_operacion_id is null then
    raise exception 'Operación obligatoria'
      using errcode = '22023';
  end if;

  if p_fecha is null or not isfinite(p_fecha) then
    raise exception 'Fecha inválida'
      using errcode = '22023';
  end if;

  if v_persona is null
     or length(v_persona) > 120 then
    raise exception 'Persona inválida'
      using errcode = '22023';
  end if;

  if v_tipo not in (
    'HONORARIO',
    'ADELANTO',
    'RETIRO_EXTRAORDINARIO'
  ) then
    raise exception 'Tipo de retiro inválido'
      using errcode = '22023';
  end if;

  if p_importe is null
     or p_importe <= 0
     or p_importe > 99999999999999.99 then
    raise exception 'Importe inválido'
      using errcode = '22023';
  end if;

  if v_medio not in (
    'EFECTIVO',
    'TRANSFERENCIA',
    'OTRO'
  ) then
    raise exception 'Medio inválido'
      using errcode = '22023';
  end if;

  if v_observaciones is not null
     and length(v_observaciones) > 2000 then
    raise exception
      'Las observaciones no pueden superar los 2000 caracteres'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'hugella:honorario-retiro:' || p_operacion_id::text,
      0
    )
  );

  select hr.*
  into v_existente
  from public.honorarios_retiros hr
  where hr.operacion_id = p_operacion_id;

  if found then
    if
      v_existente.fecha = p_fecha
      and v_existente.persona = v_persona
      and v_existente.tipo = v_tipo
      and v_existente.importe = p_importe
      and v_existente.medio = v_medio
      and v_existente.observaciones is not distinct from v_observaciones
    then
      return query
        select
          hr.id,
          hr.operacion_id,
          hr.fecha,
          hr.persona,
          hr.tipo,
          hr.importe,
          hr.medio,
          hr.observaciones,
          hr.actor_id,
          hr.created_at
        from public.honorarios_retiros hr
        where hr.id = v_existente.id;

      return;
    end if;

    raise exception
      'La operación ya fue utilizada para otro retiro'
      using errcode = '23505';
  end if;

  insert into public.honorarios_retiros (
    operacion_id,
    fecha,
    persona,
    tipo,
    importe,
    medio,
    observaciones,
    actor_id
  )
  values (
    p_operacion_id,
    p_fecha,
    v_persona,
    v_tipo,
    p_importe,
    v_medio,
    v_observaciones,
    auth.uid()
  );

  return query
    select
      hr.id,
      hr.operacion_id,
      hr.fecha,
      hr.persona,
      hr.tipo,
      hr.importe,
      hr.medio,
      hr.observaciones,
      hr.actor_id,
      hr.created_at
    from public.honorarios_retiros hr
    where hr.operacion_id = p_operacion_id;
end;
$$;

alter function public.registrar_honorario_retiro_admin(
  uuid,
  date,
  text,
  text,
  numeric,
  text,
  text
)
owner to postgres;

revoke all
on function public.registrar_honorario_retiro_admin(
  uuid,
  date,
  text,
  text,
  numeric,
  text,
  text
)
from public, anon, authenticated, service_role;

grant execute
on function public.registrar_honorario_retiro_admin(
  uuid,
  date,
  text,
  text,
  numeric,
  text,
  text
)
to authenticated, service_role;


create function public.anular_honorario_retiro_admin(
  p_honorario_retiro_id uuid,
  p_operacion_id uuid,
  p_motivo text
)
returns table(
  honorario_retiro_id uuid,
  motivo text,
  actor_id uuid,
  created_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_motivo text := nullif(btrim(p_motivo), '');
  v_existente public.anulaciones_honorarios_retiros%rowtype;
begin
  if auth.uid() is null
     or public.es_admin_hugella() is not true then
    raise exception 'No autorizado'
      using errcode = '42501';
  end if;

  if p_honorario_retiro_id is null then
    raise exception 'Movimiento obligatorio'
      using errcode = '22023';
  end if;

  if p_operacion_id is null then
    raise exception 'Operación obligatoria'
      using errcode = '22023';
  end if;

  if v_motivo is null
     or length(v_motivo) > 1000 then
    raise exception 'Motivo de anulación inválido'
      using errcode = '22023';
  end if;

  perform 1
  from public.honorarios_retiros hr
  where hr.id = p_honorario_retiro_id
  for update;

  if not found then
    raise exception 'Movimiento inexistente'
      using errcode = 'P0002';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'hugella:anulacion-honorario-retiro:' || p_operacion_id::text,
      0
    )
  );

  select a.*
  into v_existente
  from public.anulaciones_honorarios_retiros a
  where a.operacion_id = p_operacion_id
     or a.honorario_retiro_id = p_honorario_retiro_id
  order by
    case
      when a.operacion_id = p_operacion_id then 0
      else 1
    end
  limit 1;

  if found then
    if
      v_existente.honorario_retiro_id = p_honorario_retiro_id
      and v_existente.motivo = v_motivo
    then
      return query
        select
          a.honorario_retiro_id,
          a.motivo,
          a.actor_id,
          a.created_at
        from public.anulaciones_honorarios_retiros a
        where a.honorario_retiro_id = p_honorario_retiro_id;

      return;
    end if;

    raise exception
      'El movimiento ya fue anulado o la operación ya fue utilizada'
      using errcode = '23505';
  end if;

  insert into public.anulaciones_honorarios_retiros (
    honorario_retiro_id,
    operacion_id,
    motivo,
    actor_id
  )
  values (
    p_honorario_retiro_id,
    p_operacion_id,
    v_motivo,
    auth.uid()
  );

  return query
    select
      a.honorario_retiro_id,
      a.motivo,
      a.actor_id,
      a.created_at
    from public.anulaciones_honorarios_retiros a
    where a.honorario_retiro_id = p_honorario_retiro_id;
end;
$$;

alter function public.anular_honorario_retiro_admin(
  uuid,
  uuid,
  text
)
owner to postgres;

revoke all
on function public.anular_honorario_retiro_admin(
  uuid,
  uuid,
  text
)
from public, anon, authenticated, service_role;

grant execute
on function public.anular_honorario_retiro_admin(
  uuid,
  uuid,
  text
)
to authenticated, service_role;


create function public.listar_honorarios_retiros_admin()
returns table(
  id uuid,
  fecha date,
  persona text,
  tipo text,
  importe numeric,
  medio text,
  observaciones text,
  estado text,
  actor_id uuid,
  actor_email text,
  created_at timestamptz,
  motivo_anulacion text,
  anulado_por uuid,
  anulado_por_email text,
  anulado_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null
     or public.es_admin_hugella() is not true then
    raise exception 'No autorizado'
      using errcode = '42501';
  end if;

  return query
    select
      hr.id,
      hr.fecha,
      hr.persona,
      hr.tipo,
      hr.importe,
      hr.medio,
      hr.observaciones,
      case
        when a.honorario_retiro_id is null then 'VALIDO'
        else 'ANULADO'
      end::text,
      hr.actor_id,
      creador.email::text,
      hr.created_at,
      a.motivo,
      a.actor_id,
      anulador.email::text,
      a.created_at
    from public.honorarios_retiros hr
    join auth.users creador
      on creador.id = hr.actor_id
    left join public.anulaciones_honorarios_retiros a
      on a.honorario_retiro_id = hr.id
    left join auth.users anulador
      on anulador.id = a.actor_id
    order by
      hr.fecha desc,
      hr.created_at desc,
      hr.id desc;
end;
$$;

alter function public.listar_honorarios_retiros_admin()
owner to postgres;

revoke all
on function public.listar_honorarios_retiros_admin()
from public, anon, authenticated, service_role;

grant execute
on function public.listar_honorarios_retiros_admin()
to authenticated, service_role;


create function public.obtener_resumen_honorarios_retiros_admin()
returns table(
  fecha_evaluacion date,
  inicio_mes date,
  inicio_ano date,
  retirado_mes numeric,
  retirado_ano numeric,
  movimientos_mes bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_hoy date := public.hugella_fecha_comercial();
  v_inicio_mes date;
  v_inicio_ano date;
begin
  if auth.uid() is null
     or public.es_admin_hugella() is not true then
    raise exception 'No autorizado'
      using errcode = '42501';
  end if;

  v_inicio_mes :=
    pg_catalog.date_trunc('month', v_hoy)::date;

  v_inicio_ano :=
    pg_catalog.date_trunc('year', v_hoy)::date;

  return query
    select
      v_hoy,
      v_inicio_mes,
      v_inicio_ano,

      coalesce(
        sum(hr.importe)
          filter (
            where hr.fecha >= v_inicio_mes
              and hr.fecha <= v_hoy
              and a.honorario_retiro_id is null
          ),
        0
      )::numeric,

      coalesce(
        sum(hr.importe)
          filter (
            where hr.fecha >= v_inicio_ano
              and hr.fecha <= v_hoy
              and a.honorario_retiro_id is null
          ),
        0
      )::numeric,

      count(*)
        filter (
          where hr.fecha >= v_inicio_mes
            and hr.fecha <= v_hoy
            and a.honorario_retiro_id is null
        )::bigint

    from public.honorarios_retiros hr
    left join public.anulaciones_honorarios_retiros a
      on a.honorario_retiro_id = hr.id;
end;
$$;

alter function public.obtener_resumen_honorarios_retiros_admin()
owner to postgres;

revoke all
on function public.obtener_resumen_honorarios_retiros_admin()
from public, anon, authenticated, service_role;

grant execute
on function public.obtener_resumen_honorarios_retiros_admin()
to authenticated, service_role;

commit;
