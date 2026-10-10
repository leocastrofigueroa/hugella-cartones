-- 11D.1: estructura local para revisión; sin RPCs ni carga histórica.
-- Las tablas quedan cerradas hasta habilitar operaciones auditadas en 11D.2.
begin;

create table public.proveedores (
  id uuid primary key default gen_random_uuid(),
  nombre text not null constraint proveedores_nombre_check check (length(btrim(nombre)) > 0),
  identificacion_fiscal text,
  contacto text,
  observaciones text,
  activo boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  actor_id uuid not null references auth.users(id) on delete restrict
);

create table public.compras_gastos (
  id uuid primary key default gen_random_uuid(),
  tipo text not null constraint compras_gastos_tipo_check check (tipo in ('MERCADERIA', 'GASTO')),
  proveedor_id uuid not null references public.proveedores(id) on delete restrict,
  fecha date not null constraint compras_gastos_fecha_check check (isfinite(fecha)),
  moneda text not null constraint compras_gastos_moneda_check check (moneda ~ '^[A-Z]{3}$'),
  comprobante text,
  observaciones text,
  created_at timestamptz not null default clock_timestamp(),
  actor_id uuid not null references auth.users(id) on delete restrict
);

create table public.items_compras_gastos (
  id uuid primary key default gen_random_uuid(),
  compra_gasto_id uuid not null references public.compras_gastos(id) on delete restrict,
  posicion integer not null constraint items_compras_gastos_posicion_check check (posicion > 0),
  descripcion text not null constraint items_compras_gastos_descripcion_check check (length(btrim(descripcion)) > 0),
  -- NUMERIC sin typmod: rechazar exceso de precisión, no redondearlo silenciosamente.
  cantidad numeric not null constraint items_compras_gastos_cantidad_check check (
    cantidad > 0 and cantidad < 1000000000000 and cantidad = round(cantidad, 6)),
  costo_unitario numeric not null constraint items_compras_gastos_costo_check check (
    costo_unitario >= 0 and costo_unitario < 1000000000000 and costo_unitario = round(costo_unitario, 6)),
  total numeric generated always as (round(cantidad * costo_unitario, 2)) stored
    constraint items_compras_gastos_total_check check (total <= 9999999999999999.99),
  created_at timestamptz not null default clock_timestamp(),
  constraint items_compras_gastos_compra_posicion_unique unique (compra_gasto_id, posicion)
);

create index compras_gastos_proveedor_idx on public.compras_gastos(proveedor_id);
-- UNIQUE(compra_gasto_id, posicion) ya cubre búsquedas por la FK del ítem.

alter table public.proveedores owner to postgres;
alter table public.compras_gastos owner to postgres;
alter table public.items_compras_gastos owner to postgres;

alter table public.proveedores enable row level security;
alter table public.compras_gastos enable row level security;
alter table public.items_compras_gastos enable row level security;

revoke all on table public.proveedores, public.compras_gastos, public.items_compras_gastos
  from public, anon, authenticated, service_role;

commit;
