-- HUGELLA: despliegue manual de estado efectivo — 2026-09-09
-- ARCHIVO PREPARADO, NO EJECUTADO. Revisar antes de pegar en SQL Editor.
-- Ejecutar TODO el archivo una sola vez con el rol de despliegue autorizado.
-- No ejecutar fragmentos ni continuar tras errores. Si queda una transacción
-- abortada en la sesión, ejecutar ROLLBACK antes de volver a trabajar.
-- No es idempotente: helpers existentes/estado ya migrado provocan rollback.
-- No registra la aplicación en supabase_migrations.schema_migrations:
-- reconciliar el historial de migraciones antes de futuros despliegues por CLI.
-- No modifica filas de clientes/pagos/créditos, RLS, tokens ni Apps Script.
-- Mantiene los grants previstos para funciones auxiliares nuevas y puras;
-- no amplía permisos de tablas ni de RPC existentes.
-- La verificación A–F se realiza ANTES de COMMIT: un error también revierte DDL.
-- El CHECK toma un lock de tabla y valida filas existentes; elegir ventana adecuada.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- Guardas adicionales del paquete: ambas RPC deben existir; preservar todos
-- sus metadatos/ACL. Esta tabla temporal desaparece al COMMIT o ROLLBACK.
CREATE TEMPORARY TABLE hugella_deploy_rpc_snapshot (
  function_oid oid PRIMARY KEY,
  metadata jsonb NOT NULL
) ON COMMIT DROP;

DO $preflight$
DECLARE
  v_carton oid := to_regprocedure('public.get_carton_publico(uuid)');
  v_admin oid := to_regprocedure('public.buscar_creditos_admin(text)');
  v_expected_carton text := $expected_carton$
  select jsonb_build_object(
    'nombre_cliente', cl.nombre,
    'codigo_credito', cr.codigo,
    'producto', cr.producto,
    'fecha_inicio', cr.fecha_inicio,
    'cantidad_cuotas', cr.cantidad_cuotas,
    'importe_cuota', cr.importe_cuota,
    'estado', cr.estado,
    'cuotas_pagadas', least(
      cr.cantidad_cuotas,
      coalesce((
        select sum(greatest(coalesce(pg.cuotas_aplicadas, 0), 0))::integer
        from public.pagos as pg
        where pg.credito_id = cr.id
      ), 0)
    ),
    'cuotas_pendientes', greatest(
      cr.cantidad_cuotas - least(
        cr.cantidad_cuotas,
        coalesce((
          select sum(greatest(coalesce(pg.cuotas_aplicadas, 0), 0))::integer
          from public.pagos as pg
          where pg.credito_id = cr.id
        ), 0)
      ),
      0
    ),
    'pagos', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'fecha_pago', pg.fecha_pago,
          'medio_pago', pg.medio_pago,
          'importe', pg.importe,
          'cuotas_aplicadas', greatest(coalesce(pg.cuotas_aplicadas, 0), 0)
        )
        order by pg.fecha_pago desc, pg.created_at desc
      )
      from public.pagos as pg
      where pg.credito_id = cr.id
    ), '[]'::jsonb)
  )
  from public.creditos as cr
  inner join public.clientes as cl on cl.id = cr.cliente_id
  where cr.access_token = p_token
  limit 1;
$expected_carton$;
BEGIN
  IF v_carton IS NULL OR v_admin IS NULL THEN
    RAISE EXCEPTION 'Revisión requerida: faltan las RPC originales';
  END IF;
  -- La migración 003 se basa en el cuerpo SQL versionado original. Una
  -- diferencia distinta de espacios exige revisión, no sobrescritura a ciegas.
  IF regexp_replace((SELECT prosrc FROM pg_proc WHERE oid = v_carton), '[[:space:]]', '', 'g')
     IS DISTINCT FROM regexp_replace(v_expected_carton, '[[:space:]]', '', 'g') THEN
    RAISE EXCEPTION 'Revisión requerida: get_carton_publico difiere de la versión original conocida';
  END IF;
  INSERT INTO pg_temp.hugella_deploy_rpc_snapshot
    SELECT p.oid, to_jsonb(p) - 'prosrc'
    FROM pg_proc p WHERE p.oid IN (v_carton, v_admin);
END;
$preflight$;

