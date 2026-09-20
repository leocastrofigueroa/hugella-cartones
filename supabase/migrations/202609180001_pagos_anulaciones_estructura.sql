begin;

-- Estructura solamente: las RPC y la sincronizacion actuales no cambian.
-- Los pagos existentes y los nuevos siguen siendo validos por defecto.
alter table public.pagos
  add column estado text not null default 'VALIDO',
  add column anulado_at timestamptz,
  add column anulado_por uuid,
  add column motivo_anulacion text,
  add column reemplaza_pago_id uuid;

alter table public.pagos
  add constraint pagos_estado_check
    check (estado in ('VALIDO', 'ANULADO')),
  add constraint pagos_anulacion_coherente_check
    check (
      (estado = 'VALIDO'
        and anulado_at is null
        and anulado_por is null
        and motivo_anulacion is null)
      or
      (estado = 'ANULADO'
        and anulado_at is not null
        and anulado_por is not null
        and motivo_anulacion is not null
        and length(btrim(motivo_anulacion)) > 0)
    ),
  add constraint pagos_no_autorreemplazo_check
    check (reemplaza_pago_id is null or reemplaza_pago_id <> id),
  add constraint pagos_anulado_por_fkey
    foreign key (anulado_por) references auth.users(id),
  add constraint pagos_reemplaza_pago_id_fkey
    foreign key (reemplaza_pago_id) references public.pagos(id);

create unique index pagos_reemplaza_pago_id_unique
  on public.pagos (reemplaza_pago_id)
  where reemplaza_pago_id is not null;

-- Un UUID identifica una solicitud de anulacion o correccion para reintentos.
create table public.operaciones_pagos (
  id uuid primary key,
  tipo text not null constraint operaciones_pagos_tipo_valores_check
    check (tipo in ('ANULACION', 'CORRECCION')),
  pago_original_id uuid not null references public.pagos(id),
  pago_nuevo_id uuid references public.pagos(id),
  actor_id uuid not null references auth.users(id),
  motivo text not null check (length(btrim(motivo)) > 0),
  -- La RPC futura comparara esta solicitud con cada reintento del mismo UUID.
  solicitud jsonb not null check (jsonb_typeof(solicitud) = 'object'),
  created_at timestamptz not null default now(),
  constraint operaciones_pagos_tipo_pago_nuevo_coherente_check check (
    (tipo = 'ANULACION' and pago_nuevo_id is null)
    or (tipo = 'CORRECCION' and pago_nuevo_id is not null)
  ),
  constraint operaciones_pagos_pagos_distintos_check
    check (pago_nuevo_id is null or pago_nuevo_id <> pago_original_id),
  constraint operaciones_pagos_nuevo_unico unique (pago_nuevo_id)
);

create index operaciones_pagos_original_created_at_idx
  on public.operaciones_pagos (pago_original_id, created_at);

-- id_pago_sheets queda fijado por evento. No se exige unicidad: los ADM
-- historicos truncados podrian colisionar y deben detectarse antes de operar.
create table public.eventos_pagos_sheets (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('PUBLICAR', 'RETIRAR')),
  pago_id uuid not null references public.pagos(id),
  operacion_id uuid references public.operaciones_pagos(id),
  id_pago_sheets text not null
    check (length(btrim(id_pago_sheets)) > 0),
  estado text not null default 'PENDIENTE'
    check (estado in ('PENDIENTE', 'EN_PROCESO', 'CONFIRMADO', 'BLOQUEADO')),
  depende_de_evento_id uuid references public.eventos_pagos_sheets(id),
  created_at timestamptz not null default now(),
  confirmado_at timestamptz,
  intentos integer not null default 0 check (intentos >= 0),
  ultimo_error text,
  reserva_token uuid,
  reserva_hasta timestamptz,
  constraint eventos_pagos_sheets_no_autodependencia_check
    check (depende_de_evento_id is null or depende_de_evento_id <> id),
  constraint eventos_pagos_sheets_confirmacion_check
    check ((estado = 'CONFIRMADO') = (confirmado_at is not null)),
  constraint eventos_pagos_sheets_reserva_check
    check (
      (estado = 'EN_PROCESO' and reserva_token is not null and reserva_hasta is not null)
      or
      (estado <> 'EN_PROCESO' and reserva_token is null and reserva_hasta is null)
    )
);

create index eventos_pagos_sheets_pendientes_idx
  on public.eventos_pagos_sheets (estado, created_at, id)
  where estado in ('PENDIENTE', 'EN_PROCESO');

create index eventos_pagos_sheets_pago_id_idx
  on public.eventos_pagos_sheets (pago_id);

create unique index eventos_pagos_sheets_operacion_tipo_pago_unique
  on public.eventos_pagos_sheets (operacion_id, tipo, pago_id)
  where operacion_id is not null;

-- Igual que las tablas internas de contratos: solo futuras RPC controladas
-- podran exponer operaciones. No se conceden politicas de acceso directo.
alter table public.operaciones_pagos enable row level security;
alter table public.eventos_pagos_sheets enable row level security;

revoke all on table public.operaciones_pagos
  from public, anon, authenticated;
revoke all on table public.eventos_pagos_sheets
  from public, anon, authenticated;

commit;
