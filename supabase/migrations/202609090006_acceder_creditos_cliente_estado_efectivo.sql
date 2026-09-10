-- HUGELLA V1 — documentation/preflight for the manual production correction.
--
-- The full body of acceder_creditos_cliente(text,text) is not versioned in this
-- repository. Therefore this migration deliberately does not reconstruct or
-- replace the RPC: it records the exact state that was applied manually and
-- fails closed if the installed function does not match it.
--
-- This script is read-only and does not modify rows, RLS, Apps Script, table
-- privileges, or any function. It can be used as a migration-history marker
-- after the remote correction has already been reviewed/applied manually.
-- No service_role, secrets, credentials, or customer data are used.

begin;

do $preflight$
declare
  v_oid oid := to_regprocedure('public.acceder_creditos_cliente(text,text)');
  v_source text;
  v_result text;
  v_acl jsonb;
begin
  if v_oid is null then
    raise exception 'Revisión requerida: falta public.acceder_creditos_cliente(text,text)';
  end if;

  select p.prosrc,
         pg_get_function_result(p.oid),
         to_jsonb(p) - 'prosrc'
    into v_source, v_result, v_acl
  from pg_proc as p
  where p.oid = v_oid;

  if v_result <>
    'TABLE(access_token uuid, codigo text, producto text, estado text)' then
    raise exception 'Revisión requerida: RETURNS TABLE inesperado';
  end if;

  if not (v_acl->>'prosecdef')::boolean
    or v_acl->>'provolatile' <> 's'
    or v_acl->'proargnames'->>0 <> 'p_dni'
    or v_acl->'proargnames'->>1 <> 'p_ultimos4'
    or v_acl->>'proconfig' not like '%search_path=%' then
    raise exception 'Revisión requerida: contrato de seguridad inesperado';
  end if;

  -- Exact effective-state expression applied in production. Whitespace and
  -- formatting are ignored; the monetary source remains SUM cuotas_aplicadas.
  if strpos(regexp_replace(lower(v_source), '[[:space:]]', '', 'g'),
    'public.hugella_estado_credito(cr.cantidad_cuotas,coalesce((selectsum(coalesce(pg.cuotas_aplicadas,0))frompublic.pagospgwherepg.credito_id=cr.id),0)::bigint,public.hugella_cuotas_exigibles(cr.fecha_inicio,cr.cantidad_cuotas))') = 0 then
    raise exception 'Revisión requerida: no se encontró el estado efectivo esperado';
  end if;

  -- The production function must not be executable by authenticated or public;
  -- anon remains the only application role with EXECUTE.
  if not has_function_privilege('anon', v_oid, 'EXECUTE')
    or has_function_privilege('authenticated', v_oid, 'EXECUTE')
    or exists (
      select 1
      from pg_proc as fn
      cross join lateral aclexplode(coalesce(fn.proacl, acldefault('f', fn.proowner))) as acl
      where fn.oid = v_oid
        and acl.grantee = 0
        and acl.privilege_type = 'EXECUTE'
    ) then
    raise exception 'Revisión requerida: permisos de acceder_creditos_cliente inesperados';
  end if;
end;
$preflight$;

commit;
