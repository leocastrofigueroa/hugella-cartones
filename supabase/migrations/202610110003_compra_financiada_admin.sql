-- 11D.5.4 LOCAL: alta atómica y lecturas financieras. Sin semillas ni UI.
begin;

do $preflight$
declare v record;
begin
  for v in select * from (values
    ('public.validar_financiacion_compras_integridad()','b7fd97c260a4dfb2526ea88b463a3722'),
    ('public.proteger_financiacion_compras()','5a7ff422d4ee99474154a431b09d0a58'),
    ('public.proteger_pagos_tarjetas()','1d9e9b8a038def57bc431e687f140e6a'),
    ('public.proteger_periodos_tarjetas()','b0f74a8189fcae71a409c101aba21fa1'),
    ('public.crear_compra_gasto_admin(uuid,text,uuid,date,text,text,text,jsonb)','c12fd08eca171b7af8e5fb9b433fb23b'),
    ('public.iniciar_operacion_financiera_compras(uuid,text,jsonb)','24f3395e9cd1e4f902cfcc111a2fa4ff'),
    ('public.finalizar_operacion_financiera_compras(uuid,text,jsonb,jsonb)','1f5cbf8eb06f5d71c8d3ad4abd262512'),
    ('public.confirmar_financiacion_compra_admin(uuid,uuid,jsonb)','a67b8009a725553ecf4d8f7bf364f146'),
    ('public.obtener_financiacion_compra_admin(uuid)','68a8cec7d027821a4b28abb9cbb5b19b'),
    ('public.obtener_saldo_periodo_tarjeta_admin(uuid)','d62ddafec982e9930fdb8ee4b0f77853'),
    ('public.asignar_obligaciones_tarjeta_interno(uuid)','f01c251acd5a323056f71722f73398ea')) x(firma,hash) loop
    if not exists(select 1 from pg_catalog.pg_proc p where p.oid=pg_catalog.to_regprocedure(v.firma)
      and md5(p.prosrc)=v.hash and p.proowner='postgres'::regrole
      and p.prosecdef and p.proconfig=array['search_path=""']) then
      raise exception 'Baseline RPC incompatible: %',v.firma;
    end if;
  end loop;
  if exists(select 1 from pg_catalog.pg_proc p where p.pronamespace='public'::regnamespace
    and p.proname in ('crear_compra_financiada_admin','obtener_detalle_financiacion_compra_admin','listar_resumenes_tarjeta_admin')) then
    raise exception 'RPC 11D.5.4 existente: revisión requerida';
  end if;
  if exists(select 1 from pg_catalog.pg_class c where c.oid in (
    'public.compras_gastos'::regclass,'public.items_compras_gastos'::regclass,
    'public.operaciones_compras_gastos'::regclass,'public.operaciones_financieras_compras'::regclass,
    'public.tarjetas_credito'::regclass,'public.financiaciones_compras'::regclass,
    'public.periodos_tarjetas'::regclass,'public.tramos_pago_compras'::regclass,
    'public.obligaciones_tarjetas'::regclass,'public.pagos_resumenes_tarjetas'::regclass,
    'public.aplicaciones_pagos_obligaciones'::regclass,'public.inicios_tramos_tarjeta'::regclass)
    and (c.relowner<>'postgres'::regrole or not c.relrowsecurity
      or exists(select 1 from pg_catalog.pg_policy where polrelid=c.oid)
      or exists(select 1 from pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) acl
        where acl.grantee in (0,'anon'::regrole::oid,'authenticated'::regrole::oid,'service_role'::regrole::oid)))) then
    raise exception 'Seguridad de tablas incompatible';
  end if;
  if not exists(select 1 from pg_catalog.pg_attribute a join pg_catalog.pg_attrdef d
    on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid='public.items_compras_gastos'::regclass
    and a.attname='total' and a.attgenerated='s'
    and pg_catalog.pg_get_expr(d.adbin,d.adrelid)='round((cantidad * costo_unitario), 2)') then
    raise exception 'Total económico incompatible';
  end if;
  if not exists(select 1 from pg_catalog.pg_constraint where conrelid='public.operaciones_financieras_compras'::regclass
    and conname='operaciones_financieras_compras_accion_check' and contype='c' and convalidated
    and pg_catalog.pg_get_expr(conbin,conrelid)=
      '(accion = ANY (ARRAY[''TARJETA''::text, ''PERIODO''::text, ''FINANCIACION''::text, ''PRIMER_PERIODO''::text, ''PAGO_RESUMEN''::text]))') then
    raise exception 'Acciones financieras incompatibles';
  end if;
  for v in select * from (values
    ('compras_gastos','compra_financiada_inmutable','proteger_financiacion_compras',27,false),
    ('items_compras_gastos','items_compra_financiada_inmutables','proteger_financiacion_compras',31,false),
    ('financiaciones_compras','financiacion_confirmada_inmutable','proteger_financiacion_compras',31,false),
    ('tramos_pago_compras','tramo_confirmado_inmutable','proteger_financiacion_compras',31,false),
    ('obligaciones_tarjetas','obligacion_confirmada_inmutable','proteger_financiacion_compras',31,false),
    ('periodos_tarjetas','periodo_utilizado_inmutable','proteger_periodos_tarjetas',31,false),
    ('pagos_resumenes_tarjetas','pago_resumen_inmutable','proteger_pagos_tarjetas',31,false),
    ('aplicaciones_pagos_obligaciones','aplicacion_pago_inmutable','proteger_pagos_tarjetas',31,false),
    ('financiaciones_compras','financiacion_integridad','validar_financiacion_compras_integridad',29,true),
    ('tramos_pago_compras','tramos_integridad','validar_financiacion_compras_integridad',29,true),
    ('obligaciones_tarjetas','obligaciones_integridad','validar_financiacion_compras_integridad',29,true),
    ('periodos_tarjetas','periodos_integridad','validar_financiacion_compras_integridad',29,true),
    ('pagos_resumenes_tarjetas','pagos_resumen_integridad','validar_financiacion_compras_integridad',29,true),
    ('aplicaciones_pagos_obligaciones','aplicaciones_integridad','validar_financiacion_compras_integridad',29,true)
  ) x(tabla,nombre,funcion,tipo,diferido) loop
    if not exists(select 1 from pg_catalog.pg_trigger t
      where t.tgrelid=pg_catalog.to_regclass('public.'||v.tabla) and t.tgname=v.nombre
      and not t.tgisinternal and t.tgenabled='O' and t.tgtype=v.tipo
      and t.tgfoid=pg_catalog.to_regprocedure('public.'||v.funcion||'()')
      and t.tgdeferrable=v.diferido and t.tginitdeferred=v.diferido
      and ((t.tgconstraint<>0)=v.diferido) and t.tgqual is null and t.tgnargs=0) then
      raise exception 'Trigger financiero incompatible: %',v.nombre;
    end if;
  end loop;
