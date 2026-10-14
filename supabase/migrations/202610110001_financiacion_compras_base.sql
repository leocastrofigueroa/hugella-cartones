-- 11D.5.2 LOCAL. Sin carga histórica, tarjetas sembradas ni RPCs de usuario.
-- Baseline declarado: preflight productivo 2026-10-10T22:43:36.799648+00:00.
begin;

do $preflight$
begin
  if to_regclass('public.compras_gastos') is null
    or to_regclass('public.items_compras_gastos') is null then
    raise exception 'Prerequisitos de Compras ausentes';
  end if;
  if exists(select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname in ('financiaciones_compras','tarjetas_credito','periodos_tarjetas',
      'tramos_pago_compras','obligaciones_tarjetas','pagos_resumenes_tarjetas','aplicaciones_pagos_obligaciones')) then
    raise exception 'Objetos financieros existentes: revisión requerida';
  end if;
  if exists(select 1 from pg_catalog.pg_class where oid in ('public.compras_gastos'::regclass,
    'public.items_compras_gastos'::regclass) and (relowner<>'postgres'::regrole or not relrowsecurity)) then
    raise exception 'Seguridad de Compras incompatible';
  end if;
  if not exists(select 1 from pg_catalog.pg_attribute a join pg_catalog.pg_attrdef d
    on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid='public.items_compras_gastos'::regclass
    and a.attname='total' and a.attgenerated='s'
    and pg_catalog.pg_get_expr(d.adbin,d.adrelid)='round((cantidad * costo_unitario), 2)') then
    raise exception 'Cálculo de total incompatible';
  end if;
end;
$preflight$;

create table public.tarjetas_credito (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (nombre=btrim(nombre) and length(nombre)>0),
  entidad text not null check (entidad=btrim(entidad) and length(entidad)>0),
  activo boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  actor_id uuid not null references auth.users(id) on delete restrict
);
create table public.financiaciones_compras (
  compra_id uuid primary key references public.compras_gastos(id) on delete restrict,
  estado text not null default 'BORRADOR' check (estado in ('BORRADOR','CONFIRMADA')),
  created_at timestamptz not null default clock_timestamp(),
  confirmado_at timestamptz,
  actor_id uuid not null references auth.users(id) on delete restrict,
  check ((estado='BORRADOR' and confirmado_at is null) or
    (estado='CONFIRMADA' and confirmado_at is not null and confirmado_at>=created_at))
);
create table public.periodos_tarjetas (
  id uuid primary key default gen_random_uuid(),
  tarjeta_id uuid not null references public.tarjetas_credito(id) on delete restrict,
  orden integer not null check (orden>0),
  fecha_cierre date not null check (isfinite(fecha_cierre)),
  fecha_vencimiento date not null check (isfinite(fecha_vencimiento) and fecha_vencimiento>=fecha_cierre),
  created_at timestamptz not null default clock_timestamp(),
  actor_id uuid not null references auth.users(id) on delete restrict,
  unique(tarjeta_id,orden), unique(tarjeta_id,fecha_cierre), unique(id,tarjeta_id)
);
create table public.tramos_pago_compras (
  id uuid primary key default gen_random_uuid(),
  compra_id uuid not null references public.financiaciones_compras(compra_id) on delete restrict,
  posicion integer not null check (posicion>0),
  medio text not null check (medio in ('EFECTIVO','TRANSFERENCIA','TARJETA_DEBITO','TARJETA_CREDITO')),
  importe numeric not null check (importe>0 and importe<1000000000000000000 and importe=round(importe,2)),
  tarjeta_id uuid references public.tarjetas_credito(id) on delete restrict,
  cantidad_cuotas integer,
  -- El tramo inmediato confirmado es el hecho de pago. No sumar otro pago por él.
  fecha_pago date,
  created_at timestamptz not null default clock_timestamp(),
  check ((medio='TARJETA_CREDITO' and tarjeta_id is not null and cantidad_cuotas is not null and cantidad_cuotas between 1 and 1000
      and cantidad_cuotas<=importe*100 and fecha_pago is null)
    or (medio<>'TARJETA_CREDITO' and tarjeta_id is null and cantidad_cuotas is null
      and fecha_pago is not null and isfinite(fecha_pago))),
  unique(compra_id,posicion), unique(id,compra_id,tarjeta_id,cantidad_cuotas)
);
create table public.obligaciones_tarjetas (
  id uuid primary key default gen_random_uuid(),
  compra_id uuid not null,
  tramo_id uuid not null,
  tarjeta_id uuid not null,
  numero_cuota integer not null,
  cantidad_cuotas integer not null check (cantidad_cuotas between 1 and 1000),
  importe numeric not null check (importe>0 and importe<1000000000000000000 and importe=round(importe,2)),
  periodo_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  check (numero_cuota between 1 and cantidad_cuotas),
  foreign key (tramo_id,compra_id,tarjeta_id,cantidad_cuotas)
    references public.tramos_pago_compras(id,compra_id,tarjeta_id,cantidad_cuotas) on delete restrict,
  foreign key (periodo_id,tarjeta_id) references public.periodos_tarjetas(id,tarjeta_id) on delete restrict,
  unique(tramo_id,numero_cuota), unique(tramo_id,periodo_id)
);
create index obligaciones_tarjetas_compra_idx on public.obligaciones_tarjetas(compra_id);
create index obligaciones_tarjetas_periodo_idx on public.obligaciones_tarjetas(periodo_id) where periodo_id is not null;
create table public.pagos_resumenes_tarjetas (
  id uuid primary key default gen_random_uuid(),
  periodo_id uuid not null references public.periodos_tarjetas(id) on delete restrict,
  fecha_pago date not null check (isfinite(fecha_pago)),
  importe numeric not null check (importe>0 and importe<1000000000000000000 and importe=round(importe,2)),
  origen text not null default 'CAJA_EFECTIVO' check (origen='CAJA_EFECTIVO'),
  referencia text,
  created_at timestamptz not null default clock_timestamp(),
  actor_id uuid not null references auth.users(id) on delete restrict
);
create index pagos_resumenes_tarjetas_periodo_idx on public.pagos_resumenes_tarjetas(periodo_id);
create table public.aplicaciones_pagos_obligaciones (
  pago_id uuid not null references public.pagos_resumenes_tarjetas(id) on delete restrict,
  obligacion_id uuid not null references public.obligaciones_tarjetas(id) on delete restrict,
  importe numeric not null check (importe>0 and importe<1000000000000000000 and importe=round(importe,2)),
  created_at timestamptz not null default clock_timestamp(),
  primary key(pago_id,obligacion_id)
);
create index aplicaciones_pagos_obligaciones_obligacion_idx on public.aplicaciones_pagos_obligaciones(obligacion_id);

