begin;

-- Evita que se inserte un pago mientras numeramos el historial existente.
lock table public.pagos in access exclusive mode;

alter table public.pagos
  add column numero_registro bigint;

create sequence public.pagos_numero_registro_seq
  as bigint
  start with 1
  increment by 1
  no cycle;

with numerados as (
  select
    id,
    row_number() over (
      order by fecha_pago asc, created_at asc, id asc
    )::bigint as numero_registro
  from public.pagos
)
update public.pagos pg
set numero_registro = n.numero_registro
from numerados n
where n.id = pg.id;

select setval(
  'public.pagos_numero_registro_seq',
  coalesce((select max(numero_registro) from public.pagos), 0) + 1,
  false
);

alter sequence public.pagos_numero_registro_seq
  owned by public.pagos.numero_registro;

alter table public.pagos
  alter column numero_registro
    set default nextval('public.pagos_numero_registro_seq'),
  alter column numero_registro
    set not null;

alter table public.pagos
  add constraint pagos_numero_registro_unique
    unique (numero_registro);

drop function public.listar_cobros_admin();

create function public.listar_cobros_admin()
returns table(
  numero_registro bigint,
  pago_id uuid,
  fecha_pago date,
  cliente text,
  codigo_credito text,
  producto text,
  importe numeric,
  medio_pago text,
  estado text,
  origen text,
  observaciones text,
  motivo_anulacion text,
  created_at timestamptz
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
    select
      pg.numero_registro,
      pg.id,
      pg.fecha_pago,
      cl.nombre,
      cr.codigo,
      cr.producto,
      pg.importe,
      pg.medio_pago,
      pg.estado,
      pg.origen,
      pg.observaciones,
      pg.motivo_anulacion,
      pg.created_at
    from public.pagos pg
    join public.creditos cr
      on cr.id = pg.credito_id
    join public.clientes cl
      on cl.id = cr.cliente_id
    order by
      pg.numero_registro desc;
end;
$$;

revoke all
on function public.listar_cobros_admin()
from public, anon;

grant execute
on function public.listar_cobros_admin()
to authenticated, service_role;

commit;
