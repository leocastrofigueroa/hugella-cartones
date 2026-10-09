-- LOCAL ONLY. Preserve this audit after any complementary edit.
-- Rollback: revoke edit RPC execution; retain facts and immutable audit.
begin;
create table public.cambios_datos_complementarios (
 operacion_id uuid primary key,
 tipo text not null check(tipo in ('INVERSION','UBICACION')),
 credito_id uuid references public.creditos(id),
 cliente_id uuid references public.clientes(id),
 valor_anterior jsonb not null,
 valor_nuevo jsonb not null,
 actor_id uuid not null references auth.users(id),
 created_at timestamptz not null default clock_timestamp(),
 motivo text not null check(length(btrim(motivo)) between 1 and 1000),
 solicitud jsonb not null check(jsonb_typeof(solicitud)='object'),
 check((tipo='INVERSION' and credito_id is not null and cliente_id is null)
    or (tipo='UBICACION' and cliente_id is not null and credito_id is null))
);
alter table public.cambios_datos_complementarios enable row level security;
revoke all on public.cambios_datos_complementarios from public,anon,authenticated,service_role;
create function public.proteger_cambio_complementario() returns trigger
language plpgsql set search_path='' as $$
begin
 raise exception 'La auditoría es inmutable' using errcode='23514';
end;
$$;
revoke all on function public.proteger_cambio_complementario() from public,anon,authenticated,service_role;
create trigger cambios_complementarios_inmutables before update or delete
 on public.cambios_datos_complementarios for each row execute function public.proteger_cambio_complementario();

-- New facts may only be written through trusted SECURITY DEFINER operations.
-- Table grants/RLS elsewhere must not let a browser bypass these controls.
create function public.proteger_dato_complementario_directo() returns trigger
language plpgsql set search_path='' as $$
begin
 if tg_table_name='creditos' then
  if tg_op='INSERT' and new.origen='ADMIN' and new.inversion is null then
   raise exception 'Inversión positiva obligatoria para nuevas altas Admin' using errcode='23514';
  end if;
  if tg_op='UPDATE' then
   if new.inversion is not distinct from old.inversion then return new; end if;
  elsif new.inversion is null then return new;
  end if;
 else
  if tg_op='UPDATE' then
   if new.ubicacion is not distinct from old.ubicacion then return new; end if;
  elsif new.ubicacion is null then return new;
  end if;
 end if;
 if current_user in ('anon','authenticated','service_role') then
  raise exception 'Use una operación Admin controlada para modificar este dato'
    using errcode = '42501';
 end if;
 return new;
end;
$$;
revoke all on function public.proteger_dato_complementario_directo() from public,anon,authenticated,service_role;
create trigger creditos_inversion_controlada before insert or update of inversion on public.creditos
 for each row execute function public.proteger_dato_complementario_directo();
create trigger clientes_ubicacion_controlada before insert or update of ubicacion on public.clientes
 for each row execute function public.proteger_dato_complementario_directo();

-- Expected prior value prevents lost updates. JSON null means not informed.
create function public.actualizar_dato_complementario_admin(
 p_operacion_id uuid,p_tipo text,p_entidad_id uuid,p_valor_anterior_esperado jsonb,
 p_valor_nuevo jsonb,p_motivo text
) returns setof public.cambios_datos_complementarios
language plpgsql volatile security definer set search_path='' as $$
declare
 v_actor uuid := auth.uid(); v_actual jsonb; v_nuevo jsonb; v_inversion numeric;
 v_esperado jsonb := coalesce(p_valor_anterior_esperado,'null'::jsonb);
 v_ubicacion text; v_solicitud jsonb; v_evento public.cambios_datos_complementarios%rowtype;
