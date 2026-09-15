begin;

-- Configuración legal y firma guardada del titular.
create table public.configuracion_contratos (
  id smallint primary key default 1 check (id = 1),
  nombre_comercial text not null,
  titular_nombre text not null,
  titular_cuit text not null,
  domicilio_legal text not null,
  email_contacto text not null,
  firma_titular_ruta text,
  firma_titular_sha256 text,
  firma_registrada_por uuid references auth.users(id),
  firma_registrada_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Cuentas que pueden preparar o aprobar contratos.
create table public.autorizados_contratos (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nombre text not null,
  puede_preparar boolean not null default true,
  puede_aprobar boolean not null default false,
  autorizado_por_titular_at timestamptz,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

-- Cada fila conserva una copia exacta de todos los datos aceptados.
create table public.contratos (
  id uuid primary key default gen_random_uuid(),
  credito_id uuid not null references public.creditos(id),
  access_token uuid not null default gen_random_uuid() unique,

  estado text not null default 'BORRADOR'
    check (
      estado in (
        'BORRADOR',
        'PENDIENTE_APROBACION',
        'APROBADO',
        'ENVIADO',
        'VISTO',
        'FIRMADO',
        'RECHAZADO',
        'REVOCACION_SOLICITADA',
        'REVOCADO',
        'ANULADO'
      )
    ),

  -- Copia de los datos del vendedor.
  vendedor_nombre_comercial text not null,
  vendedor_titular_nombre text not null,
  vendedor_titular_cuit text not null,
  vendedor_domicilio text not null,
  vendedor_email text not null,

  -- Copia de los datos del cliente.
  cliente_nombre text not null,
  cliente_dni text,
  cliente_telefono text,
  cliente_email text,
  cliente_rubro text,
  cliente_domicilio_particular text,
  cliente_domicilio_comercial text,
  domicilio_entrega text,
  domicilio_cobro text,

  -- Datos de la operación.
  producto text not null,
  cantidad_producto integer not null default 1
    check (cantidad_producto > 0),
  numero_serie text,
  observaciones_entrega text,
  producto_exhibido boolean,

  fecha_contrato date not null default current_date,
  fecha_entrega_prevista date,
  fecha_entrega_real date,

  precio_contado numeric,
  anticipo numeric not null default 0,
  monto_financiado numeric,
  precio_total numeric not null check (precio_total >= 0),
  cantidad_cuotas integer not null check (cantidad_cuotas > 0),
  importe_cuota numeric not null check (importe_cuota >= 0),
  periodicidad text not null default 'DIARIA',
  tasa_efectiva_anual numeric,
  costo_financiero_total numeric,
  gastos_administrativos numeric,

  -- El texto queda congelado para saber qué versión aceptó el cliente.
  version_condiciones text not null,
  condiciones_texto text not null,

  -- Aprobación y firma de HUGELLA.
  aprobado_por uuid references auth.users(id),
  aprobado_at timestamptz,
  firma_empresa_ruta text,
  firma_empresa_sha256 text,

  -- Firma y evidencia del cliente.
  cliente_acepto_condiciones boolean not null default false,
  texto_aceptacion text,
  firma_cliente_ruta text,
  firma_cliente_sha256 text,
  firmado_at timestamptz,
  firma_ip inet,
  firma_user_agent text,

  -- Documento final cerrado.
  documento_snapshot jsonb,
  pdf_ruta text,
  pdf_sha256 text,

  enviado_at timestamptz,
  visto_at timestamptz,
  revocacion_solicitada_at timestamptz,
  revocado_at timestamptz,
  anulado_at timestamptz,

  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Historial inalterable de acciones sobre cada contrato.
create table public.eventos_contrato (
  id bigint generated always as identity primary key,
  contrato_id uuid not null
    references public.contratos(id) on delete cascade,
  evento text not null,
  actor_tipo text not null
    check (actor_tipo in ('ADMIN', 'CLIENTE', 'SISTEMA')),
  actor_user_id uuid references auth.users(id),
  ip inet,
  user_agent text,
  detalles jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index contratos_credito_id_idx
  on public.contratos (credito_id);

create index contratos_estado_idx
  on public.contratos (estado);

create index eventos_contrato_contrato_id_created_at_idx
  on public.eventos_contrato (contrato_id, created_at);

-- Nadie accede directamente a estas tablas desde el navegador.
-- Más adelante crearemos funciones limitadas para cada operación.
alter table public.configuracion_contratos enable row level security;
alter table public.autorizados_contratos enable row level security;
alter table public.contratos enable row level security;
alter table public.eventos_contrato enable row level security;

revoke all on table public.configuracion_contratos
  from public, anon, authenticated;
revoke all on table public.autorizados_contratos
  from public, anon, authenticated;
revoke all on table public.contratos
  from public, anon, authenticated;
revoke all on table public.eventos_contrato
  from public, anon, authenticated;

commit;