-- Validación diferida LOCAL: OLD/NEW conservan todas las identidades afectadas.
-- Los eventos de fila pueden repetir trabajo local, nunca toda la historia.
create function public.validar_financiacion_compras_integridad()
returns trigger language plpgsql security definer set search_path='' as $fn$
declare
  v_row jsonb; v_id uuid;
  v_compras uuid[] := '{}'; v_tramos uuid[] := '{}';
  v_obligaciones uuid[] := '{}'; v_pagos uuid[] := '{}'; v_periodos uuid[] := '{}';
begin
  for v_row in select x from unnest(array[
    case when tg_op<>'INSERT' then to_jsonb(old) end,
    case when tg_op<>'DELETE' then to_jsonb(new) end]) x where x is not null loop
    case tg_table_name
      when 'financiaciones_compras' then
        v_compras:=array_append(v_compras,(v_row->>'compra_id')::uuid);
      when 'tramos_pago_compras' then
        v_compras:=array_append(v_compras,(v_row->>'compra_id')::uuid);
        v_tramos:=array_append(v_tramos,(v_row->>'id')::uuid);
      when 'obligaciones_tarjetas' then
        v_tramos:=array_append(v_tramos,(v_row->>'tramo_id')::uuid);
        v_obligaciones:=array_append(v_obligaciones,(v_row->>'id')::uuid);
      when 'periodos_tarjetas' then
        v_periodos:=array_append(v_periodos,(v_row->>'id')::uuid);
      when 'pagos_resumenes_tarjetas' then
        v_pagos:=array_append(v_pagos,(v_row->>'id')::uuid);
      when 'aplicaciones_pagos_obligaciones' then
        v_pagos:=array_append(v_pagos,(v_row->>'pago_id')::uuid);
        v_obligaciones:=array_append(v_obligaciones,(v_row->>'obligacion_id')::uuid);
      else raise exception 'Tabla de validación no reconocida';
    end case;
  end loop;

  for v_id in select distinct x from unnest(v_compras) x loop
    if exists(select 1 from public.financiaciones_compras f join public.compras_gastos c on c.id=f.compra_id
      where f.compra_id=v_id and f.estado='CONFIRMADA' and (c.moneda<>'ARS'
        or not exists(select 1 from public.items_compras_gastos i where i.compra_gasto_id=v_id)
        or coalesce((select sum(t.importe) from public.tramos_pago_compras t where t.compra_id=v_id),0)
          is distinct from (select sum(i.total) from public.items_compras_gastos i where i.compra_gasto_id=v_id))) then
      raise exception 'Suma de tramos incompatible con total de compra' using errcode='23514';
    end if;
    -- Confirmar cabecera exige validar cada tramo de ESTA compra, no otras.
    v_tramos:=v_tramos || array(select t.id from public.tramos_pago_compras t where t.compra_id=v_id);
  end loop;

  for v_id in select distinct x from unnest(v_periodos) x loop
    if exists(select 1 from public.periodos_tarjetas p
      join public.periodos_tarjetas vecino on vecino.tarjeta_id=p.tarjeta_id and vecino.id<>p.id
      where p.id=v_id and (
        (vecino.orden<p.orden and (vecino.fecha_cierre>=p.fecha_cierre or vecino.fecha_vencimiento>=p.fecha_vencimiento))
        or (vecino.orden>p.orden and (vecino.fecha_cierre<=p.fecha_cierre or vecino.fecha_vencimiento<=p.fecha_vencimiento)))) then
      raise exception 'Fechas de períodos fuera de orden' using errcode='23514';
    end if;
    -- Cambiar el orden de un período puede afectar los tramos vinculados a él.
    v_tramos:=v_tramos || array(select distinct o.tramo_id from public.obligaciones_tarjetas o where o.periodo_id=v_id);
  end loop;

  for v_id in select distinct x from unnest(v_tramos) x loop
    if exists(select 1 from public.tramos_pago_compras t join public.financiaciones_compras f on f.compra_id=t.compra_id
      where t.id=v_id and f.estado='CONFIRMADA' and t.medio='TARJETA_CREDITO'
        and (select count(*) from public.obligaciones_tarjetas o where o.tramo_id=v_id)<>t.cantidad_cuotas) then
      raise exception 'Cantidad de obligaciones incompatible' using errcode='23514';
    end if;
    -- Centavos enteros: base y resto asignado a las primeras cuotas.
    if exists(select 1 from public.obligaciones_tarjetas o join public.tramos_pago_compras t on t.id=o.tramo_id
      where o.tramo_id=v_id and o.importe*100 <> floor(t.importe*100/t.cantidad_cuotas)
        + case when o.numero_cuota<=mod(t.importe*100,t.cantidad_cuotas) then 1 else 0 end) then
      raise exception 'Distribución de centavos incompatible' using errcode='23514';
    end if;
    -- Incluye sucesoras: quitar/reasignar una cuota anterior también se verifica.
    if exists(select 1 from public.obligaciones_tarjetas o join public.periodos_tarjetas p on p.id=o.periodo_id
      where o.tramo_id=v_id and exists(select 1 from public.obligaciones_tarjetas anterior
        left join public.periodos_tarjetas pa on pa.id=anterior.periodo_id
        where anterior.tramo_id=v_id and anterior.numero_cuota<o.numero_cuota
          and (anterior.periodo_id is null or pa.orden>=p.orden))) then
      raise exception 'Orden de períodos incompatible con cuotas' using errcode='23514';
    end if;
  end loop;

  for v_id in select distinct x from unnest(v_pagos) x loop
    if exists(select 1 from public.pagos_resumenes_tarjetas p where p.id=v_id
      and p.importe is distinct from (select sum(a.importe) from public.aplicaciones_pagos_obligaciones a where a.pago_id=v_id)) then
      raise exception 'Pago sin distribución exacta' using errcode='23514';
    end if;
    v_obligaciones:=v_obligaciones || array(select a.obligacion_id from public.aplicaciones_pagos_obligaciones a where a.pago_id=v_id);
  end loop;

  for v_id in select distinct x from unnest(v_obligaciones) x loop
    if exists(select 1 from public.aplicaciones_pagos_obligaciones a
      join public.pagos_resumenes_tarjetas p on p.id=a.pago_id
      join public.obligaciones_tarjetas o on o.id=a.obligacion_id
      join public.financiaciones_compras f on f.compra_id=o.compra_id
      where a.obligacion_id=v_id and (o.periodo_id is distinct from p.periodo_id or f.estado<>'CONFIRMADA')) then
      raise exception 'Aplicación incompatible con período o financiación' using errcode='23514';
    end if;
    if exists(select 1 from public.obligaciones_tarjetas o where o.id=v_id
      and (select sum(a.importe) from public.aplicaciones_pagos_obligaciones a where a.obligacion_id=v_id)>o.importe) then
      raise exception 'Aplicaciones superan obligación' using errcode='23514';
    end if;
  end loop;
  return null;