end;
$preflight$;

alter table public.operaciones_financieras_compras drop constraint operaciones_financieras_compras_accion_check;
alter table public.operaciones_financieras_compras add constraint operaciones_financieras_compras_accion_check
  check (accion in ('TARJETA','PERIODO','FINANCIACION','PRIMER_PERIODO','PAGO_RESUMEN','COMPRA_FINANCIADA'));

create function public.crear_compra_financiada_admin(
  p_operacion_id uuid,p_tipo text,p_proveedor_id uuid,p_fecha date,
  p_moneda text,p_comprobante text,p_observaciones text,p_items jsonb,p_tramos jsonb
) returns jsonb language plpgsql volatile security definer set search_path='' as $rpc$
declare
  v_actor uuid:=auth.uid();
  v_items jsonb:='[]'; v_item jsonb; v_request jsonb;
  v_posicion integer; v_cantidad numeric; v_costo numeric; v_descripcion text;
  v_tramo_input jsonb; v_tramos jsonb:='[]';
  v_pos integer; v_medio text; v_importe numeric; v_cuotas integer;
  v_tarjeta uuid; v_primero uuid; v_fecha date;
  v_compra_op uuid; v_fin_op uuid; v_lock bigint;
  v_res jsonb; v_compra jsonb; v_fin jsonb; v_req jsonb;