-- =====================================================================
-- PASO 1: 202609090001_estado_efectivo_helpers.sql
-- Contenido original de la migración, sin modificaciones.
-- =====================================================================
-- LOCAL REVIEW ONLY. No table writes, payment changes, or auth/RLS changes.
-- CREATE (not OR REPLACE) deliberately fails on unexpected name collisions.
create function public.hugella_fecha_comercial()
returns date language sql stable set search_path = ''
as $$
  select (statement_timestamp() at time zone 'America/Argentina/Mendoza')::date;
$$;

create function public.hugella_cuotas_exigibles(
  p_fecha_inicio date,
  p_cantidad_cuotas integer,
  p_fecha_evaluacion date default public.hugella_fecha_comercial()
)
returns integer language sql immutable strict set search_path = ''
as $$
  -- Inclusive interval. Each complete ISO week contributes one Sunday.
  -- Date subtraction avoids DST/UTC duration errors and is O(1).
  select greatest(0, least(p_cantidad_cuotas,
    case when p_fecha_evaluacion < p_fecha_inicio then 0
    else (p_fecha_evaluacion - p_fecha_inicio + 1)
      - ((p_fecha_evaluacion - p_fecha_inicio + 1
          + extract(isodow from p_fecha_inicio)::integer - 1) / 7)
    end
  ));
$$;

create function public.hugella_estado_credito(
  p_cantidad_cuotas integer,
  p_cuotas_pagadas bigint,
  p_cuotas_exigibles integer
)
returns text language sql immutable strict set search_path = ''
as $$
  select case
    when p_cuotas_pagadas >= p_cantidad_cuotas then 'CANCELADO'
    when p_cuotas_pagadas > p_cuotas_exigibles then 'ADELANTADO'
    when p_cuotas_pagadas = p_cuotas_exigibles then 'AL DIA'
    else 'ATRASADO'
  end;
$$;

-- Pure functions only: these grants expose no rows or financial information.
revoke all on function public.hugella_fecha_comercial() from public;
revoke all on function public.hugella_cuotas_exigibles(date, integer, date) from public;
revoke all on function public.hugella_estado_credito(integer, bigint, integer) from public;
grant execute on function public.hugella_fecha_comercial() to anon, authenticated;
grant execute on function public.hugella_cuotas_exigibles(date, integer, date) to anon, authenticated;
grant execute on function public.hugella_estado_credito(integer, bigint, integer) to anon, authenticated;

-- =====================================================================
-- PASO 2: 202609090002_creditos_estado_check.sql
-- Contenido original de la migración, sin modificaciones.
-- =====================================================================
-- LOCAL REVIEW ONLY. Fail closed on unknown types/constraints. Atomic DO block.
-- Only the exact historical three-value CHECK is eligible for replacement.
do $$
declare
  v_column smallint;
  v_type oid;
  v_constraint record;
  v_count integer := 0;
  v_name text;
  v_expression text;
begin
  select attnum, atttypid into strict v_column, v_type
  from pg_attribute
  where attrelid = 'public.creditos'::regclass and attname = 'estado' and not attisdropped;
  if v_type not in ('text'::regtype, 'character varying'::regtype) then
    raise exception 'Review required: creditos.estado is not text/varchar';
  end if;

  for v_constraint in
    select conname, conkey, pg_get_expr(conbin, conrelid) as expression
    from pg_constraint
    where conrelid = 'public.creditos'::regclass and contype = 'c' and v_column = any(conkey)
  loop
    v_count := v_count + 1;
    -- Remove deparser casts/parentheses/spacing, not arbitrary SQL expressions.
    v_expression := replace(replace(v_constraint.expression, '::character varying', ''), '::text', '');
    v_expression := regexp_replace(v_expression, '[[:space:]()]', '', 'g');
    if cardinality(v_constraint.conkey) <> 1 or v_expression <>
      'estado=ANYARRAY[''ALDIA'',''ATRASADO'',''CANCELADO'']' then
      raise exception 'Review required: unrecognized estado CHECK %: %', v_constraint.conname, v_constraint.expression;
    end if;
    v_name := v_constraint.conname;
  end loop;

  if v_count > 1 then
    raise exception 'Review required: multiple estado CHECK constraints';
  end if;
  if v_count = 1 then
    execute format('alter table public.creditos drop constraint %I', v_name);
  else
    v_name := 'hugella_creditos_estado_check';
  end if;
  execute format(
    'alter table public.creditos add constraint %I check (estado in (''ADELANTADO'', ''AL DIA'', ''ATRASADO'', ''CANCELADO''))',
    v_name
  );
  -- Existing invalid rows cause rollback. No row, default, or NOT NULL is changed.
