-- Sólo infraestructura para verificación autenticada; nunca invoca el importador.
-- 140005 aprobada e inmutable: d27d59c450da90b2c2f149b75dd259e50f362c67bd8175e96fdb51c593b992b9
-- El nombre verificar_lote_hg_admin NO coincide con los filtros de catálogo de
-- 140005 (%compra%, %tarjeta%, %historica%, es_admin_hugella). Sin tablas nuevas,
-- cambios de ACL/configuración a objetos previos ni actualización de snapshots.
begin;
do $instalacion$
begin
 if to_regprocedure('public.importar_lote_compras_historicas_admin()') is null then
  raise exception 'Falta 140005'; end if;
 if not exists(select 1 from public.control_lote_compras_historicas
   where clave='COMPRAS_SHEETS_60_V1' and infraestructura=public.catalogo_lote_compras_historicas_interno()) then
  raise exception 'Catálogo previo incompatible con 140005'; end if;
end;
$instalacion$;

create function public.verificar_lote_hg_admin() returns jsonb
language plpgsql stable security definer set search_path='' as $preflight$
declare
 actor uuid:=auth.uid(); rol text:=auth.role();
 ctl public.control_lote_compras_historicas%rowtype;
 actual jsonb; estado text; diagnostico text; f oid;
begin
 if actor is null or rol is distinct from 'authenticated' or public.es_admin_hugella() is not true then
  raise exception 'No autorizado' using errcode='42501'; end if;
 -- Sin locks de escritura, SET, DML ni llamadas al importador. En la app se
 -- invoca mediante GET PostgREST, que añade una transacción READ ONLY.
 begin
  if current_setting('server_version_num')::integer<170000 then
   raise exception 'Se requiere PostgreSQL 17'; end if;
  select * into strict ctl from public.control_lote_compras_historicas where clave='COMPRAS_SHEETS_60_V1';
  if ctl.infraestructura is distinct from public.catalogo_lote_compras_historicas_interno() then
   raise exception 'Infraestructura/ACL cambió respecto de 140005'; end if;
  f:=to_regprocedure('public.importar_lote_compras_historicas_admin()');
  if f is null or not exists(select 1 from pg_proc p where p.oid=f and p.prorettype='jsonb'::regtype
   and p.pronargs=0 and p.prokind='f' and p.prosecdef and p.provolatile='v'
   and p.proowner='postgres'::regrole and p.proconfig=array['search_path=""']
   and md5(p.prosrc)='62ab43b1ee2c03d804118cf73eb4b289') then
   raise exception 'Firma/cuerpo/configuración del importador incompatible'; end if;
  if not has_function_privilege('authenticated',f,'EXECUTE')
   or exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    where p.oid=f and a.privilege_type='EXECUTE' and a.grantee not in ('postgres'::regrole,'authenticated'::regrole)) then
   raise exception 'Permisos del importador incompatibles'; end if;
  -- Únicos campos reales agregados tras cerrar la evidencia del tramo/inicio.
  -- No se altera 140005 ni se inventan timestamps de otras filas.
  if (select count(*) from public.tramos_pago_compras where compra_id='7171c5cb-90dc-4a41-a470-29b207bc2895')<>1
   or exists(select * from (values
    ('362fba80-fa95-49ff-8514-22dbf1627c2d'::uuid,'7171c5cb-90dc-4a41-a470-29b207bc2895'::uuid,1,'TARJETA_CREDITO',
     343499::numeric,'6087c186-6e63-4469-9b4d-99f0873caf5e'::uuid,3,null::date,
     '2026-10-11 20:49:42.7306+00'::timestamptz,'NORMAL',null::numeric)
   ) esperado except select id,compra_id,posicion,medio,importe,tarjeta_id,cantidad_cuotas,fecha_pago,created_at,
    estrategia_distribucion,valor_cuota_historico from public.tramos_pago_compras) then
   raise exception 'Tramo real de impresora incompatible'; end if;
  if exists(select * from (values
    ('362fba80-fa95-49ff-8514-22dbf1627c2d'::uuid,'5d5a4689-416e-451b-add1-ec71fd3eea36'::uuid,
     '34366896-c76c-4959-ac05-519274da9736'::uuid,'2026-10-11 20:49:42.738671+00'::timestamptz)
   ) esperado except select tramo_id,primer_periodo_id,actor_id,created_at from public.inicios_tramos_tarjeta) then
   raise exception 'Inicio real de impresora incompatible'; end if;
  actual:=public.snapshot_lote_compras_historicas_interno();
  if ctl.actor_id is null then
   perform public.validar_baseline_lote_compras_historicas_interno();
   if actual is distinct from ctl.baseline_instalacion then
    raise exception 'Baseline cambió desde instalación'; end if;
   estado:='LISTO_PARA_IMPORTAR';
  else
   if actual is distinct from ctl.despues then
    raise exception 'Lote aplicado cambió; revisión manual'; end if;
   perform public.validar_resultado_lote_compras_historicas_interno(true,ctl.actor_id);
   estado:='YA_APLICADO_CORRECTAMENTE';
  end if;
 exception when raise_exception or no_data_found or too_many_rows then
  estado:='PARCIAL_O_INCONSISTENTE';
  diagnostico:=sqlerrm;
 end;
 return jsonb_build_object('estado_lote',estado,'actor_id',actor,'administrador',true,
  'rol_jwt',rol,'solo_lectura',true,'diagnostico',diagnostico,
  'statement_timeout',current_setting('statement_timeout'),
  'transaction_read_only',current_setting('transaction_read_only'));
end;
$preflight$;
alter function public.verificar_lote_hg_admin() owner to postgres;
revoke all on function public.verificar_lote_hg_admin() from public,anon,authenticated,service_role;
grant execute on function public.verificar_lote_hg_admin() to authenticated;

-- Comprobación posterior al DDL: ni el catálogo ni el control de 140005 cambian.
do $compatibilidad$
begin
 if not exists(select 1 from public.control_lote_compras_historicas
   where clave='COMPRAS_SHEETS_60_V1' and infraestructura=public.catalogo_lote_compras_historicas_interno()) then
  raise exception 'El preflight alteró la huella de 140005'; end if;
end;
$compatibilidad$;
-- Actualiza exclusivamente la caché de esquema de PostgREST al confirmar DDL.
notify pgrst,'reload schema';
commit;