end;
$fn$;

create function public.proteger_financiacion_compras()
returns trigger language plpgsql security definer set search_path='' as $fn$
declare v_compra uuid; v_confirmada boolean;
begin
  if tg_table_name='compras_gastos' then v_compra:=old.id;
  elsif tg_table_name='items_compras_gastos' then
    -- Ambos padres en orden estable; cubre INSERT y traslado entre compras.
    perform c.id from public.compras_gastos c
      where c.id in (case when tg_op<>'INSERT' then old.compra_gasto_id end,
        case when tg_op<>'DELETE' then new.compra_gasto_id end) order by c.id for update;
    if exists(select 1 from public.financiaciones_compras f where f.estado='CONFIRMADA'
      and f.compra_id in (case when tg_op<>'INSERT' then old.compra_gasto_id end,
        case when tg_op<>'DELETE' then new.compra_gasto_id end)) then
      raise exception 'Ítems de compra financiada inmutables' using errcode='23514';
    end if;
    if tg_op='DELETE' then return old; else return new; end if;
  else
    v_compra:=case when tg_op='DELETE' then old.compra_id else new.compra_id end;
    if tg_op='UPDATE' and old.compra_id is distinct from new.compra_id then
      raise exception 'Identidad financiera inmutable' using errcode='23514';
    end if;
  end if;
  perform 1 from public.compras_gastos c where c.id=v_compra for update;
  select f.estado='CONFIRMADA' into v_confirmada from public.financiaciones_compras f where f.compra_id=v_compra;
  if tg_table_name='obligaciones_tarjetas' then
    perform t.id from public.tarjetas_credito t where t.id in (
      case when tg_op<>'INSERT' then old.tarjeta_id end,
      case when tg_op<>'DELETE' then new.tarjeta_id end) order by t.id for update;
    -- Coordina reasignaciones con pagos y edición de fechas del resumen.
    perform p.id from public.periodos_tarjetas p
      where p.id in (case when tg_op<>'INSERT' then old.periodo_id end,
        case when tg_op<>'DELETE' then new.periodo_id end) order by p.id for update;
  end if;
  if v_confirmada then
    if tg_table_name='compras_gastos' and tg_op='UPDATE' then
      -- Solo comprobante/observaciones son editables. Identidad, economía y
      -- procedencia/auditoría permanecen explícitamente protegidas.
      if row(new.id,new.tipo,new.proveedor_id,new.fecha,new.moneda,new.created_at,new.actor_id)
        is not distinct from row(old.id,old.tipo,old.proveedor_id,old.fecha,old.moneda,old.created_at,old.actor_id) then
        return new;
      end if;
    end if;
    if tg_table_name='obligaciones_tarjetas' and tg_op='UPDATE' then
      if (to_jsonb(new)-'periodo_id')=(to_jsonb(old)-'periodo_id')
        and not exists(select 1 from public.aplicaciones_pagos_obligaciones a where a.obligacion_id=old.id) then
        return new;
      end if;
    end if;
    raise exception 'Compra/financiación confirmada inmutable' using errcode='23514';
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end;
$fn$;

