begin;

drop function if exists public.buscar_compras_gastos_admin(integer,integer);

create function public.buscar_compras_gastos_admin(
  p_limite integer default 50,
  p_offset integer default 0
) returns table(
  id uuid,
  tipo text,
  fecha date,
  proveedor_id uuid,
  proveedor_nombre text,
  moneda text,
  comprobante text,
  observaciones text,
  total numeric,
  cantidad_items bigint,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $rpc$
begin
  if auth.uid() is null or public.es_admin_hugella() is not true then
    raise exception 'No autorizado' using errcode='42501';
  end if;

  if p_limite is null or p_limite not between 1 and 100
     or p_offset is null or p_offset < 0 then
    raise exception 'Paginación inválida' using errcode='22023';
  end if;

  return query
    select
      cg.id,
      cg.tipo,
      cg.fecha,
      cg.proveedor_id,
      pr.nombre,
      cg.moneda,
      cg.comprobante,
      cg.observaciones,
      (select sum(it.total)
         from public.items_compras_gastos it
        where it.compra_gasto_id = cg.id),
      (select count(*)
         from public.items_compras_gastos it
        where it.compra_gasto_id = cg.id),
      cg.created_at
    from public.compras_gastos cg
    join public.proveedores pr on pr.id = cg.proveedor_id
    order by cg.created_at desc, cg.id desc
    limit p_limite
    offset p_offset;
end;
$rpc$;

alter function public.buscar_compras_gastos_admin(integer,integer) owner to postgres;

revoke all on function public.buscar_compras_gastos_admin(integer,integer)
from public, anon, authenticated, service_role;

grant execute on function public.buscar_compras_gastos_admin(integer,integer)
to authenticated;

commit;