end;
$$;

-- =====================================================================
-- PASO 3: 202609090003_get_carton_estado_efectivo.sql
-- Contenido original de la migración, sin modificaciones.
-- =====================================================================
-- LOCAL REVIEW ONLY. Same signature, JSON fields, SECURITY DEFINER and search_path.
-- CREATE OR REPLACE preserves current ownership and grants; no RLS/grant changes.
create or replace function public.get_carton_publico(p_token uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'nombre_cliente', cl.nombre,
    'codigo_credito', cr.codigo,
    'producto', cr.producto,
    'fecha_inicio', cr.fecha_inicio,
    'cantidad_cuotas', cr.cantidad_cuotas,
    'importe_cuota', cr.importe_cuota,
    'estado', public.hugella_estado_credito(
      cr.cantidad_cuotas,
      paid.cuotas_pagadas,
      public.hugella_cuotas_exigibles(cr.fecha_inicio, cr.cantidad_cuotas)
    ),
    'cuotas_pagadas', paid.cuotas_pagadas,
    'cuotas_pendientes', greatest(cr.cantidad_cuotas - paid.cuotas_pagadas, 0),
    'pagos', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'fecha_pago', pg.fecha_pago,
          'medio_pago', pg.medio_pago,
          'importe', pg.importe,
          'cuotas_aplicadas', greatest(coalesce(pg.cuotas_aplicadas, 0), 0)
        )
        order by pg.fecha_pago desc, pg.created_at desc
      )
      from public.pagos as pg
      where pg.credito_id = cr.id
    ), '[]'::jsonb)
  )
  from public.creditos as cr
  inner join public.clientes as cl on cl.id = cr.cliente_id
  cross join lateral (
    -- Preserve the existing monetary allocation: SUM cuotas_aplicadas, not COUNT.
    -- Do not add remanente again or derive installments from payment row count.
    select least(cr.cantidad_cuotas, coalesce(
      sum(greatest(coalesce(pg.cuotas_aplicadas, 0), 0))::integer, 0
    )) as cuotas_pagadas
    from public.pagos as pg where pg.credito_id = cr.id
  ) as paid
  where cr.access_token = p_token
  limit 1;
$$;


-- =====================================================================
-- PASO 4: 202609090004_buscar_creditos_admin_estado_efectivo.sql
-- Contenido original de la migración, sin modificaciones.
-- =====================================================================
-- LOCAL ONLY: pending review/approval; do not execute on remote Supabase yet.
-- The supplied contract is exact, but the verbatim function body is not in this
-- repository. Patch the installed definition instead of reconstructing auth,
-- search, ordering, payments or grants. Unexpected source => atomic rollback.
-- pg_get_functiondef produces CREATE OR REPLACE FUNCTION with existing options.
do $migration$
declare
  v_oid oid := to_regprocedure('public.buscar_creditos_admin(text)');
  v_before jsonb;
  v_after jsonb;
  v_source text;
  v_definition text;
  v_group text;
  v_patched text;
  v_state_pattern text := 'cr\.estado\s*::\s*text';
  v_group_pattern text := 'GROUP\s+BY\s+cr\.id\s*,\s*cl\.nombre\s*,\s*cr\.codigo\s*,\s*cr\.producto\s*,\s*cr\.importe_cuota\s*,\s*cr\.cantidad_cuotas\s*,\s*cr\.estado\M';
  v_new_state text := $state$public.hugella_estado_credito(
      cr.cantidad_cuotas,
      least(
        cr.cantidad_cuotas,
        coalesce(
          sum(greatest(coalesce(pg.cuotas_aplicadas, 0), 0))::integer,
          0
        )
      ),
      public.hugella_cuotas_exigibles(cr.fecha_inicio, cr.cantidad_cuotas)
    )::text$state$;
