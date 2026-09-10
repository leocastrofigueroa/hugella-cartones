-- PREPARED ONLY. Do not run remotely without explicit user authorization.
-- Read-only metadata; no customer/payment rows and no secrets.
select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as identity_args,
       pg_get_function_result(p.oid) as result, p.provolatile, p.prosecdef,
       pg_get_userbyid(p.proowner) as owner, p.proacl, p.proconfig,
       pg_get_functiondef(p.oid) as definition
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in
 ('buscar_creditos_admin','registrar_pago_admin','get_carton_publico',
  'hugella_fecha_comercial','hugella_cuotas_exigibles','hugella_estado_credito');

select conname, contype, convalidated, pg_get_constraintdef(oid) as definition
from pg_constraint where conrelid='public.creditos'::regclass;

select table_name, column_name, data_type, udt_name, is_nullable, column_default
from information_schema.columns
where table_schema='public' and table_name in ('creditos','pagos');

select c.relname, t.tgname, pg_get_triggerdef(t.oid) as definition
from pg_trigger t join pg_class c on c.oid=t.tgrelid
where t.tgrelid in ('public.creditos'::regclass,'public.pagos'::regclass)
  and not t.tgisinternal;
