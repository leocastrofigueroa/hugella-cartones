-- LOCAL ONLY. Review installed RPC definitions before applying in staging/production.
begin;

-- One immutable closure per credit. Financial plan and payment rows are untouched.
create table public.cierres_creditos (
  credito_id uuid primary key references public.creditos(id),
  operacion_id uuid not null unique,
  tipo text not null check (tipo in ('DEVUELTO', 'RETIRADO')),
  fecha date not null check (isfinite(fecha)),
  motivo text not null check (length(btrim(motivo)) between 1 and 1000),
  observaciones text check (length(observaciones) <= 4000),
  actor_id uuid not null references auth.users(id),
  created_at timestamptz not null default clock_timestamp()
);
alter table public.cierres_creditos enable row level security;
revoke all on public.cierres_creditos from public, anon, authenticated;

create function public.proteger_cierre_credito()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'El cierre es inmutable; no se puede modificar ni eliminar';
end;
$$;
revoke all on function public.proteger_cierre_credito() from public, anon, authenticated;
create trigger cierre_credito_inmutable before update or delete on public.cierres_creditos
for each row execute function public.proteger_cierre_credito();

create function public.cerrar_credito_admin(
  p_credito_id uuid, p_operacion_id uuid, p_tipo text, p_fecha date,
  p_motivo text, p_observaciones text default null
)
returns setof public.cierres_creditos
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_credito public.creditos%rowtype;
  v_cierre public.cierres_creditos%rowtype;
  v_motivo text := nullif(btrim(p_motivo), '');
  v_observaciones text := nullif(btrim(p_observaciones), '');
begin
  if auth.uid() is null or public.es_admin_hugella() is not true then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if p_credito_id is null or p_operacion_id is null
    or p_tipo is null or p_tipo not in ('DEVUELTO', 'RETIRADO')
    or p_fecha is null or not isfinite(p_fecha)
    or p_fecha > public.hugella_fecha_comercial()
    or v_motivo is null or length(v_motivo) > 1000
    or length(v_observaciones) > 4000 then
    raise exception 'Datos de cierre inválidos' using errcode = '22023';
  end if;
  -- Same serialization point as payment writers/recalculation.
  select * into v_credito from public.creditos where id = p_credito_id for update;
  if not found then raise exception 'Crédito no encontrado' using errcode = 'P0002'; end if;

  select * into v_cierre from public.cierres_creditos where credito_id = p_credito_id;
  if found then
    if v_cierre.operacion_id = p_operacion_id and v_cierre.tipo = p_tipo
      and v_cierre.fecha = p_fecha and v_cierre.motivo = v_motivo
      and v_cierre.observaciones is not distinct from v_observaciones
      and v_cierre.actor_id = auth.uid() then
      return next v_cierre;
      return;
    end if;
    raise exception 'El crédito ya tiene un cierre distinto' using errcode = '22023';
  end if;
  if p_fecha < v_credito.fecha_inicio then
    raise exception 'El cierre no puede ser anterior a la entrega' using errcode = '22023';
  end if;
  if exists (select 1 from public.pagos where credito_id = p_credito_id
    and estado = 'VALIDO' and fecha_pago > p_fecha) then
    raise exception 'Hay pagos posteriores a la fecha de cierre; revisar la fecha sin anular pagos'
      using errcode = '22023';
  end if;
  insert into public.cierres_creditos(credito_id, operacion_id, tipo, fecha, motivo, observaciones, actor_id)
    values(p_credito_id, p_operacion_id, p_tipo, p_fecha, v_motivo, v_observaciones, auth.uid())
    returning * into v_cierre;
  return next v_cierre;
end;
$$;
revoke all on function public.cerrar_credito_admin(uuid,uuid,text,date,text,text) from public, anon;
grant execute on function public.cerrar_credito_admin(uuid,uuid,text,date,text,text) to authenticated;

create function public.obtener_cierre_credito_admin(p_credito_id uuid)
returns setof public.cierres_creditos
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or public.es_admin_hugella() is not true then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  return query select * from public.cierres_creditos where credito_id = p_credito_id;
end;
$$;
revoke all on function public.obtener_cierre_credito_admin(uuid) from public, anon;
grant execute on function public.obtener_cierre_credito_admin(uuid) to authenticated;

-- Replayable paginated snapshot: deliberately independent of eventos_pagos_sheets.
create function public.obtener_cierres_creditos_sheets(p_despues uuid default null)
returns table(credito_id uuid, codigo_credito text, tipo text, fecha date)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or public.es_admin_hugella() is not true then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  return query select c.credito_id, cr.codigo::text, c.tipo, c.fecha
    from public.cierres_creditos c join public.creditos cr on cr.id = c.credito_id
    where p_despues is null or c.credito_id > p_despues
    order by c.credito_id limit 500;