begin
 if v_actor is null or public.es_admin_hugella() is not true then
  raise exception 'No autorizado' using errcode='42501';
 end if;
 if p_operacion_id is null or p_entidad_id is null or p_tipo is null
  or p_tipo not in ('INVERSION','UBICACION') or p_valor_nuevo is null
  or nullif(btrim(p_motivo),'') is null or length(btrim(p_motivo))>1000 then
  raise exception 'Datos de modificación inválidos' using errcode='22023';
 end if;
 -- Required argument without a default: an omitted RPC key cannot select this signature.
 -- PostgREST decodes JSON null to SQL NULL; both mean an expected unknown value.
 if jsonb_typeof(v_esperado)<>'null' then
  if p_tipo='INVERSION' then
   if jsonb_typeof(v_esperado)<>'number' then
    raise exception 'Inversión anterior esperada inválida' using errcode='22023';
   end if;
   v_inversion := (v_esperado #>> '{}')::numeric;
   if v_inversion<=0 or v_inversion>9999999999.99 or v_inversion<>round(v_inversion,2) then
    raise exception 'Inversión anterior esperada inválida' using errcode='22023';
   end if;
  elsif jsonb_typeof(v_esperado)<>'string' or nullif(btrim(v_esperado #>> '{}'),'') is null
     or length(v_esperado #>> '{}')>2000 then
   raise exception 'Ubicación anterior esperada inválida' using errcode='22023';
  end if;
 end if;
 if p_tipo='INVERSION' then
  if jsonb_typeof(p_valor_nuevo)<>'number' then
   raise exception 'Inversión positiva obligatoria' using errcode='22023';
  end if;
  v_inversion := (p_valor_nuevo #>> '{}')::numeric;
  if v_inversion<=0 or v_inversion>9999999999.99 or v_inversion<>round(v_inversion,2) then
   raise exception 'Inversión positiva numeric(12,2) obligatoria' using errcode='22023';
  end if;
  v_nuevo := to_jsonb(v_inversion);
 else
  if jsonb_typeof(p_valor_nuevo) not in ('string','null') then
   raise exception 'Ubicación inválida' using errcode='22023';
  end if;
  v_ubicacion := nullif(btrim(p_valor_nuevo #>> '{}'),'');
  if length(v_ubicacion)>2000 then raise exception 'Ubicación inválida' using errcode='22023'; end if;
  v_nuevo := coalesce(to_jsonb(v_ubicacion),'null'::jsonb);
 end if;
 v_solicitud := jsonb_build_object('tipo',p_tipo,'entidad_id',p_entidad_id,
  'anterior_esperado',v_esperado,'nuevo',v_nuevo,'motivo',btrim(p_motivo));
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('hugella:complementario:'||p_operacion_id::text,0));
 select * into v_evento from public.cambios_datos_complementarios where operacion_id=p_operacion_id;
 if found then
  if v_evento.actor_id<>v_actor or v_evento.solicitud<>v_solicitud then
   raise exception 'Operación utilizada con otra solicitud' using errcode='22023';
  end if;
  return next v_evento; return;
 end if;
 if p_tipo='INVERSION' then
  select coalesce(to_jsonb(cr.inversion),'null'::jsonb) into v_actual
   from public.creditos cr where cr.id=p_entidad_id for update;
 else
  select coalesce(to_jsonb(cl.ubicacion),'null'::jsonb) into v_actual
   from public.clientes cl where cl.id=p_entidad_id for update;
 end if;
 if not found then raise exception 'Entidad inexistente' using errcode='22023'; end if;
 if v_actual is distinct from v_esperado then
  raise exception 'El dato cambió; vuelva a consultarlo' using errcode='40001';
 end if;
 if v_actual=v_nuevo then raise exception 'El dato no cambió' using errcode='22023'; end if;
 if p_tipo='INVERSION' then update public.creditos set inversion=v_inversion where id=p_entidad_id;
 else update public.clientes set ubicacion=v_ubicacion where id=p_entidad_id; end if;
 insert into public.cambios_datos_complementarios(operacion_id,tipo,credito_id,cliente_id,
  valor_anterior,valor_nuevo,actor_id,motivo,solicitud)
 values(p_operacion_id,p_tipo,case when p_tipo='INVERSION' then p_entidad_id end,
  case when p_tipo='UBICACION' then p_entidad_id end,v_actual,v_nuevo,v_actor,btrim(p_motivo),v_solicitud)
 returning * into v_evento;
 return next v_evento;
end;
$$;
revoke all on function public.actualizar_dato_complementario_admin(uuid,text,uuid,jsonb,jsonb,text)
 from public,anon,authenticated,service_role;
grant execute on function public.actualizar_dato_complementario_admin(uuid,text,uuid,jsonb,jsonb,text) to authenticated;

create function public.hugella_fecha_fin_prevista(p_fecha_inicio date,p_cantidad_cuotas integer)
returns date language plpgsql immutable strict set search_path='' as $$
declare v_inicio date:=p_fecha_inicio; v_dias integer:=p_cantidad_cuotas-1; v_iso integer;
begin
 if not isfinite(p_fecha_inicio) or p_cantidad_cuotas<=0 then
  raise exception 'Plan inválido' using errcode='22023';
 end if;
 if v_dias=0 then return v_inicio; end if;
 -- Compatibility for historical Sunday starts: following Monday is next installment.
 if extract(isodow from v_inicio)=7 then v_inicio:=v_inicio+1; v_dias:=v_dias-1; end if;
 v_iso:=extract(isodow from v_inicio)::integer;
 return v_inicio+(v_dias::bigint+(v_dias::bigint+v_iso-1)/6)::integer;
end;
$$;
revoke all on function public.hugella_fecha_fin_prevista(date,integer) from public,anon,authenticated,service_role;
grant execute on function public.hugella_fecha_fin_prevista(date,integer) to authenticated;

-- Read-only snapshot. No token, no payment recalculation or other mutation.
create function public.obtener_ficha_credito_admin(p_credito_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_ficha jsonb;
begin
 if auth.uid() is null or public.es_admin_hugella() is not true then
  raise exception 'No autorizado' using errcode='42501';
 end if;
 select jsonb_build_object(
  'credito_id',cr.id,'cliente_id',cl.id,'nombre',cl.nombre,'dni',cl.dni,
  'telefono',cl.telefono,'domicilio',cl.domicilio,'ubicacion',cl.ubicacion,
  'codigo',cr.codigo,'producto',cr.producto,'origen',cr.origen,'fecha_inicio',cr.fecha_inicio,
  'importe_cuota',cr.importe_cuota,'cantidad_cuotas',cr.cantidad_cuotas,
  'total_contractual',cr.importe_cuota*cr.cantidad_cuotas,
  'fecha_fin_prevista',public.hugella_fecha_fin_prevista(cr.fecha_inicio,cr.cantidad_cuotas),
  'inversion',cr.inversion,'ganancia_prevista',cr.importe_cuota*cr.cantidad_cuotas-cr.inversion,
  'cuota_recuperacion_inversion',ceil(cr.inversion/cr.importe_cuota),
  'total_pagado_valido',paid.total,'cuotas_completas_pagadas',paid.cuotas,
  'remanente_actual',paid.total-paid.cuotas*cr.importe_cuota,
  'cuotas_equivalentes_monetarias',paid.total/cr.importe_cuota,
  'cuotas_plan_no_pagadas',cr.cantidad_cuotas-paid.cuotas,
  'saldo_por_cuotas_completas',cr.importe_cuota*(cr.cantidad_cuotas-paid.cuotas),
  'saldo_monetario_real',greatest(0,cr.importe_cuota*cr.cantidad_cuotas-paid.total),
  'fecha_evaluacion',public.hugella_fecha_comercial(),'cuotas_exigibles',due.cuotas,
  'diferencia_cuotas',paid.cuotas-due.cuotas,
  'cuotas_atrasadas',greatest(0,due.cuotas-paid.cuotas),
  'importe_atrasado',greatest(0,due.cuotas*cr.importe_cuota-paid.total),
  'estado',coalesce(cierre.tipo,public.hugella_estado_credito(cr.cantidad_cuotas,paid.cuotas,due.cuotas)),
  'cobranza_futura_habilitada',cierre.credito_id is null,
  'calculos_solo_historicos',cierre.credito_id is not null,
  'tipo_cierre',cierre.tipo,'fecha_cierre',cierre.fecha
 ) into v_ficha
 from public.creditos cr join public.clientes cl on cl.id=cr.cliente_id
 left join public.cierres_creditos cierre on cierre.credito_id=cr.id
 cross join lateral(select coalesce(sum(pg.importe),0) total,
   least(cr.cantidad_cuotas::bigint,coalesce(sum(greatest(coalesce(pg.cuotas_aplicadas,0),0)),0)::bigint) cuotas
   from public.pagos pg where pg.credito_id=cr.id and pg.estado='VALIDO') paid
 cross join lateral(select public.hugella_cuotas_exigibles(cr.fecha_inicio,cr.cantidad_cuotas) cuotas) due
 where cr.id=p_credito_id;
 return v_ficha;
end;
$$;
revoke all on function public.obtener_ficha_credito_admin(uuid) from public,anon,authenticated,service_role;
grant execute on function public.obtener_ficha_credito_admin(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