begin
  if v_oid is null then
    raise exception 'Review required: buscar_creditos_admin(text) is missing';
  end if;
  if to_regprocedure('public.hugella_estado_credito(integer,bigint,integer)') is null
    or to_regprocedure('public.hugella_cuotas_exigibles(date,integer,date)') is null then
    raise exception 'Review required: install approved state helpers first';
  end if;
  select to_jsonb(p) - 'prosrc', p.prosrc, pg_get_functiondef(p.oid)
    into v_before, v_source, v_definition
  from pg_proc p where p.oid = v_oid;

  if pg_get_function_result(v_oid) <>
    'TABLE(credito_id uuid, nombre_cliente text, codigo_credito text, producto text, importe_cuota numeric, cantidad_cuotas integer, cuotas_pagadas integer, cuotas_pendientes integer, estado text)'
    or not (v_before->>'prosecdef')::boolean
    or (v_before->'proargnames'->>0) is distinct from 'p_busqueda'
    or v_before->>'provolatile' = 'i' then
    raise exception 'Review required: unexpected RPC contract, security or volatility';
  end if;

  if strpos(regexp_replace(lower(v_source), '\s', '', 'g'),
    'least(cr.cantidad_cuotas,coalesce(sum(greatest(coalesce(pg.cuotas_aplicadas,0),0))::integer,0))') = 0 then
    raise exception 'Review required: expected monetary allocation expression missing';
  end if;

  -- Only the supplied source shape is supported. No best-effort rewrites.
  if regexp_count(v_source, v_state_pattern, 1, 'i') <> 1
    or regexp_count(v_source, v_group_pattern, 1, 'i') <> 1
    or regexp_count(v_source, 'cr\.estado\M', 1, 'i') <> 2 then
    raise exception 'Review required: RPC source differs from supplied estado/GROUP BY pattern';
  end if;
  v_group := (regexp_match(v_source, v_group_pattern, 'i'))[1];
  v_patched := regexp_replace(v_source, v_state_pattern, v_new_state, 'i');
  v_patched := replace(v_patched, v_group,
    regexp_replace(v_group, 'cr\.estado\M', 'cr.fecha_inicio', 'i'));

  -- All other original source bytes remain untouched. No GRANT/REVOKE/DROP.
  -- The complete CREATE OR REPLACE FUNCTION is obtained from the original DDL.
  v_definition := replace(v_definition, v_source, v_patched);
  execute v_definition;

  select to_jsonb(p) - 'prosrc' into v_after from pg_proc p where p.oid = v_oid;
  if v_after is distinct from v_before
    or (select prosrc from pg_proc where oid = v_oid) is distinct from v_patched then
    raise exception 'RPC metadata/ACL changed unexpectedly: rolling back';
  end if;
end;
$migration$;

-- Control transaccional de invariantes. No cambia grants/owner/search_path.
DO $invariants$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_temp.hugella_deploy_rpc_snapshot s
    LEFT JOIN pg_proc p ON p.oid = s.function_oid
    WHERE p.oid IS NULL OR (to_jsonb(p) - 'prosrc') IS DISTINCT FROM s.metadata
  ) THEN
    RAISE EXCEPTION 'Metadatos o permisos de RPC cambiaron: rollback obligatorio';
  END IF;
END;
$invariants$;

-- =====================================================================
-- VERIFICACIÓN SOLO LECTURA A–F
-- Todas las sentencias de esta sección son SELECT, sin pagos de prueba.
-- Los resultados describen la transacción actual; SOLO el COMMIT final confirma
-- el despliegue. Si una consulta falla, no hay aplicación parcial del paquete.
-- Para inspeccionar después del despliegue se pueden copiar solo estos SELECT.
-- =====================================================================

-- A. Deben aparecer las tres funciones auxiliares con existe = true.
SELECT expected.signature,
       to_regprocedure(expected.signature) IS NOT NULL AS existe,
       pg_get_function_result(to_regprocedure(expected.signature)) AS retorno
FROM (VALUES
  ('public.hugella_fecha_comercial()'),
  ('public.hugella_cuotas_exigibles(date,integer,date)'),
  ('public.hugella_estado_credito(integer,bigint,integer)')
) AS expected(signature);