end;
$$;
revoke all on function public.obtener_cierres_creditos_sheets(uuid) from public, anon;
grant execute on function public.obtener_cierres_creditos_sheets(uuid) to authenticated;

-- Late imports of actual historic money (including the closure day) remain valid.
-- Changing a payment date/credit cannot move it beyond the closure date either.
create function public.validar_pago_credito_cerrado()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_fecha date;
begin
  perform 1 from public.creditos where id = new.credito_id for update;
  select fecha into v_fecha from public.cierres_creditos where credito_id = new.credito_id;
  if new.estado = 'VALIDO' and v_fecha is not null and new.fecha_pago > v_fecha then
    raise exception 'El crédito está cerrado; no admite pagos posteriores al cierre'
      using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function public.validar_pago_credito_cerrado() from public, anon, authenticated;
create trigger pago_credito_cerrado before insert or update of credito_id, fecha_pago, estado on public.pagos
for each row execute function public.validar_pago_credito_cerrado();

-- Preserve original RPC bodies/security/ACL. Internal copies are not callable by
-- application roles. Wrappers add only the closure projection; no monetary rewrite.
do $migration$
declare
  v record; v_oid oid; v_before jsonb; v_after jsonb; v_source text;
  v_definition text; v_copy text; v_owner text;
begin
  for v in select * from (values
    ('buscar_creditos_admin', 'text', 'p_busqueda text',
     'TABLE(credito_id uuid, nombre_cliente text, codigo_credito text, producto text, importe_cuota numeric, cantidad_cuotas integer, cuotas_pagadas integer, cuotas_pendientes integer, estado text)',
     $body$begin
       return query select r.credito_id, r.nombre_cliente, r.codigo_credito, r.producto,
         r.importe_cuota, r.cantidad_cuotas, r.cuotas_pagadas,
         case when c.credito_id is null then r.cuotas_pendientes else 0 end,
         coalesce(c.tipo, r.estado)
       from public.hugella_base_buscar_creditos_admin(p_busqueda) r
       left join public.cierres_creditos c on c.credito_id = r.credito_id
       order by case when lower(r.codigo_credito) = lower(btrim(p_busqueda)) then 0 else 1 end,
         r.nombre_cliente, r.codigo_credito;
     end;$body$),
    ('recalcular_pagos_credito', 'uuid', 'p_credito_id uuid',
     'TABLE(total_pagado numeric, cuotas_pagadas integer, cuotas_pendientes integer, remanente numeric, estado text)',
     $body$declare v_result record; v_tipo text;
     begin
       select * into v_result from public.hugella_base_recalcular_pagos_credito(p_credito_id);
       select c.tipo into v_tipo from public.cierres_creditos c where c.credito_id = p_credito_id;
       return query select v_result.total_pagado, v_result.cuotas_pagadas,
         case when v_tipo is null then v_result.cuotas_pendientes else 0 end,
         v_result.remanente, coalesce(v_tipo, v_result.estado);
     end;$body$)
  ) as x(nombre, tipos, argumentos, resultado, cuerpo) loop
    v_oid := to_regprocedure(format('public.%s(%s)', v.nombre, v.tipos));
    if v_oid is null or to_regprocedure(format('public.hugella_base_%s(%s)', v.nombre, v.tipos)) is not null then
      raise exception 'Revisión requerida: RPC ausente o cierres ya instalados: %', v.nombre;
    end if;
    select to_jsonb(p) - 'prosrc', p.prosrc, pg_get_functiondef(p.oid), pg_get_userbyid(p.proowner)
      into v_before, v_source, v_definition, v_owner from pg_proc p where p.oid = v_oid;
    if pg_get_function_result(v_oid) <> v.resultado
      or not (v_before->>'prosecdef')::boolean
      or (v_before->>'prolang')::oid <> (select oid from pg_language where lanname = 'plpgsql')
      or v_before->>'provolatile' = 'i' then
      raise exception 'Revisión requerida: contrato inesperado: %', v.nombre;
    end if;
    v_copy := replace(v_definition, 'FUNCTION public.' || v.nombre || '(',
      'FUNCTION public.hugella_base_' || v.nombre || '(');
    if v_copy = v_definition then raise exception 'DDL inesperado: %', v.nombre; end if;
    execute v_copy;
    execute format('alter function public.hugella_base_%s(%s) owner to %I', v.nombre, v.tipos, v_owner);
    execute format('revoke all on function public.hugella_base_%s(%s) from public, anon, authenticated', v.nombre, v.tipos);
    execute replace(v_definition, v_source, v.cuerpo);
    select to_jsonb(p) - 'prosrc' into v_after from pg_proc p where p.oid = v_oid;
    if v_after is distinct from v_before then raise exception 'Metadatos/ACL alterados: %', v.nombre; end if;
  end loop;
