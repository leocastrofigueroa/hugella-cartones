begin;

create function public.crear_compra_financiada_credito_admin(
  p_operacion_id uuid,
  p_tipo text,
  p_proveedor_id uuid,
  p_fecha date,
  p_moneda text,
  p_comprobante text,
  p_observaciones text,
  p_items jsonb,
  p_tramos jsonb,
  p_credito_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_compra jsonb;
  v_compra_id uuid;
  v_asociacion record;
begin
  if auth.uid() is null or public.es_admin_hugella() is not true then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  if p_credito_id is null then
    raise exception 'El crédito es obligatorio'
      using errcode = '22023';
  end if;

  if p_tipo is distinct from 'MERCADERIA' then
    raise exception 'Solo una compra de mercadería puede asociarse a un crédito'
      using errcode = '22023';
  end if;

  v_compra := public.crear_compra_financiada_admin(
    p_operacion_id,
    p_tipo,
    p_proveedor_id,
    p_fecha,
    p_moneda,
    p_comprobante,
    p_observaciones,
    p_items,
    p_tramos
  );

  v_compra_id := (v_compra->>'compra_id')::uuid;

  if v_compra_id is null then
    raise exception 'La compra creada no devolvió una identidad válida'
      using errcode = '23514';
  end if;

  select *
  into v_asociacion
  from public.asociar_compra_credito_admin(
    v_compra_id,
    p_credito_id
  );

  if v_asociacion.compra_gasto_id is distinct from v_compra_id
    or v_asociacion.credito_id is distinct from p_credito_id then
    raise exception 'La asociación entre compra y crédito no pudo confirmarse'
      using errcode = '23514';
  end if;

  return v_compra || jsonb_build_object(
    'credito_id', p_credito_id
  );
end;
$$;

alter function public.crear_compra_financiada_credito_admin(
  uuid,text,uuid,date,text,text,text,jsonb,jsonb,uuid
) owner to postgres;

revoke all on function public.crear_compra_financiada_credito_admin(
  uuid,text,uuid,date,text,text,text,jsonb,jsonb,uuid
) from public, anon, authenticated, service_role;

grant execute on function public.crear_compra_financiada_credito_admin(
  uuid,text,uuid,date,text,text,text,jsonb,jsonb,uuid
) to authenticated;

commit;
