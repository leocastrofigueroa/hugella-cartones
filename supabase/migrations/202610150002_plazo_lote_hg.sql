-- Infraestructura exclusivamente. No ejecuta el lote ni cambia 140005/150001.
-- Entrada REST dedicada: PostgREST debe hoistar statement_timeout ANTES de la
-- sentencia principal. SET dentro de una función por sí solo no reinicia el timer.
-- Ambos nombres quedan fuera de la huella de 140005. Nunca actualizar su control.
begin;
do $compatibilidad$
begin
 if to_regprocedure('public.verificar_lote_hg_admin()') is null
  or not exists(select 1 from public.control_lote_compras_historicas
   where clave='COMPRAS_SHEETS_60_V1' and infraestructura=public.catalogo_lote_compras_historicas_interno()) then
  raise exception 'Se requiere infraestructura 140005/150001 compatible'; end if;
end;
$compatibilidad$;

create function public.ejecutar_lote_hg_admin() returns jsonb
language plpgsql volatile security definer set search_path='' set statement_timeout='45s' as $rpc$
begin
 if auth.uid() is null or auth.role() is distinct from 'authenticated' or public.es_admin_hugella() is not true then
  raise exception 'No autorizado' using errcode='42501'; end if;
 -- Delegación íntegra: conserva actor, locks, A/B/C, validaciones y una transacción.
 -- Sólo funciona como extensión efectiva de plazo si se invoca ESTA RPC en REST
 -- y el servidor aplica db-hoisted-tx-settings para statement_timeout.
 return public.importar_lote_compras_historicas_admin();
end;
$rpc$;
alter function public.ejecutar_lote_hg_admin() owner to postgres;
revoke all on function public.ejecutar_lote_hg_admin() from public,anon,authenticated,service_role;
grant execute on function public.ejecutar_lote_hg_admin() to authenticated;

-- Prueba READ ONLY de 9s, sin parámetros ni importación: permite comprobar en el
-- futuro que el camino real admite más de 8s antes de habilitar cualquier carga.
create function public.verificar_plazo_hg_admin() returns jsonb
language plpgsql stable security definer set search_path='' set statement_timeout='45s' as $probe$
declare v jsonb; inicio timestamptz;
begin
 if auth.uid() is null or auth.role() is distinct from 'authenticated' or public.es_admin_hugella() is not true then
  raise exception 'No autorizado' using errcode='42501'; end if;
 v:=public.verificar_lote_hg_admin();
 if v->>'estado_lote'='PARCIAL_O_INCONSISTENTE' then return v; end if;
 inicio:=clock_timestamp();
 perform pg_sleep(9);
 return v||jsonb_build_object('prueba_plazo','SUPERADA_9S',
  'duracion_prueba_segundos',extract(epoch from clock_timestamp()-inicio),
  'statement_timeout',current_setting('statement_timeout'));
end;
$probe$;
alter function public.verificar_plazo_hg_admin() owner to postgres;
revoke all on function public.verificar_plazo_hg_admin() from public,anon,authenticated,service_role;
grant execute on function public.verificar_plazo_hg_admin() to authenticated;

do $sin_drift$
begin
 if not exists(select 1 from public.control_lote_compras_historicas
   where clave='COMPRAS_SHEETS_60_V1' and infraestructura=public.catalogo_lote_compras_historicas_interno()) then
  raise exception 'Las nuevas entradas alteraron la huella de 140005'; end if;
end;
$sin_drift$;
notify pgrst,'reload schema';
commit;