end;
$migration$;

-- Exclude closures BEFORE existing ORDER/LIMIT and without reconstructing the
-- unversioned DNI/phone authorization logic. A different source shape aborts.
do $migration$
declare
  v_signature text; v_oid oid; v_before jsonb; v_source text; v_ddl text; v_patched text;
  v_pattern text; v_relation text;
begin
  foreach v_signature in array array['public.acceder_creditos_cliente(text,text)', 'public.get_carton_publico(uuid)'] loop
    -- Match the exported definitions separately: access starts FROM clientes
    -- JOIN creditos; the card starts FROM creditos. Preserve the relation keyword.
    v_relation := case when v_signature = 'public.acceder_creditos_cliente(text,text)' then 'join' else 'from' end;
    v_pattern := '\m' || v_relation || '\s+public\.creditos\s+(?:as\s+)?cr\M';
    v_oid := to_regprocedure(v_signature);
    if v_oid is null then raise exception 'Falta %', v_signature; end if;
    select to_jsonb(p) - 'prosrc', p.prosrc, pg_get_functiondef(p.oid)
      into v_before, v_source, v_ddl from pg_proc p where p.oid = v_oid;
    if not (v_before->>'prosecdef')::boolean
      or regexp_count(v_source, v_pattern, 1, 'i') <> 1
      or strpos(v_source, 'cierres_creditos') > 0 then
      raise exception 'Revisión requerida: fuente inesperada de %', v_signature;
    end if;
    v_patched := regexp_replace(v_source, v_pattern,
      v_relation || ' (select base.* from public.creditos base where not exists (select 1 from public.cierres_creditos cierre where cierre.credito_id = base.id)) cr', 'i');
    execute replace(v_ddl, v_source, v_patched);
    if (select to_jsonb(p) - 'prosrc' from pg_proc p where p.oid = v_oid) is distinct from v_before then
      raise exception 'Metadatos/ACL alterados: %', v_signature;
    end if;
  end loop;
end;
$migration$;

-- Full production export reviewed in anular_pago_admin_real_20261001.json.
-- Its body differs from the versioned migration only by two leading spaces
-- per nonempty line. Guard and replacement use the EXACT exported body.
-- MD5 is an identity guard, not a security/authentication mechanism.
do $migration$
declare
  v_oid oid := to_regprocedure('public.anular_pago_admin(uuid,uuid,text)');
  v_before jsonb; v_source text; v_ddl text; v_patched text;
  v_old text := $old$      select cr.estado::text
      into v_estado_credito
      from public.creditos as cr
      where cr.id = v_pago.credito_id;$old$;
  v_new text := $new$      select coalesce(c.tipo, cr.estado::text)
      into v_estado_credito
      from public.creditos as cr
      left join public.cierres_creditos as c on c.credito_id = cr.id
      where cr.id = v_pago.credito_id;$new$;
begin
  if v_oid is null then raise exception 'Revisión requerida: falta anular_pago_admin(uuid,uuid,text)'; end if;
  select to_jsonb(p) - 'prosrc', p.prosrc, pg_get_functiondef(p.oid)
    into v_before, v_source, v_ddl from pg_proc p where p.oid = v_oid;
  -- Production prosrc, including whitespace; do not normalize before hashing.
  if md5(v_source) <> '9d9fdcb08ff9ffc9010e35c3ce43f59f'
    or pg_get_function_arguments(v_oid) <> 'p_pago_id uuid, p_operacion_id uuid, p_motivo text'
    or pg_get_userbyid((v_before->>'proowner')::oid) <> 'postgres'
    or v_before->'proconfig' is distinct from '["search_path=\"\""]'::jsonb
    or pg_get_function_result(v_oid) <> 'TABLE(operacion_id uuid, pago_id uuid, credito_id uuid, estado_pago text, anulado_at timestamp with time zone, anulado_por uuid, motivo_anulacion text, estado_credito text, ya_procesada boolean)'
    or not (v_before->>'prosecdef')::boolean
    or (v_before->>'prolang')::oid <> (select oid from pg_language where lanname = 'plpgsql')
    or v_before->>'provolatile' <> 'v'
    or strpos(v_source, v_old) = 0 then
    raise exception 'Revisión requerida: exportar definición real de anular_pago_admin(uuid,uuid,text); no coincide con la versión revisada';
  end if;
  v_patched := replace(v_source, v_old, v_new);
  execute replace(v_ddl, v_source, v_patched);
  if (select to_jsonb(p) - 'prosrc' from pg_proc p where p.oid = v_oid) is distinct from v_before
    or (select p.prosrc from pg_proc p where p.oid = v_oid) is distinct from v_patched then
    raise exception 'Metadatos/ACL o cuerpo inesperados: anular_pago_admin';
  end if;
end;
$migration$;

commit;
