-- 11D.2 LOCAL: revisar antes de instalar. Sin cambios al núcleo existente.
begin;

create table public.operaciones_compras_gastos (
  operacion_id uuid primary key,
  actor_id uuid not null references auth.users(id) on delete restrict,
  compra_gasto_id uuid not null unique references public.compras_gastos(id) on delete restrict,
  solicitud jsonb not null check (jsonb_typeof(solicitud) = 'object'),
  created_at timestamptz not null default clock_timestamp()
);
alter table public.operaciones_compras_gastos owner to postgres;
alter table public.operaciones_compras_gastos enable row level security;
revoke all on table public.operaciones_compras_gastos from public, anon, authenticated, service_role;

create table public.operaciones_altas_proveedores (
  operacion_id uuid primary key,
  actor_id uuid not null references auth.users(id) on delete restrict,
  proveedor_id uuid not null unique references public.proveedores(id) on delete restrict,
  solicitud jsonb not null check (jsonb_typeof(solicitud) = 'object'),
  created_at timestamptz not null default clock_timestamp()
);
alter table public.operaciones_altas_proveedores owner to postgres;
alter table public.operaciones_altas_proveedores enable row level security;
revoke all on table public.operaciones_altas_proveedores from public, anon, authenticated, service_role;

create function public.crear_proveedor_admin(
  p_operacion_id uuid, p_nombre text, p_identificacion_fiscal text default null,
  p_contacto text default null, p_observaciones text default null
) returns jsonb language plpgsql volatile security definer set search_path = '' as $rpc$
declare
  v_actor uuid := auth.uid();
  v_proveedor public.proveedores%rowtype;
  v_operacion public.operaciones_altas_proveedores%rowtype;
  v_solicitud jsonb;
begin
  if v_actor is null or public.es_admin_hugella() is not true then
    raise exception 'No autorizado' using errcode='42501';
  end if;
  if p_operacion_id is null then
    raise exception 'Operación obligatoria' using errcode='22023';
  end if;
  if nullif(btrim(p_nombre), '') is null then
    raise exception 'Nombre obligatorio' using errcode='22023';
  end if;
  v_solicitud := jsonb_build_object('nombre',btrim(p_nombre),
    'identificacion_fiscal',nullif(btrim(p_identificacion_fiscal),''),
    'contacto',nullif(btrim(p_contacto),''),'observaciones',nullif(btrim(p_observaciones),''));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'hugella:proveedor:operacion:' || p_operacion_id::text, 0));
  select op.* into v_operacion from public.operaciones_altas_proveedores op
    where op.operacion_id=p_operacion_id;
  if found then
    if v_operacion.actor_id is distinct from v_actor or v_operacion.solicitud is distinct from v_solicitud then
      raise exception 'Operación utilizada con otro actor o solicitud' using errcode='22023';
    end if;
    select pr.* into v_proveedor from public.proveedores pr where pr.id=v_operacion.proveedor_id;
    if not found or v_proveedor.actor_id is distinct from v_actor then
      raise exception 'Resultado de operación incompatible' using errcode='23514';
    end if;
    return to_jsonb(v_proveedor);
  end if;
  insert into public.proveedores(nombre, identificacion_fiscal, contacto, observaciones, actor_id)
    values(v_solicitud->>'nombre', v_solicitud->>'identificacion_fiscal',
      v_solicitud->>'contacto', v_solicitud->>'observaciones', v_actor)
    returning * into v_proveedor;
  insert into public.operaciones_altas_proveedores(operacion_id,actor_id,proveedor_id,solicitud)
    values(p_operacion_id,v_actor,v_proveedor.id,v_solicitud);
  return to_jsonb(v_proveedor);
end;
$rpc$;

create function public.buscar_proveedores_admin(
  p_busqueda text default null, p_limite integer default 50, p_offset integer default 0
) returns setof public.proveedores language plpgsql stable security definer set search_path = '' as $rpc$
begin
  if auth.uid() is null or public.es_admin_hugella() is not true then
    raise exception 'No autorizado' using errcode='42501';
  end if;
  if p_limite is null or p_limite not between 1 and 100 or p_offset is null or p_offset < 0 then
    raise exception 'Paginación inválida' using errcode='22023';
  end if;
  return query select pr.* from public.proveedores pr where pr.activo
    and (nullif(btrim(p_busqueda), '') is null
      or strpos(lower(pr.nombre), lower(btrim(p_busqueda))) > 0
      or strpos(lower(coalesce(pr.identificacion_fiscal, '')), lower(btrim(p_busqueda))) > 0)
    order by pr.nombre, pr.id limit p_limite offset p_offset;
end;
$rpc$;

create function public.crear_compra_gasto_admin(
  p_operacion_id uuid, p_tipo text, p_proveedor_id uuid, p_fecha date,
  p_moneda text, p_comprobante text, p_observaciones text, p_items jsonb
) returns jsonb language plpgsql volatile security definer set search_path = '' as $rpc$
declare
  v_actor uuid := auth.uid();
  v_items jsonb := '[]'::jsonb; v_item jsonb; v_request jsonb;
  v_posicion integer; v_cantidad numeric; v_costo numeric; v_descripcion text;
  v_operacion public.operaciones_compras_gastos%rowtype;
  v_compra public.compras_gastos%rowtype;
  v_activo boolean;