begin
  if v_actor is null or public.es_admin_hugella() is not true then raise exception 'No autorizado' using errcode='42501'; end if;
  -- Canonicalización idéntica a las RPC instaladas (fingerprints arriba).
  -- La creación, SUM(total), suma de tramos y reparto monetario se delegan a ellas.
  if p_operacion_id is null or p_tipo is null or p_tipo not in ('MERCADERIA','GASTO')
    or p_proveedor_id is null or p_fecha is null or not isfinite(p_fecha)
    or p_moneda is null or p_moneda !~ '^[A-Z]{3}$' then
    raise exception 'Cabecera inválida' using errcode='22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Ítems debe ser un array' using errcode='22023';
  end if;
  if jsonb_array_length(p_items) not between 1 and 1000 then
    raise exception 'Se requieren de 1 a 1000 ítems' using errcode='22023';
  end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Ítem inválido' using errcode='22023';
    end if;
    if not (v_item ?& array['posicion','descripcion','cantidad','costo_unitario'])
      or (v_item - array['posicion','descripcion','cantidad','costo_unitario']) <> '{}'::jsonb
      or jsonb_typeof(v_item->'posicion') <> 'number'
      or jsonb_typeof(v_item->'descripcion') <> 'string'
      or jsonb_typeof(v_item->'cantidad') <> 'number'
      or jsonb_typeof(v_item->'costo_unitario') <> 'number' then
      raise exception 'Campos de ítem inválidos; total no se acepta' using errcode='22023';
    end if;
    if (v_item->>'posicion')::numeric <> trunc((v_item->>'posicion')::numeric)
      or (v_item->>'posicion')::numeric not between 1 and 2147483647 then
      raise exception 'Posición inválida' using errcode='22023';
    end if;
    v_posicion := ((v_item->>'posicion')::numeric)::integer;
    v_descripcion := nullif(btrim(v_item->>'descripcion'), '');
    v_cantidad := (v_item->>'cantidad')::numeric;
    v_costo := (v_item->>'costo_unitario')::numeric;
    if v_descripcion is null or v_cantidad <= 0 or v_cantidad >= 1000000000000
      or v_cantidad <> round(v_cantidad,6) or v_costo < 0 or v_costo >= 1000000000000
      or v_costo <> round(v_costo,6) or round(v_cantidad*v_costo,2) > 9999999999999999.99 then
      raise exception 'Descripción, cantidad o costo inválido' using errcode='22023';
    end if;
    v_items := v_items || jsonb_build_array(jsonb_build_object('posicion',v_posicion,
      'descripcion',v_descripcion,'cantidad',v_cantidad,'costo_unitario',v_costo));
  end loop;
  if exists(select 1 from jsonb_array_elements(v_items) x group by x->>'posicion' having count(*)>1) then
    raise exception 'Posición duplicada' using errcode='22023';
  end if;
  select jsonb_agg(x order by (x->>'posicion')::integer) into v_items from jsonb_array_elements(v_items) x;
  v_request := jsonb_build_object('tipo',p_tipo,'proveedor_id',p_proveedor_id,'fecha',p_fecha,
    'moneda',p_moneda,'comprobante',nullif(btrim(p_comprobante),''),
    'observaciones',nullif(btrim(p_observaciones),''),'items',v_items);
  if p_tramos is null or jsonb_typeof(p_tramos)<>'array'
    or jsonb_array_length(p_tramos)>1000 then raise exception 'Tramos inválidos' using errcode='22023'; end if;
  for v_tramo_input in select value from jsonb_array_elements(p_tramos) loop
    if jsonb_typeof(v_tramo_input)<>'object' or not (v_tramo_input ?& array['posicion','medio','importe'])
      or (v_tramo_input-array['posicion','medio','importe','tarjeta_id','cantidad_cuotas','fecha_pago','primer_periodo_id'])<>'{}'
      or jsonb_typeof(v_tramo_input->'posicion')<>'number' or jsonb_typeof(v_tramo_input->'medio')<>'string'
      or jsonb_typeof(v_tramo_input->'importe')<>'number' then raise exception 'Campos de tramo inválidos' using errcode='22023'; end if;
    if (v_tramo_input->>'posicion')::numeric<>trunc((v_tramo_input->>'posicion')::numeric)
      or (v_tramo_input->>'posicion')::numeric not between 1 and 1000 then raise exception 'Posición inválida' using errcode='22023'; end if;
    v_pos:=(v_tramo_input->>'posicion')::integer; v_medio:=v_tramo_input->>'medio'; v_importe:=(v_tramo_input->>'importe')::numeric;
    if v_medio not in ('EFECTIVO','TRANSFERENCIA','TARJETA_DEBITO','TARJETA_CREDITO')
      or v_importe<=0 or v_importe>=1000000000000000000 or v_importe<>round(v_importe,2) then
      raise exception 'Medio o importe inválido' using errcode='22023'; end if;
    v_tarjeta:=(v_tramo_input->>'tarjeta_id')::uuid; v_primero:=(v_tramo_input->>'primer_periodo_id')::uuid; v_fecha:=(v_tramo_input->>'fecha_pago')::date;
    v_cuotas:=null;
    if v_medio='TARJETA_CREDITO' then
      if v_tarjeta is null or v_fecha is not null or jsonb_typeof(v_tramo_input->'cantidad_cuotas') is distinct from 'number'
        or (v_tramo_input->>'cantidad_cuotas')::numeric<>trunc((v_tramo_input->>'cantidad_cuotas')::numeric)
        or (v_tramo_input->>'cantidad_cuotas')::numeric not between 1 and 1000
        or (v_tramo_input->>'cantidad_cuotas')::numeric>v_importe*100 then raise exception 'Cuotas de tarjeta inválidas' using errcode='22023'; end if;
      v_cuotas:=(v_tramo_input->>'cantidad_cuotas')::integer;
    elsif v_tarjeta is not null or v_primero is not null or v_tramo_input->>'cantidad_cuotas' is not null
      or v_fecha is null or not isfinite(v_fecha) then raise exception 'Tramo inmediato inválido' using errcode='22023'; end if;
    v_tramos:=v_tramos||jsonb_build_array(jsonb_build_object('posicion',v_pos,'medio',v_medio,'importe',v_importe,
      'tarjeta_id',v_tarjeta,'cantidad_cuotas',v_cuotas,'fecha_pago',v_fecha,'primer_periodo_id',v_primero));
  end loop;
  if exists(select 1 from jsonb_array_elements(v_tramos) j group by j->>'posicion' having count(*)>1) then
    raise exception 'Posición duplicada' using errcode='22023'; end if;
  select coalesce(jsonb_agg(j order by (j->>'posicion')::integer),'[]') into v_tramos from jsonb_array_elements(v_tramos) j;

  v_req:=jsonb_build_object('compra',v_request,'tramos',v_tramos);
  -- Identidades internas determinísticas, con dominios diferentes. No son UUID aleatorios ni UUIDv5.
  v_compra_op:=md5('hugella:compra-financiada:compra:v1:'||p_operacion_id::text)::uuid;
  v_fin_op:=md5('hugella:compra-financiada:financiacion:v1:'||p_operacion_id::text)::uuid;
  if v_compra_op=p_operacion_id or v_fin_op=p_operacion_id or v_compra_op=v_fin_op then
    raise exception 'Identidades internas incompatibles' using errcode='23514';
  end if;
  -- Todas las identidades ANTES del lock financiero global. Orden estable para wrappers.
  -- Reutilizar confirmar_financiacion después del global sin este paso invertiría locks.
  for v_lock in select distinct k from unnest(array[
    pg_catalog.hashtextextended('hugella:finanzas:operacion:'||p_operacion_id::text,0),
    pg_catalog.hashtextextended('hugella:finanzas:operacion:'||v_fin_op::text,0),
    pg_catalog.hashtextextended('hugella:compra:operacion:'||v_compra_op::text,0)]) k order by k loop
    perform pg_catalog.pg_advisory_xact_lock(v_lock);
  end loop;
  v_res:=public.iniciar_operacion_financiera_compras(p_operacion_id,'COMPRA_FINANCIADA',v_req);
  if v_res is not null then return v_res; end if;
  -- Una identidad derivada ocupada sin operación externa nunca se adopta.
  if exists(select 1 from public.operaciones_compras_gastos where operacion_id=v_compra_op)
    or exists(select 1 from public.operaciones_financieras_compras where operacion_id=v_fin_op) then
    raise exception 'Identidad interna ya utilizada; requiere revisión' using errcode='22023';
  end if;
  v_compra:=public.crear_compra_gasto_admin(v_compra_op,p_tipo,p_proveedor_id,p_fecha,
    p_moneda,p_comprobante,p_observaciones,v_items);
  v_fin:=public.confirmar_financiacion_compra_admin(v_fin_op,(v_compra->>'compra_gasto_id')::uuid,v_tramos);
  -- Resultado externo estable: nunca trasladar el flag variable ya_procesada de la RPC de compra.
  v_res:=jsonb_build_object('operacion_id',p_operacion_id,'compra_id',v_compra->'compra_gasto_id',
    'estado',v_fin->'estado','operacion_compra_id',v_compra_op,'operacion_financiacion_id',v_fin_op,
    'tramos',coalesce(nullif(v_fin->'tramos','null'::jsonb),'[]'::jsonb));
  return public.finalizar_operacion_financiera_compras(p_operacion_id,'COMPRA_FINANCIADA',v_req,v_res);
  -- Los constraint triggers instalados siguen diferidos: cualquier error al COMMIT
  -- revierte compra, ítems, financiación y las TRES operaciones, sin excepciones absorbidas.
