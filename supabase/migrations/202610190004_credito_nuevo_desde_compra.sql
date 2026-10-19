begin;

create function public.crear_credito_desde_compra_admin(
  p_compra_gasto_id uuid,
  p_operacion_id uuid,
  p_dni text,
  p_cliente_nuevo boolean,
  p_cliente_id_esperado uuid,
  p_nombre text,
  p_telefono text,
  p_domicilio text,
  p_producto text,
  p_fecha_inicio date,
  p_cantidad_cuotas integer,
  p_importe_cuota numeric,
  p_inversion numeric,
  p_ubicacion text
)
returns table(
  operacion_id uuid,
  cliente_id uuid,
  credito_id uuid,
  codigo text,
  access_token uuid,
  cliente_creado boolean,
  ya_procesada boolean,
  compra_gasto_id uuid
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_compra public.compras_gastos%rowtype;
  v_credito record;
  v_asociacion record;
begin
  if auth.uid() is null or public.es_admin_hugella() is not true then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  if p_compra_gasto_id is null then
    raise exception 'La compra es obligatoria'
      using errcode = '22023';
  end if;

  select *
  into v_compra
  from public.compras_gastos
  where id = p_compra_gasto_id
  for update;

  if not found then
    raise exception 'Compra inexistente'
      using errcode = '22023';
  end if;

  if v_compra.tipo <> 'MERCADERIA' then
    raise exception 'Solo una compra de mercadería puede asociarse a un crédito'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.anulaciones_compras_gastos
    where compra_gasto_id = p_compra_gasto_id
  ) then
    raise exception 'La compra está anulada y no puede asociarse a un crédito'
      using errcode = '23514';
  end if;

  select *
  into v_credito
  from public.crear_credito_admin(
    p_operacion_id,
    p_dni,
    p_cliente_nuevo,
    p_cliente_id_esperado,
    p_nombre,
    p_telefono,
    p_domicilio,
    p_producto,
    p_fecha_inicio,
    p_cantidad_cuotas,
    p_importe_cuota,
    p_inversion,
    p_ubicacion
  );

  if v_credito.credito_id is null then
    raise exception 'El crédito creado no devolvió una identidad válida'
      using errcode = '23514';
  end if;

  if v_credito.ya_procesada is true then
    select *
    into v_asociacion
    from public.asociaciones_compras_creditos
    where compra_gasto_id = p_compra_gasto_id;

    if not found
      or v_asociacion.credito_id is distinct from v_credito.credito_id then
      raise exception 'El identificador de operación ya fue utilizado con otra solicitud'
        using errcode = '22023';
    end if;
  else
    select *
    into v_asociacion
    from public.asociar_compra_credito_admin(
      p_compra_gasto_id,
      v_credito.credito_id
    );

    if v_asociacion.compra_gasto_id is distinct from p_compra_gasto_id
      or v_asociacion.credito_id is distinct from v_credito.credito_id then
      raise exception 'La asociación entre compra y crédito no pudo confirmarse'
        using errcode = '23514';
    end if;
  end if;

  return query
  select
    v_credito.operacion_id,
    v_credito.cliente_id,
    v_credito.credito_id,
    v_credito.codigo::text,
    v_credito.access_token,
    v_credito.cliente_creado,
    v_credito.ya_procesada,
    p_compra_gasto_id;
end;
$$;

alter function public.crear_credito_desde_compra_admin(
  uuid,uuid,text,boolean,uuid,text,text,text,text,date,integer,numeric,numeric,text
) owner to postgres;

revoke all on function public.crear_credito_desde_compra_admin(
  uuid,uuid,text,boolean,uuid,text,text,text,text,date,integer,numeric,numeric,text
) from public, anon, authenticated, service_role;

grant execute on function public.crear_credito_desde_compra_admin(
  uuid,uuid,text,boolean,uuid,text,text,text,text,date,integer,numeric,numeric,text
) to authenticated;

commit;