begin
  if v_actor is null or public.es_admin_hugella() is not true then
    raise exception 'No autorizado' using errcode='42501';
  end if;
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
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'hugella:compra:operacion:' || p_operacion_id::text, 0));
  select op.* into v_operacion from public.operaciones_compras_gastos op where op.operacion_id=p_operacion_id;
  if found then
    if v_operacion.actor_id is distinct from v_actor or v_operacion.solicitud is distinct from v_request then
      raise exception 'Operación utilizada con otro actor o solicitud' using errcode='22023';
    end if;
    select cg.* into v_compra from public.compras_gastos cg where cg.id=v_operacion.compra_gasto_id;
    if not found or v_compra.actor_id is distinct from v_actor then
      raise exception 'Resultado de operación incompatible' using errcode='23514';
    end if;
    return jsonb_build_object('operacion_id',p_operacion_id,'compra_gasto_id',v_compra.id,'ya_procesada',true);
  end if;
  -- SHARE evita desactivación concurrente durante el alta; permite altas paralelas.
  select pr.activo into v_activo from public.proveedores pr where pr.id=p_proveedor_id for share;
  if not found or v_activo is not true then
    raise exception 'Proveedor inexistente o inactivo' using errcode='22023';
  end if;
  insert into public.compras_gastos(tipo,proveedor_id,fecha,moneda,comprobante,observaciones,actor_id)
    values(p_tipo,p_proveedor_id,p_fecha,p_moneda,nullif(btrim(p_comprobante),''),nullif(btrim(p_observaciones),''),v_actor)
    returning * into v_compra;
  insert into public.items_compras_gastos(compra_gasto_id,posicion,descripcion,cantidad,costo_unitario)
    select v_compra.id,(x->>'posicion')::integer,x->>'descripcion',
      (x->>'cantidad')::numeric,(x->>'costo_unitario')::numeric from jsonb_array_elements(v_items) x;
  insert into public.operaciones_compras_gastos(operacion_id,actor_id,compra_gasto_id,solicitud)
    values(p_operacion_id,v_actor,v_compra.id,v_request);
  return jsonb_build_object('operacion_id',p_operacion_id,'compra_gasto_id',v_compra.id,'ya_procesada',false);
end;
$rpc$;

create function public.buscar_compras_gastos_admin(
  p_limite integer default 50, p_offset integer default 0
) returns table(id uuid,tipo text,fecha date,proveedor_id uuid,proveedor_nombre text,
  moneda text,comprobante text,total numeric,cantidad_items bigint,created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $rpc$
begin
  if auth.uid() is null or public.es_admin_hugella() is not true then
    raise exception 'No autorizado' using errcode='42501';
  end if;
  if p_limite is null or p_limite not between 1 and 100 or p_offset is null or p_offset < 0 then
    raise exception 'Paginación inválida' using errcode='22023';
  end if;
  return query select cg.id,cg.tipo,cg.fecha,cg.proveedor_id,pr.nombre,cg.moneda,cg.comprobante,
    (select sum(it.total) from public.items_compras_gastos it where it.compra_gasto_id=cg.id),
    (select count(*) from public.items_compras_gastos it where it.compra_gasto_id=cg.id),cg.created_at
    from public.compras_gastos cg join public.proveedores pr on pr.id=cg.proveedor_id
    order by cg.created_at desc,cg.id desc limit p_limite offset p_offset;
end;
$rpc$;

create function public.obtener_compra_gasto_admin(p_compra_gasto_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $rpc$
declare v_resultado jsonb;
begin
  if auth.uid() is null or public.es_admin_hugella() is not true then
    raise exception 'No autorizado' using errcode='42501';
  end if;
  if p_compra_gasto_id is null then
    raise exception 'ID obligatorio' using errcode='22023';
  end if;
  select to_jsonb(cg) || jsonb_build_object('proveedor',to_jsonb(pr),
    'items',(select jsonb_agg(to_jsonb(it) order by it.posicion) from public.items_compras_gastos it where it.compra_gasto_id=cg.id),
    'total',(select sum(it.total) from public.items_compras_gastos it where it.compra_gasto_id=cg.id))
    into v_resultado from public.compras_gastos cg join public.proveedores pr on pr.id=cg.proveedor_id
    where cg.id=p_compra_gasto_id;
  if not found then raise exception 'Compra/gasto inexistente' using errcode='22023'; end if;
  return v_resultado;
end;
$rpc$;

alter function public.crear_proveedor_admin(uuid,text,text,text,text) owner to postgres;
revoke all on function public.crear_proveedor_admin(uuid,text,text,text,text) from public, anon, authenticated, service_role;
grant execute on function public.crear_proveedor_admin(uuid,text,text,text,text) to authenticated;

alter function public.buscar_proveedores_admin(text,integer,integer) owner to postgres;
revoke all on function public.buscar_proveedores_admin(text,integer,integer) from public, anon, authenticated, service_role;
grant execute on function public.buscar_proveedores_admin(text,integer,integer) to authenticated;

alter function public.crear_compra_gasto_admin(uuid,text,uuid,date,text,text,text,jsonb) owner to postgres;
revoke all on function public.crear_compra_gasto_admin(uuid,text,uuid,date,text,text,text,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.crear_compra_gasto_admin(uuid,text,uuid,date,text,text,text,jsonb) to authenticated;

alter function public.buscar_compras_gastos_admin(integer,integer) owner to postgres;
revoke all on function public.buscar_compras_gastos_admin(integer,integer) from public, anon, authenticated, service_role;
grant execute on function public.buscar_compras_gastos_admin(integer,integer) to authenticated;

alter function public.obtener_compra_gasto_admin(uuid) owner to postgres;
revoke all on function public.obtener_compra_gasto_admin(uuid) from public, anon, authenticated, service_role;
grant execute on function public.obtener_compra_gasto_admin(uuid) to authenticated;

commit;