end;
$rpc$;

create function public.obtener_detalle_financiacion_compra_admin(p_compra_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $rpc$
declare v_res jsonb; v_formas jsonb; v_cuotas jsonb;
begin
  if auth.uid() is null or public.es_admin_hugella() is not true then raise exception 'No autorizado' using errcode='42501'; end if;
  v_res:=public.obtener_financiacion_compra_admin(p_compra_id);
  -- Históricos sin confirmación no se presentan como hechos financieros confirmados.
  if v_res->>'estado_financiacion' is distinct from 'CONFIRMADA' then
    return v_res||jsonb_build_object('formas_pago','[]'::jsonb,'cuotas','[]'::jsonb);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('tramo_id',t.id,'posicion',t.posicion,
    'medio',t.medio,'importe',t.importe,'fecha_pago',t.fecha_pago,'tarjeta_id',t.tarjeta_id,
    'tarjeta_nombre',c.nombre,'entidad',c.entidad,'cantidad_cuotas',t.cantidad_cuotas,
    'primer_periodo_id',i.primer_periodo_id) order by t.posicion),'[]') into v_formas
    from public.tramos_pago_compras t left join public.tarjetas_credito c on c.id=t.tarjeta_id
    left join public.inicios_tramos_tarjeta i on i.tramo_id=t.id where t.compra_id=p_compra_id;
  select coalesce(jsonb_agg(jsonb_build_object('obligacion_id',o.id,'tramo_id',o.tramo_id,
    'numero_cuota',o.numero_cuota,'cantidad_cuotas',o.cantidad_cuotas,'importe',o.importe,
    'periodo_id',o.periodo_id,'fecha_cierre',p.fecha_cierre,'fecha_vencimiento',p.fecha_vencimiento,
    'total_aplicado',a.pagado,'saldo',o.importe-a.pagado,
    'estado',case when a.pagado=0 then 'PENDIENTE' when a.pagado=o.importe then 'PAGADA' else 'PAGO_PARCIAL' end)
    order by t.posicion,o.numero_cuota),'[]') into v_cuotas
    from public.obligaciones_tarjetas o join public.tramos_pago_compras t on t.id=o.tramo_id
    left join public.periodos_tarjetas p on p.id=o.periodo_id
    cross join lateral (select coalesce(sum(ap.importe),0) pagado
      from public.aplicaciones_pagos_obligaciones ap where ap.obligacion_id=o.id) a
    where o.compra_id=p_compra_id;
  return v_res||jsonb_build_object('formas_pago',v_formas,'cuotas',v_cuotas);
