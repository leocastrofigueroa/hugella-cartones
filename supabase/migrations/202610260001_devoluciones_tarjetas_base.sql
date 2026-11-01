begin;

-- ============================================================
-- 1. ACCIONES FINANCIERAS AUDITADAS
-- ============================================================

alter table public.operaciones_financieras_compras
  drop constraint operaciones_financieras_compras_accion_check;

alter table public.operaciones_financieras_compras
  add constraint operaciones_financieras_compras_accion_check
  check (
    accion in (
      'TARJETA',
      'PERIODO',
      'FINANCIACION',
      'PRIMER_PERIODO',
      'PAGO_RESUMEN',
      'COMPRA_FINANCIADA',
      'EDICION_TARJETA',
      'ANULACION_COMPRA',
      'CORTE_HISTORICO',
      'IMPORTACION_COMPRA_HISTORICA',
      'CANCELACION_FINANCIERA_COMPRA',
      'DEVOLUCION_TARJETA',
      'ACREDITACION_DEVOLUCION_TARJETA',
      'CANCELACION_DEVOLUCION_TARJETA'
    )
  );


-- ============================================================
-- 2. CLAVES COMPUESTAS AUXILIARES
--
-- Permiten que PostgreSQL compruebe que:
-- - una obligación pertenece a la compra indicada;
-- - un tramo pertenece a la compra y tarjeta indicadas.
--
-- No alteran datos existentes.
-- ============================================================

create unique index if not exists
  obligaciones_tarjetas_id_compra_uidx
on public.obligaciones_tarjetas(id, compra_id);

create unique index if not exists
  tramos_pago_compras_id_compra_tarjeta_uidx
on public.tramos_pago_compras(id, compra_id, tarjeta_id);


-- ============================================================
-- 3. CANCELACIÓN FINANCIERA DE COMPRA
--
-- No elimina ni modifica la compra original.
-- Registra el hecho histórico de que fue cancelada/devuelta.
-- ============================================================

create table public.cancelaciones_financieras_compras (
  compra_id uuid primary key
    references public.compras_gastos(id)
    on delete restrict,

  operacion_id uuid not null unique
    references public.operaciones_financieras_compras(operacion_id)
    on delete restrict
    deferrable initially deferred,

  fecha_cancelacion date not null
    check (isfinite(fecha_cancelacion)),

  motivo text not null
    check (
      motivo = btrim(motivo)
      and length(motivo) between 1 and 1000
    ),

  observaciones text
    check (
      observaciones is null
      or length(observaciones) <= 4000
    ),

  created_at timestamptz not null
    default clock_timestamp(),

  actor_id uuid not null
    references auth.users(id)
    on delete restrict
);

alter table public.cancelaciones_financieras_compras
  owner to postgres;

alter table public.cancelaciones_financieras_compras
  enable row level security;

revoke all
on table public.cancelaciones_financieras_compras
from public, anon, authenticated, service_role;


-- ============================================================
-- 4. OBLIGACIONES / CUOTAS CANCELADAS
--
-- La obligación original permanece en obligaciones_tarjetas.
-- Esta tabla indica que ya no debe formar parte de la
-- proyección financiera futura.
-- ============================================================

create table public.cancelaciones_obligaciones_tarjeta (
  obligacion_id uuid primary key,

  compra_id uuid not null,

  created_at timestamptz not null
    default clock_timestamp(),

  actor_id uuid not null
    references auth.users(id)
    on delete restrict,

  foreign key (obligacion_id, compra_id)
    references public.obligaciones_tarjetas(id, compra_id)
    on delete restrict,

  foreign key (compra_id)
    references public.cancelaciones_financieras_compras(compra_id)
    on delete restrict
);

alter table public.cancelaciones_obligaciones_tarjeta
  owner to postgres;

alter table public.cancelaciones_obligaciones_tarjeta
  enable row level security;

revoke all
on table public.cancelaciones_obligaciones_tarjeta
from public, anon, authenticated, service_role;

create index cancelaciones_obligaciones_tarjeta_compra_idx
  on public.cancelaciones_obligaciones_tarjeta(compra_id);


