begin;

create table public.asociaciones_compras_creditos (
  compra_gasto_id uuid primary key
    references public.compras_gastos(id) on delete restrict,
  credito_id uuid not null
    references public.creditos(id) on delete restrict,
  actor_id uuid not null
    references auth.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp()
);

create index asociaciones_compras_creditos_credito_idx
  on public.asociaciones_compras_creditos(credito_id);

alter table public.asociaciones_compras_creditos owner to postgres;
alter table public.asociaciones_compras_creditos enable row level security;

revoke all on table public.asociaciones_compras_creditos
  from public, anon, authenticated, service_role;

create function public.proteger_asociacion_compra_credito()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'La asociación entre compra y crédito es inmutable'
    using errcode = '23514';
end;
$$;

create trigger asociacion_compra_credito_inmutable
before update or delete
on public.asociaciones_compras_creditos
for each row
execute function public.proteger_asociacion_compra_credito();

alter function public.proteger_asociacion_compra_credito()
  owner to postgres;

revoke all on function public.proteger_asociacion_compra_credito()
  from public, anon, authenticated, service_role;

create function public.asociar_compra_credito_admin(
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

  perform 1
  from public.creditos
  where id = p_credito_id
  for update;

  if not found then
    raise exception 'Crédito inexistente'
      using errcode = '22023';
  end if;

  select *
  into v_existente
  from public.asociaciones_compras_creditos
  where compra_gasto_id = p_compra_gasto_id;

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