-- B. Revisar definición completa: cuatro estados, incluido ADELANTADO.
-- convalidated=true confirma que PostgreSQL validó los datos existentes.
-- Esta inspección NO intenta insertar/actualizar una fila para probar el CHECK.
SELECT c.conname, c.convalidated,
       pg_get_constraintdef(c.oid) AS definicion,
       position(quote_literal('ADELANTADO') IN pg_get_constraintdef(c.oid)) > 0
         AS incluye_literal_adelantado
FROM pg_constraint c
JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attname='estado'
WHERE c.conrelid='public.creditos'::regclass
  AND c.contype='c' AND a.attnum=ANY(c.conkey);

-- C. Contrato y definición completos de la RPC administrativa.
SELECT p.oid::regprocedure AS firma,
       pg_get_function_arguments(p.oid) AS argumentos,
       pg_get_function_result(p.oid) AS retorno,
       p.prosecdef AS security_definer, p.proconfig AS configuracion,
       pg_get_functiondef(p.oid) AS definicion
FROM pg_proc p WHERE p.oid=to_regprocedure('public.buscar_creditos_admin(text)');

-- D. Contrato y definición completos del cartón público.
SELECT p.oid::regprocedure AS firma,
       pg_get_function_arguments(p.oid) AS argumentos,
       pg_get_function_result(p.oid) AS retorno,
       p.prosecdef AS security_definer, p.proconfig AS configuracion,
       pg_get_functiondef(p.oid) AS definicion
FROM pg_proc p WHERE p.oid=to_regprocedure('public.get_carton_publico(uuid)');

-- E. Propietario, ACL almacenada y EXECUTE efectivo (incluye herencia de roles).
SELECT p.oid::regprocedure AS firma, pg_get_userbyid(p.proowner) AS propietario,
       p.proacl AS acl,
       has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute,
       has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_execute
FROM pg_proc p WHERE p.oid IN (
  to_regprocedure('public.buscar_creditos_admin(text)'),
  to_regprocedure('public.get_carton_publico(uuid)')
);

-- E (detalle). PUBLIC se representa con grantee=0. Sin conceder permisos.
SELECT p.oid::regprocedure AS firma,
       CASE WHEN acl.grantee=0 THEN 'PUBLIC'
            ELSE pg_get_userbyid(acl.grantee) END AS destinatario,
       pg_get_userbyid(acl.grantor) AS otorgante,
       acl.privilege_type AS permiso, acl.is_grantable AS puede_otorgar
FROM pg_proc p
CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
WHERE p.oid IN (
  to_regprocedure('public.buscar_creditos_admin(text)'),
  to_regprocedure('public.get_carton_publico(uuid)')
)
ORDER BY p.oid::regprocedure::text, destinatario, permiso;

-- F. Diagnóstico administrativo de SOLO LECTURA para créditos existentes.
-- No se publica como RPC/vista ni se otorgan accesos. Ejecutar como operador
-- autorizado, no copiar estos resultados a la interfaz pública.
-- Agregado monetario EXACTO existente: SUM cuotas_aplicadas saneadas y limitado
-- a cantidad_cuotas. No COUNT de pagos, importes ni suma de remanentes.
WITH asignaciones AS (
  SELECT pg.credito_id,
         sum(greatest(coalesce(pg.cuotas_aplicadas,0),0))::integer AS cuotas_aplicadas
  FROM public.pagos pg
  GROUP BY pg.credito_id
), diagnostico AS (
  SELECT cr.codigo, cr.fecha_inicio, cr.cantidad_cuotas,
         least(cr.cantidad_cuotas,coalesce(a.cuotas_aplicadas,0)) AS cuotas_pagadas,
         public.hugella_cuotas_exigibles(cr.fecha_inicio,cr.cantidad_cuotas)
           AS cuotas_que_deberia_llevar,
         cr.estado AS estado_almacenado
  FROM public.creditos cr
  LEFT JOIN asignaciones a ON a.credito_id=cr.id
)
SELECT codigo, fecha_inicio, cantidad_cuotas, cuotas_pagadas,
       cuotas_que_deberia_llevar, estado_almacenado,
       public.hugella_estado_credito(cantidad_cuotas,cuotas_pagadas,cuotas_que_deberia_llevar)
         AS estado_efectivo_calculado
FROM diagnostico
ORDER BY codigo;

-- Único punto de confirmación del paquete completo. NO ejecutar por separado.
COMMIT;