-- ============================================================
-- 5. DEVOLUCIÓN ESPERADA
--
-- Representa el dinero cuya devolución esperamos.
-- Por sí sola NO reduce el saldo de la tarjeta.
--
-- El estado se calculará después:
--
-- PENDIENTE   = acreditado 0
-- PARCIAL     = acreditado > 0 y < esperado
-- ACREDITADA  = acreditado = esperado
-- CANCELADA   = existe cancelación explícita
-- ============================================================

create table public.devoluciones_tarjetas (
  id uuid primary key
    default gen_random_uuid(),

  compra_id uuid not null,

  tramo_id uuid not null,

  tarjeta_id uuid not null,

  operacion_id uuid not null unique
    references public.operaciones_financieras_compras(operacion_id)
    on delete restrict
    deferrable initially deferred,

  importe_esperado numeric not null
    check (
      importe_esperado > 0
      and importe_esperado < 1000000000000000000
      and importe_esperado = round(importe_esperado, 2)
    ),

  fecha_solicitud date not null
    check (isfinite(fecha_solicitud)),

  motivo text not null
    check (
      motivo = btrim(motivo)
      and length(motivo) between 1 and 1000
    ),

  observaciones text
    check (
      observaciones is null
      or length(observaciones) <= 4000
    ),

  created_at timestamptz not null
    default clock_timestamp(),

  actor_id uuid not null
    references auth.users(id)
    on delete restrict,

  foreign key (tramo_id, compra_id, tarjeta_id)
    references public.tramos_pago_compras(id, compra_id, tarjeta_id)
    on delete restrict,

  unique(id, tarjeta_id)
);

alter table public.devoluciones_tarjetas
  owner to postgres;

alter table public.devoluciones_tarjetas
  enable row level security;

revoke all
on table public.devoluciones_tarjetas
from public, anon, authenticated, service_role;

create index devoluciones_tarjetas_compra_idx
  on public.devoluciones_tarjetas(compra_id);

create index devoluciones_tarjetas_tramo_idx
  on public.devoluciones_tarjetas(tramo_id);


-- ============================================================
-- 6. CANCELACIÓN DE UNA DEVOLUCIÓN ESPERADA
--
-- Ejemplo:
-- se esperaba devolución pero el comercio rechaza finalmente
-- el reintegro.
--
-- No modificamos la devolución original: agregamos otro hecho
-- histórico.
-- ============================================================

create table public.cancelaciones_devoluciones_tarjetas (
  devolucion_id uuid primary key
    references public.devoluciones_tarjetas(id)
    on delete restrict,

  operacion_id uuid not null unique
    references public.operaciones_financieras_compras(operacion_id)
    on delete restrict
    deferrable initially deferred,

  fecha_cancelacion date not null
    check (isfinite(fecha_cancelacion)),

  motivo text not null
    check (
      motivo = btrim(motivo)
      and length(motivo) between 1 and 1000
    ),

  observaciones text
    check (
      observaciones is null
      or length(observaciones) <= 4000
    ),

  created_at timestamptz not null
    default clock_timestamp(),

  actor_id uuid not null
    references auth.users(id)
    on delete restrict
);

alter table public.cancelaciones_devoluciones_tarjetas
  owner to postgres;

alter table public.cancelaciones_devoluciones_tarjetas
  enable row level security;

revoke all
on table public.cancelaciones_devoluciones_tarjetas
from public, anon, authenticated, service_role;


-- ============================================================
-- 7. ACREDITACIONES REALES
--
-- Cada fila representa un crédito que REALMENTE apareció
-- en el resumen de la tarjeta.
--
-- Una devolución puede acreditarse en uno o varios movimientos.
-- ============================================================