create function public.proteger_pagos_tarjetas()
returns trigger language plpgsql security definer set search_path='' as $fn$
declare v_periodo uuid;
begin
  if tg_op<>'INSERT' then
    raise exception 'Hecho de pago inmutable: requiere corrección auditada' using errcode='23514';
  end if;
  if tg_table_name='pagos_resumenes_tarjetas' then v_periodo:=new.periodo_id;
  else
    select p.periodo_id into v_periodo from public.pagos_resumenes_tarjetas p where p.id=new.pago_id;
  end if;
  -- Serializa pagos/aplicaciones del mismo resumen, incluso con UUID diferentes.
  perform 1 from public.periodos_tarjetas p where p.id=v_periodo for update;
  return new;
end;
$fn$;

create function public.proteger_periodos_tarjetas()
returns trigger language plpgsql security definer set search_path='' as $fn$
begin
  -- Inserciones/ediciones de períodos de una misma tarjeta se serializan.
  -- También sincroniza con asignaciones de cuotas (comparten este lock).
  perform t.id from public.tarjetas_credito t where t.id in (
    case when tg_op<>'INSERT' then old.tarjeta_id end,
    case when tg_op<>'DELETE' then new.tarjeta_id end) order by t.id for update;
  if tg_op='INSERT' then return new; end if;
  if exists(select 1 from public.obligaciones_tarjetas o where o.periodo_id=old.id)
    or exists(select 1 from public.pagos_resumenes_tarjetas p where p.periodo_id=old.id) then
    raise exception 'Período utilizado inmutable' using errcode='23514';
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end;
$fn$;

