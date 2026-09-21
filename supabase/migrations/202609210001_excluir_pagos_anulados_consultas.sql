-- Preserve installed bodies (including authentication), signatures and ACL.
-- Only insert the four payment-state predicates confirmed for these RPCs.
-- A missing, already patched or unexpected definition aborts the whole block.
do $migration$
declare
  v_rpc record;
  v_oid oid;
  v_before jsonb;
  v_after jsonb;
  v_source text;
  v_definition text;
  v_patched text;
  v_pattern text;
begin
  for v_rpc in
    select * from (values
      ('public.buscar_creditos_admin(text)', 1,
       'TABLE(credito_id uuid, nombre_cliente text, codigo_credito text, producto text, importe_cuota numeric, cantidad_cuotas integer, cuotas_pagadas integer, cuotas_pendientes integer, estado text)'),
      ('public.acceder_creditos_cliente(text,text)', 1,
       'TABLE(access_token uuid, codigo text, producto text, estado text)'),
      ('public.get_carton_publico(uuid)', 2, 'jsonb')
    ) as rpc(signature, expected_matches, result_type)
  loop
    v_oid := to_regprocedure(v_rpc.signature);
    if v_oid is null then
      raise exception 'Revisión requerida: falta %', v_rpc.signature;
    end if;

    select to_jsonb(p) - 'prosrc', p.prosrc, pg_get_functiondef(p.oid)
    into v_before, v_source, v_definition
    from pg_proc as p where p.oid = v_oid;

    if pg_get_function_result(v_oid) <> v_rpc.result_type
      or not (v_before->>'prosecdef')::boolean
      or coalesce(v_before->>'proconfig', '') not like '%search_path=%'
    then
      raise exception 'Revisión requerida: contrato inesperado en %', v_rpc.signature;
    end if;

    if v_rpc.signature = 'public.buscar_creditos_admin(text)' then
      -- Filter in ON, never WHERE: retain credits with no valid payments.
      v_pattern := '(\mleft\s+join\s+public\.pagos\s+(?:as\s+)?pg\s+on\s+pg\.credito_id\s*=\s*cr\.id\M)';
    else
      v_pattern := '(\mwhere\s+pg\.credito_id\s*=\s*cr\.id\M)';
    end if;

    if regexp_count(v_source, v_pattern, 1, 'i') <> v_rpc.expected_matches
      or regexp_count(v_source, '\mpg\.estado\M', 1, 'i') <> 0
    then
      raise exception 'Revisión requerida: consultas inesperadas o ya filtradas en %', v_rpc.signature;
    end if;

    v_patched := regexp_replace(
      v_source, v_pattern, $replacement$\1 and pg.estado = 'VALIDO'$replacement$, 'gi'
    );
    if v_patched = v_source
      or regexp_count(v_patched, '\mpg\.estado\s*=\s*''VALIDO''', 1, 'i') <> v_rpc.expected_matches
    then
      raise exception 'Revisión requerida: filtros incompletos en %', v_rpc.signature;
    end if;

    -- CREATE OR REPLACE from the existing DDL retains owner, grants and options.
    execute replace(v_definition, v_source, v_patched);

    select to_jsonb(p) - 'prosrc' into v_after
    from pg_proc as p where p.oid = v_oid;
    if v_after is distinct from v_before
      or (select p.prosrc from pg_proc as p where p.oid = v_oid) is distinct from v_patched
    then
      raise exception 'Metadatos, ACL o cuerpo inesperados en %: rollback', v_rpc.signature;
    end if;
  end loop;
end;
$migration$;