create table public.acreditaciones_devoluciones_tarjetas (
  id uuid primary key
    default gen_random_uuid(),

  devolucion_id uuid not null,

  tarjeta_id uuid not null,

  periodo_id uuid not null,

  operacion_id uuid not null unique
    references public.operaciones_financieras_compras(operacion_id)
    on delete restrict
    deferrable initially deferred,

  fecha_acreditacion date not null
    check (isfinite(fecha_acreditacion)),

  importe numeric not null
    check (
      importe > 0
      and importe < 1000000000000000000
      and importe = round(importe, 2)
    ),

  referencia text
    check (
      referencia is null
      or length(referencia) <= 1000
    ),

  created_at timestamptz not null
    default clock_timestamp(),

  actor_id uuid not null
    references auth.users(id)
    on delete restrict,

  foreign key (devolucion_id, tarjeta_id)
    references public.devoluciones_tarjetas(id, tarjeta_id)
    on delete restrict,

  foreign key (periodo_id, tarjeta_id)
    references public.periodos_tarjetas(id, tarjeta_id)
    on delete restrict
);

alter table public.acreditaciones_devoluciones_tarjetas
  owner to postgres;

alter table public.acreditaciones_devoluciones_tarjetas
  enable row level security;

revoke all
on table public.acreditaciones_devoluciones_tarjetas
from public, anon, authenticated, service_role;

create index acreditaciones_devoluciones_periodo_idx
  on public.acreditaciones_devoluciones_tarjetas(periodo_id);

create index acreditaciones_devoluciones_devolucion_idx
  on public.acreditaciones_devoluciones_tarjetas(devolucion_id);


-- ============================================================
-- 8. PROTECCIÓN DE HISTORIAL
--
-- Estas tablas son hechos financieros.
-- No se corrigen reescribiendo historia.
-- Las correcciones posteriores se representarán mediante
-- nuevas operaciones.
-- ============================================================

create function public.proteger_registro_financiero_inmutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'El registro financiero es inmutable';
end;
$$;


create trigger cancelacion_financiera_compra_inmutable
before update or delete
on public.cancelaciones_financieras_compras
for each row
execute function public.proteger_registro_financiero_inmutable();


create trigger cancelacion_obligacion_tarjeta_inmutable
before update or delete
on public.cancelaciones_obligaciones_tarjeta
for each row
execute function public.proteger_registro_financiero_inmutable();


create trigger devolucion_tarjeta_inmutable
before update or delete
on public.devoluciones_tarjetas
for each row
execute function public.proteger_registro_financiero_inmutable();


create trigger cancelacion_devolucion_tarjeta_inmutable
before update or delete
on public.cancelaciones_devoluciones_tarjetas
for each row
execute function public.proteger_registro_financiero_inmutable();


create trigger acreditacion_devolucion_tarjeta_inmutable
before update or delete
on public.acreditaciones_devoluciones_tarjetas
for each row
execute function public.proteger_registro_financiero_inmutable();



-- ============================================================
-- 9. PROTECCIÓN CONTRA SOBREACREDITACIÓN
--
-- La suma de créditos reales nunca puede superar
-- el importe esperado de la devolución.
-- ============================================================

create function public.validar_acreditacion_devolucion_tarjeta()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_esperado numeric;
  v_acreditado numeric;
begin
  -- Bloqueamos la devolución para evitar dos acreditaciones
  -- simultáneas que juntas superen el importe esperado.
  select d.importe_esperado
    into v_esperado
  from public.devoluciones_tarjetas d
  where d.id = new.devolucion_id
  for update;

  if not found then
    raise exception 'Devolución inexistente'
      using errcode = '23503';
  end if;

  if exists (
    select 1
    from public.cancelaciones_devoluciones_tarjetas c
    where c.devolucion_id = new.devolucion_id
  ) then
    raise exception 'La devolución está cancelada'
      using errcode = '23514';
  end if;

  select coalesce(sum(a.importe), 0)
    into v_acreditado
  from public.acreditaciones_devoluciones_tarjetas a
  where a.devolucion_id = new.devolucion_id;

  if v_acreditado + new.importe > v_esperado then
    raise exception
      'La acreditación excede el importe esperado de la devolución'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger validar_acreditacion_devolucion_tarjeta
before insert
on public.acreditaciones_devoluciones_tarjetas
for each row
execute function public.validar_acreditacion_devolucion_tarjeta();


commit;