create trigger compra_financiada_inmutable before update or delete on public.compras_gastos
for each row execute function public.proteger_financiacion_compras();
create trigger items_compra_financiada_inmutables before insert or update or delete on public.items_compras_gastos
for each row execute function public.proteger_financiacion_compras();
create trigger financiacion_confirmada_inmutable before insert or update or delete on public.financiaciones_compras
for each row execute function public.proteger_financiacion_compras();
create trigger tramo_confirmado_inmutable before insert or update or delete on public.tramos_pago_compras
for each row execute function public.proteger_financiacion_compras();
create trigger obligacion_confirmada_inmutable before insert or update or delete on public.obligaciones_tarjetas
for each row execute function public.proteger_financiacion_compras();
create trigger periodo_utilizado_inmutable before insert or update or delete on public.periodos_tarjetas
for each row execute function public.proteger_periodos_tarjetas();
create trigger pago_resumen_inmutable before insert or update or delete on public.pagos_resumenes_tarjetas
for each row execute function public.proteger_pagos_tarjetas();
create trigger aplicacion_pago_inmutable before insert or update or delete on public.aplicaciones_pagos_obligaciones
for each row execute function public.proteger_pagos_tarjetas();

create constraint trigger periodos_integridad after insert or update or delete on public.periodos_tarjetas
  deferrable initially deferred for each row execute function public.validar_financiacion_compras_integridad();

-- Diferidas: permiten crear el conjunto completo y confirmar en una transacción.
create constraint trigger financiacion_integridad after insert or update or delete on public.financiaciones_compras
  deferrable initially deferred for each row execute function public.validar_financiacion_compras_integridad();
create constraint trigger tramos_integridad after insert or update or delete on public.tramos_pago_compras
  deferrable initially deferred for each row execute function public.validar_financiacion_compras_integridad();
create constraint trigger obligaciones_integridad after insert or update or delete on public.obligaciones_tarjetas
  deferrable initially deferred for each row execute function public.validar_financiacion_compras_integridad();
create constraint trigger pagos_resumen_integridad after insert or update or delete on public.pagos_resumenes_tarjetas
  deferrable initially deferred for each row execute function public.validar_financiacion_compras_integridad();
create constraint trigger aplicaciones_integridad after insert or update or delete on public.aplicaciones_pagos_obligaciones
  deferrable initially deferred for each row execute function public.validar_financiacion_compras_integridad();

do $security$
declare nombre text;
begin
  foreach nombre in array array['tarjetas_credito','financiaciones_compras','periodos_tarjetas',
    'tramos_pago_compras','obligaciones_tarjetas','pagos_resumenes_tarjetas','aplicaciones_pagos_obligaciones'] loop
    execute format('alter table public.%I owner to postgres',nombre);
    execute format('alter table public.%I enable row level security',nombre);
    execute format('revoke all on table public.%I from public,anon,authenticated,service_role',nombre);
  end loop;
end;
$security$;
alter function public.validar_financiacion_compras_integridad() owner to postgres;
alter function public.proteger_financiacion_compras() owner to postgres;
alter function public.proteger_pagos_tarjetas() owner to postgres;
alter function public.proteger_periodos_tarjetas() owner to postgres;
revoke all on function public.validar_financiacion_compras_integridad(),public.proteger_financiacion_compras(),
  public.proteger_pagos_tarjetas(),public.proteger_periodos_tarjetas() from public,anon,authenticated,service_role;
commit;
