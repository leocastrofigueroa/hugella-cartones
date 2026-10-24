begin;

create or replace function public.listar_creditos_admin()
returns table(
  credito_id uuid,
  codigo text,
  cliente_id uuid,
  cliente text,
  producto text,
  fecha_inicio date,
  importe_cuota numeric,
  cantidad_cuotas integer,
  cuotas_pagadas integer,
  cuotas_deberia_llevar integer,
  cuotas_atrasadas integer,
  importe_atrasado numeric,
  estado text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null
     or public.es_admin_hugella() is not true then
    raise exception 'No autorizado'
      using errcode = '42501';
  end if;

  return query
  select
    cr.id as credito_id,
    cr.codigo::text,
    cr.cliente_id,
    cl.nombre::text as cliente,
    cr.producto::text,
    cr.fecha_inicio,
    cr.importe_cuota,
    cr.cantidad_cuotas,

    pag.cuotas::integer as cuotas_pagadas,

    exig.cuotas::integer as cuotas_deberia_llevar,

    greatest(
      exig.cuotas - pag.cuotas,
      0
    )::integer as cuotas_atrasadas,

    greatest(
      0::numeric,
      exig.cuotas * cr.importe_cuota - pag.total
    ) as importe_atrasado,

    coalesce(
      cierre.tipo,
      public.hugella_estado_credito(
        cr.cantidad_cuotas,
        pag.cuotas,
        exig.cuotas
      )
    )::text as estado

  from public.creditos cr

  join public.clientes cl
    on cl.id = cr.cliente_id

  left join public.cierres_creditos cierre
    on cierre.credito_id = cr.id

  cross join lateral (
    select
      coalesce(sum(pg.importe), 0::numeric) as total,

      least(
        cr.cantidad_cuotas::bigint,
        coalesce(
          sum(
            greatest(
              coalesce(pg.cuotas_aplicadas, 0),
              0
            )
          ),
          0
        )::bigint
      ) as cuotas

    from public.pagos pg

    where pg.credito_id = cr.id
      and pg.estado = 'VALIDO'
  ) pag

  cross join lateral (
    select public.hugella_cuotas_exigibles(
      cr.fecha_inicio,
      cr.cantidad_cuotas,
      coalesce(
        cierre.fecha,
        public.hugella_fecha_comercial()
      )
    )::integer as cuotas
  ) exig

  order by
    cr.fecha_inicio asc,
    cr.codigo asc;
end;
$$;

alter function public.listar_creditos_admin()
  owner to postgres;

revoke all
on function public.listar_creditos_admin()
from public, anon, authenticated, service_role;

grant execute
on function public.listar_creditos_admin()
to authenticated;

commit;