end;
$rpc$;

create function public.listar_resumenes_tarjeta_admin(p_tarjeta_id uuid,p_limite integer default 50,p_offset integer default 0)
returns table(periodo_id uuid,orden integer,fecha_cierre date,fecha_vencimiento date,
  total_obligaciones_hugella numeric,total_pagado numeric,saldo numeric,estado text)
language plpgsql stable security definer set search_path='' as $rpc$
begin
  if auth.uid() is null or public.es_admin_hugella() is not true then raise exception 'No autorizado' using errcode='42501'; end if;
  if p_tarjeta_id is null or p_limite is null or p_limite not between 1 and 100 or p_offset is null or p_offset<0 then
    raise exception 'Paginación inválida' using errcode='22023'; end if;
  if not exists(select 1 from public.tarjetas_credito where id=p_tarjeta_id) then
    raise exception 'Tarjeta inexistente' using errcode='22023'; end if;
  -- Página primero; agregados independientes evitan multiplicar obligaciones por pagos.
  return query select p.id,p.orden,p.fecha_cierre,p.fecha_vencimiento,o.total,a.pagado,
    o.total-a.pagado,case when o.total=0 and a.pagado=0 then 'SIN_OBLIGACIONES'
      when o.total=a.pagado then 'PAGADO' when a.pagado=0 then 'PENDIENTE' else 'PAGO_PARCIAL' end
    from (select per.* from public.periodos_tarjetas per where per.tarjeta_id=p_tarjeta_id
      order by per.orden limit p_limite offset p_offset) p
    cross join lateral (select coalesce(sum(ob.importe),0) total from public.obligaciones_tarjetas ob
      join public.financiaciones_compras f on f.compra_id=ob.compra_id where ob.periodo_id=p.id and f.estado='CONFIRMADA') o
    cross join lateral (select coalesce(sum(pa.importe),0) pagado from public.pagos_resumenes_tarjetas pa where pa.periodo_id=p.id) a
    order by p.orden;
end;
$rpc$;

alter function public.crear_compra_financiada_admin(uuid,text,uuid,date,text,text,text,jsonb,jsonb) owner to postgres;
alter function public.obtener_detalle_financiacion_compra_admin(uuid) owner to postgres;
alter function public.listar_resumenes_tarjeta_admin(uuid,integer,integer) owner to postgres;
revoke all on function public.crear_compra_financiada_admin(uuid,text,uuid,date,text,text,text,jsonb,jsonb),
  public.obtener_detalle_financiacion_compra_admin(uuid),public.listar_resumenes_tarjeta_admin(uuid,integer,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.crear_compra_financiada_admin(uuid,text,uuid,date,text,text,text,jsonb,jsonb),
  public.obtener_detalle_financiacion_compra_admin(uuid),public.listar_resumenes_tarjeta_admin(uuid,integer,integer) to authenticated;
commit;
