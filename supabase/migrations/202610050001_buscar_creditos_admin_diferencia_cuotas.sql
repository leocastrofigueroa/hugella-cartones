-- Local migration only. Requires the existing credit-closure wrapper.
begin;

do $migration$
declare
  v_oid oid := to_regprocedure('public.buscar_creditos_admin(text)');
  v_before jsonb; v_after jsonb; v_source text; v_ddl text; v_owner text;
  v_acl aclitem[]; v_grant record; v_comment text;
  v_result text := 'TABLE(credito_id uuid, nombre_cliente text, codigo_credito text, producto text, importe_cuota numeric, cantidad_cuotas integer, cuotas_pagadas integer, cuotas_pendientes integer, estado text)';
  v_expected text := $body$begin
       return query select r.credito_id, r.nombre_cliente, r.codigo_credito, r.producto,
         r.importe_cuota, r.cantidad_cuotas, r.cuotas_pagadas,
         case when c.credito_id is null then r.cuotas_pendientes else 0 end,
         coalesce(c.tipo, r.estado)
       from public.hugella_base_buscar_creditos_admin(p_busqueda) r
       left join public.cierres_creditos c on c.credito_id = r.credito_id
       order by case when lower(r.codigo_credito) = lower(btrim(p_busqueda)) then 0 else 1 end,
         r.nombre_cliente, r.codigo_credito;
     end;$body$;
begin
  if v_oid is null then raise exception 'Revisión requerida: falta buscar_creditos_admin'; end if;
  select to_jsonb(p), p.prosrc, pg_get_functiondef(p.oid), pg_get_userbyid(p.proowner),
    coalesce(p.proacl, acldefault('f', p.proowner)), obj_description(p.oid, 'pg_proc')
    into v_before, v_source, v_ddl, v_owner, v_acl, v_comment
    from pg_proc p where p.oid = v_oid;
  if pg_get_function_result(v_oid) <> v_result
    or pg_get_function_arguments(v_oid) <> 'p_busqueda text'
    or not (v_before->>'prosecdef')::boolean
    or v_before->>'provolatile' <> 's'
    or v_before->'proconfig' is distinct from '["search_path=\"\""]'::jsonb
    or regexp_replace(v_source, '\s', '', 'g') <> regexp_replace(v_expected, '\s', '', 'g')
    or to_regprocedure('public.hugella_base_buscar_creditos_admin(text)') is null
    or to_regprocedure('public.hugella_cuotas_exigibles(date,integer,date)') is null then
    raise exception 'Revisión requerida: contrato o wrapper de cierres inesperado. Diagnóstico: %',
      jsonb_build_object(
        'v_oid', v_oid,
        'resultado_real', pg_get_function_result(v_oid),
        'v_result', v_result,
        'argumentos', pg_get_function_arguments(v_oid),
        'prosecdef', v_before->'prosecdef',
        'provolatile', v_before->'provolatile',
        'proconfig', v_before->'proconfig',
        'base_rpc', to_regprocedure('public.hugella_base_buscar_creditos_admin(text)')::text,
        'helper', to_regprocedure('public.hugella_cuotas_exigibles(date,integer,date)')::text,
        'falla_resultado', pg_get_function_result(v_oid) <> v_result,
        'falla_argumentos', pg_get_function_arguments(v_oid) <> 'p_busqueda text',
        'falla_security_definer', not (v_before->>'prosecdef')::boolean,
        'falla_volatilidad', v_before->>'provolatile' <> 's',
        'falla_configuracion', v_before->'proconfig' is distinct from '["search_path=\"\""]'::jsonb,
        'falla_codigo_normalizado', regexp_replace(v_source, '\s', '', 'g') <> regexp_replace(v_expected, '\s', '', 'g'),
        'falla_base_rpc', to_regprocedure('public.hugella_base_buscar_creditos_admin(text)') is null,
        'falla_helper', to_regprocedure('public.hugella_cuotas_exigibles(date,integer,date)') is null
      );
  end if;
  -- Keep the base RPC (auth, valid payments, status, search and limit) unchanged.
  -- Both helper evaluations share the same statement_timestamp/commercial date.
  v_ddl := replace(v_ddl, v_source, replace(replace(v_expected,
    'coalesce(c.tipo, r.estado)',
    'coalesce(c.tipo, r.estado), r.cuotas_pagadas - public.hugella_cuotas_exigibles(cr.fecha_inicio, r.cantidad_cuotas)'),
    'left join public.cierres_creditos c',
    'join public.creditos cr on cr.id = r.credito_id left join public.cierres_creditos c'));
  v_ddl := replace(v_ddl, v_result, replace(v_result, 'estado text)', 'estado text, diferencia_cuotas integer)'));

  -- PostgreSQL requires recreation to extend TABLE output. No CASCADE: unknown
  -- dependencies abort the entire transaction instead of being removed.
  drop function public.buscar_creditos_admin(text);
  execute v_ddl;
  execute format('alter function public.buscar_creditos_admin(text) owner to %I', v_owner);
  -- Remove any default grants on the recreated function, then restore old ACL.
  for v_grant in select distinct grantee from pg_proc p,
    lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner)))
    where p.oid = 'public.buscar_creditos_admin(text)'::regprocedure loop
    execute format('revoke all on function public.buscar_creditos_admin(text) from %s',
      case when v_grant.grantee = 0 then 'public' else quote_ident(pg_get_userbyid(v_grant.grantee)) end);
  end loop;
  for v_grant in select * from aclexplode(v_acl) loop
    execute format('grant %s on function public.buscar_creditos_admin(text) to %s%s',
      v_grant.privilege_type,
      case when v_grant.grantee = 0 then 'public' else quote_ident(pg_get_userbyid(v_grant.grantee)) end,
      case when v_grant.is_grantable then ' with grant option' else '' end);
  end loop;
  execute format('comment on function public.buscar_creditos_admin(text) is %L', v_comment);
  select to_jsonb(p) into v_after from pg_proc p
    where p.oid = 'public.buscar_creditos_admin(text)'::regprocedure;
  if (v_before - array['oid','prosrc','proallargtypes','proargmodes','proargnames','proacl'])
    is distinct from (v_after - array['oid','prosrc','proallargtypes','proargmodes','proargnames','proacl'])
    or (select array_agg(x::text order by x::text) from unnest(v_acl) x)
      is distinct from (select array_agg(x::text order by x::text)
        from pg_proc p, lateral unnest(p.proacl) x
        where p.oid = 'public.buscar_creditos_admin(text)'::regprocedure) then
    raise exception 'Revisión requerida: metadatos o permisos cambiaron';
  end if;
end;
$migration$;

notify pgrst, 'reload schema';
commit;
