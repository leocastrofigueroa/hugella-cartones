-- Corrección descriptiva auditada: conserva todas las identidades y relaciones.
begin;
lock table public.operaciones_financieras_compras in access exclusive mode;
do $preflight$
begin
  if to_regprocedure('public.editar_tarjeta_credito_admin(uuid,uuid,text,text,text,text)') is not null
    or to_regprocedure('public.iniciar_operacion_financiera_compras(uuid,text,jsonb)') is null
    or to_regprocedure('public.finalizar_operacion_financiera_compras(uuid,text,jsonb,jsonb)') is null
    or to_regclass('public.tarjetas_credito_identidad_logica_idx') is null then
    raise exception 'Backend financiero incompatible';
  end if;
  if not exists(select 1 from pg_catalog.pg_constraint where conrelid='public.operaciones_financieras_compras'::regclass
    and conname='operaciones_financieras_compras_accion_check' and convalidated
    and pg_get_constraintdef(oid) = $$CHECK ((accion = ANY (ARRAY['TARJETA'::text, 'PERIODO'::text, 'FINANCIACION'::text, 'PRIMER_PERIODO'::text, 'PAGO_RESUMEN'::text, 'COMPRA_FINANCIADA'::text])))$$) then
    raise exception 'Acciones financieras incompatibles';
  end if;
end;
$preflight$;
alter table public.operaciones_financieras_compras drop constraint operaciones_financieras_compras_accion_check;
alter table public.operaciones_financieras_compras add constraint operaciones_financieras_compras_accion_check
  check (accion in ('TARJETA','PERIODO','FINANCIACION','PRIMER_PERIODO','PAGO_RESUMEN','COMPRA_FINANCIADA','EDICION_TARJETA'));
create function public.editar_tarjeta_credito_admin(
  p_operacion_id uuid,p_tarjeta_id uuid,p_nombre text,p_entidad text,p_nombre_anterior text,p_entidad_anterior text
) returns jsonb language plpgsql volatile security definer set search_path='' as $rpc$
declare
  v_req jsonb; v_resultado jsonb; v public.tarjetas_credito%rowtype;
  v_nombre text:=nullif(btrim(p_nombre),''); v_entidad text:=nullif(btrim(p_entidad),'');
begin
  v_req:=jsonb_build_object('tarjeta_id',p_tarjeta_id,'nombre',v_nombre,'entidad',v_entidad,
    'nombre_anterior',p_nombre_anterior,'entidad_anterior',p_entidad_anterior);
  v_resultado:=public.iniciar_operacion_financiera_compras(p_operacion_id,'EDICION_TARJETA',v_req);
  if v_resultado is not null then return v_resultado; end if;
  if p_tarjeta_id is null or v_nombre is null or v_entidad is null
    or p_nombre_anterior is null or p_entidad_anterior is null then
    raise exception 'Tarjeta, nombres y entidades obligatorios' using errcode='22023';
  end if;
  select * into v from public.tarjetas_credito where id=p_tarjeta_id for update;
  if not found then raise exception 'Tarjeta inexistente' using errcode='22023'; end if;
  if v.nombre is distinct from p_nombre_anterior or v.entidad is distinct from p_entidad_anterior then
    raise exception 'La tarjeta cambió; vuelva a consultar antes de editar' using errcode='22023';
  end if;
  update public.tarjetas_credito set nombre=v_nombre,entidad=v_entidad where id=v.id;
  v_resultado:=jsonb_build_object('operacion_id',p_operacion_id,'tarjeta_id',v.id,
    'nombre_anterior',v.nombre,'entidad_anterior',v.entidad,'nombre',v_nombre,'entidad',v_entidad);
  return public.finalizar_operacion_financiera_compras(p_operacion_id,'EDICION_TARJETA',v_req,v_resultado);
end;
$rpc$;
alter function public.editar_tarjeta_credito_admin(uuid,uuid,text,text,text,text) owner to postgres;
revoke all on function public.editar_tarjeta_credito_admin(uuid,uuid,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.editar_tarjeta_credito_admin(uuid,uuid,text,text,text,text) to authenticated;
commit;
