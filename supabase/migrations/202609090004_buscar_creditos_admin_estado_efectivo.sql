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
