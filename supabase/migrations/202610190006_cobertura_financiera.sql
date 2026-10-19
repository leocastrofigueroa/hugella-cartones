begin;

create or replace function public.obtener_cobertura_financiera_admin()
returns table(
  numero_ciclo integer,
  fecha_inicio date,
  fecha_vencimiento date,
  obligaciones_tarjetas bigint,
  tarjetas_objetivo numeric,
  saldo_inicial numeric,
  cobrado_ciclo numeric,
  honorarios_retiros numeric,
  disponible_para_tarjetas numeric,
  faltante numeric,
  superavit numeric,
  saldo_final numeric,
  porcentaje_cobertura numeric,
  estado text,
  es_ciclo_actual boolean
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
  with recursive

  vencimientos as (
    select
      p.fecha_vencimiento,
      count(o.id)::bigint as obligaciones_tarjetas,
      round(sum(o.importe), 2) as tarjetas_objetivo
    from public.obligaciones_tarjetas o
    join public.periodos_tarjetas p
      on p.id = o.periodo_id
    where not exists (
      select 1
      from public.anulaciones_compras_gastos a
      where a.compra_gasto_id = o.compra_id
    )
    group by p.fecha_vencimiento
  ),

  limites as (
    select
      row_number() over (
        order by v.fecha_vencimiento
      )::integer as numero_ciclo,

      coalesce(
        lag(v.fecha_vencimiento) over (
          order by v.fecha_vencimiento
        ) + 1,

        (
          select min(pg.fecha_pago)
          from public.pagos pg
          join public.creditos cr
            on cr.id = pg.credito_id
          where pg.estado = 'VALIDO'
            and cr.codigo <> 'CR-0048'
        )
      ) as fecha_inicio,

      v.fecha_vencimiento,
      v.obligaciones_tarjetas,
      v.tarjetas_objetivo
    from vencimientos v
  ),

  movimientos as (
    select
      l.numero_ciclo,
      l.fecha_inicio,
      l.fecha_vencimiento,
      l.obligaciones_tarjetas,
      l.tarjetas_objetivo,

      coalesce(
        (
          select round(sum(pg.importe), 2)
          from public.pagos pg
          join public.creditos cr
            on cr.id = pg.credito_id
          where pg.estado = 'VALIDO'
            and cr.codigo <> 'CR-0048'
            and pg.fecha_pago >= l.fecha_inicio
            and pg.fecha_pago <= l.fecha_vencimiento
        ),
        0
      )::numeric as cobrado_ciclo,

      coalesce(
        (
          select round(sum(hr.importe), 2)
          from public.honorarios_retiros hr
          where hr.fecha >= l.fecha_inicio
            and hr.fecha <= l.fecha_vencimiento
            and not exists (
              select 1
              from public.anulaciones_honorarios_retiros ahr
              where ahr.honorario_retiro_id = hr.id
            )
        ),
        0
      )::numeric as honorarios_retiros

    from limites l
    where l.fecha_inicio is not null
      and l.fecha_inicio <= l.fecha_vencimiento
  ),

  cobertura as (
    select
      m.numero_ciclo,
      m.fecha_inicio,
      m.fecha_vencimiento,
      m.obligaciones_tarjetas,
      m.tarjetas_objetivo,

      0::numeric as saldo_inicial,

      m.cobrado_ciclo,
      m.honorarios_retiros,

      round(
        m.cobrado_ciclo
        - m.honorarios_retiros,
        2
      )::numeric as disponible_para_tarjetas,

      round(
        m.cobrado_ciclo
        - m.honorarios_retiros
        - m.tarjetas_objetivo,
        2
      )::numeric as saldo_final

    from movimientos m
    where m.numero_ciclo = 1

    union all

    select
      m.numero_ciclo,
      m.fecha_inicio,
      m.fecha_vencimiento,
      m.obligaciones_tarjetas,
      m.tarjetas_objetivo,

      c.saldo_final as saldo_inicial,

      m.cobrado_ciclo,
      m.honorarios_retiros,

      round(
        c.saldo_final
        + m.cobrado_ciclo
        - m.honorarios_retiros,
        2
      )::numeric as disponible_para_tarjetas,

      round(
        c.saldo_final
        + m.cobrado_ciclo
        - m.honorarios_retiros
        - m.tarjetas_objetivo,
        2
      )::numeric as saldo_final

    from cobertura c
    join movimientos m
      on m.numero_ciclo = c.numero_ciclo + 1
  )

  select
    c.numero_ciclo,
    c.fecha_inicio,
    c.fecha_vencimiento,
    c.obligaciones_tarjetas,
    c.tarjetas_objetivo,
    c.saldo_inicial,
    c.cobrado_ciclo,
    c.honorarios_retiros,
    c.disponible_para_tarjetas,

    greatest(
      c.tarjetas_objetivo - c.disponible_para_tarjetas,
      0
    )::numeric as faltante,

    greatest(
      c.disponible_para_tarjetas - c.tarjetas_objetivo,
      0
    )::numeric as superavit,

    c.saldo_final,

    case
      when c.tarjetas_objetivo <= 0 then 100::numeric
      else round(
        greatest(
          least(
            c.disponible_para_tarjetas
              / c.tarjetas_objetivo * 100,
            100
          ),
          0
        ),
        2
      )
    end as porcentaje_cobertura,

    case
      when c.disponible_para_tarjetas < c.tarjetas_objetivo
        then 'FALTA'

      when c.disponible_para_tarjetas = c.tarjetas_objetivo
        then 'ALCANZADO'

      else 'SUPERAVIT'
    end::text as estado,

    (
      public.hugella_fecha_comercial()
        >= c.fecha_inicio
      and
      public.hugella_fecha_comercial()
        <= c.fecha_vencimiento
    ) as es_ciclo_actual

  from cobertura c
  order by c.numero_ciclo;
end;
$$;

alter function public.obtener_cobertura_financiera_admin()
owner to postgres;

revoke all
on function public.obtener_cobertura_financiera_admin()
from public, anon, authenticated, service_role;

grant execute
on function public.obtener_cobertura_financiera_admin()
to authenticated, service_role;

commit;
