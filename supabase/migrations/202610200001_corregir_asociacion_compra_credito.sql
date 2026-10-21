begin;

create or replace function public.asociar_compra_credito_admin(
  p_compra_gasto_id uuid,
  p_credito_id uuid
)
returns table(
  compra_gasto_id uuid,
  credito_id uuid,
  ya_asociada boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_compra public.compras_gastos%rowtype;
  v_existente public.asociaciones_compras_creditos%rowtype;
begin
  if v_actor is null or public.es_admin_hugella() is not true then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  if p_compra_gasto_id is null or p_credito_id is null then
    raise exception 'Compra y crédito son obligatorios'
      using errcode = '22023';
  end if;

  select cg.*
  into v_compra
  from public.compras_gastos as cg
  where cg.id = p_compra_gasto_id
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
    from public.anulaciones_compras_gastos as ac
    where ac.compra_gasto_id = p_compra_gasto_id
  ) then
    raise exception 'La compra está anulada y no puede asociarse a un crédito'
      using errcode = '23514';
  end if;

  perform 1
  from public.creditos as c
  where c.id = p_credito_id
  for update;

  if not found then
    raise exception 'Crédito inexistente'
      using errcode = '22023';
  end if;

  select acc.*
  into v_existente
  from public.asociaciones_compras_creditos as acc
  where acc.compra_gasto_id = p_compra_gasto_id;

  if found then
    if v_existente.credito_id is distinct from p_credito_id then
      raise exception 'La compra ya está asociada a otro crédito'
        using errcode = '23514';
    end if;

    return query
    select p_compra_gasto_id, p_credito_id, true;

    return;
  end if;

  insert into public.asociaciones_compras_creditos(
    compra_gasto_id,
    credito_id,
    actor_id
  )
  values(
    p_compra_gasto_id,
    p_credito_id,
    v_actor
  );

  return query
  select p_compra_gasto_id, p_credito_id, false;
end;
$$;

alter function public.asociar_compra_credito_admin(uuid, uuid)
  owner to postgres;

revoke all on function public.asociar_compra_credito_admin(uuid, uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.asociar_compra_credito_admin(uuid, uuid)
  to authenticated;

commit;
