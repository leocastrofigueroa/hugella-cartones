begin;

grant usage on schema public to service_role;

grant select, update
  on table public.configuracion_contratos
  to service_role;

grant select
  on table public.autorizados_contratos
  to service_role;

grant select
  on table public.creditos, public.clientes
  to service_role;

grant select, insert, update, delete
  on table public.contratos
  to service_role;

grant select, insert, update, delete
  on table public.eventos_contrato
  to service_role;

grant usage, select
  on sequence public.eventos_contrato_id_seq
  to service_role;

commit;