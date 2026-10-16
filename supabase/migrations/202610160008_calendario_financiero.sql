begin;

create or replace function public.listar_calendario_financiero_admin()
returns table(
  obligacion_id uuid,
  compra_id uuid,
  referencia_compra text,
  fecha_compra date,
  producto text,
  tarjeta text,
  numero_cuota integer,
  cantidad_cuotas integer,
  importe numeric,
  importe_cortado_historico numeric,
  importe_pagado_real numeric,
  saldo_pendiente numeric,
  periodo_orden integer,
  fecha_cierre date,
  fecha_vencimiento date,
  estado text,
  compra_anulada boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or public.es_admin_hugella() is not true then
    raise exception 'No autorizado'
      using errcode = '42501';
  end if;

  return query
  with productos as (
    select
      i.compra_gasto_id,
      string_agg(i.descripcion, ' · ' order by i.posicion) as producto
    from public.items_compras_gastos i
    group by i.compra_gasto_id
  )
  select
    v.id as obligacion_id,
    v.compra_id,
    cg.id_origen as referencia_compra,
    cg.fecha as fecha_compra,
    coalesce(p.producto, 'Sin descripción') as producto,
    v.tarjeta,
    v.numero_cuota,
    v.cantidad_cuotas,
    v.importe,
    v.importe_cortado_historico,
    v.importe_pagado_real,
    case
      when a.compra_gasto_id is not null then 0::numeric
      else v.saldo_pendiente
    end as saldo_pendiente,
    v.periodo_orden,
    v.fecha_cierre,
    v.fecha_vencimiento,
    case
      when a.compra_gasto_id is not null then 'ANULADA'
      when v.saldo_pendiente <= 0 then 'PAGADA'
      when v.periodo_id is null then 'SIN_PERIODO'
      else 'PENDIENTE'
    end as estado,
    (a.compra_gasto_id is not null) as compra_anulada
  from public.vw_obligaciones_tarjetas_financieras v
  join public.compras_gastos cg
    on cg.id = v.compra_id
  left join productos p
    on p.compra_gasto_id = cg.id
  left join public.anulaciones_compras_gastos a
    on a.compra_gasto_id = cg.id
  order by
    v.fecha_vencimiento nulls last,
    cg.fecha,
    v.tarjeta,
    v.numero_cuota,
    v.id;
end;
$$;

revoke all
on function public.listar_calendario_financiero_admin()
from public, anon;

grant execute
on function public.listar_calendario_financiero_admin()
to authenticated, service_role;

commit;
