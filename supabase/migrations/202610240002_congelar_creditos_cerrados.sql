begin;

-- ============================================================
-- HUGELLA
-- Congelar cálculos temporales de créditos DEVUELTOS/RETIRADOS
-- en su fecha de cierre.
--
-- No modifica:
--   - creditos
--   - pagos
--   - cierres_creditos
--   - contratos
--
-- Solo corrige funciones/vistas de lectura.
-- ============================================================


-- ------------------------------------------------------------
-- 1. FICHA COMPLETA DEL CRÉDITO
--
-- Crédito abierto:
--   fecha_evaluacion = fecha comercial actual.
--
-- Crédito cerrado:
--   fecha_evaluacion = fecha de cierre.
--   cuotas exigibles/atrasadas/importe atrasado quedan congelados.
-- ------------------------------------------------------------

create or replace function public.obtener_ficha_credito_admin(
  p_credito_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ficha jsonb;
begin
  if auth.uid() is null
     or public.es_admin_hugella() is not true then
    raise exception 'No autorizado'
      using errcode = '42501';
  end if;

  select jsonb_build_object(
    'credito_id', cr.id,
    'cliente_id', cl.id,
    'nombre', cl.nombre,
    'dni', cl.dni,
    'telefono', cl.telefono,
    'domicilio', cl.domicilio,
    'ubicacion', cl.ubicacion,

    'codigo', cr.codigo,
    'producto', cr.producto,
    'origen', cr.origen,
    'fecha_inicio', cr.fecha_inicio,

    'importe_cuota', cr.importe_cuota,
    'cantidad_cuotas', cr.cantidad_cuotas,
    'total_contractual',
      cr.importe_cuota * cr.cantidad_cuotas,

    'fecha_fin_prevista',
      public.hugella_fecha_fin_prevista(
        cr.fecha_inicio,
        cr.cantidad_cuotas
      ),

    'inversion', cr.inversion,
    'ganancia_prevista',
      cr.importe_cuota * cr.cantidad_cuotas - cr.inversion,

    'cuota_recuperacion_inversion',
      ceil(cr.inversion / cr.importe_cuota),

    'total_pagado_valido', paid.total,
    'cuotas_completas_pagadas', paid.cuotas,

    'remanente_actual',
      paid.total - paid.cuotas * cr.importe_cuota,

    'cuotas_equivalentes_monetarias',
      paid.total / cr.importe_cuota,

    'cuotas_plan_no_pagadas',
      cr.cantidad_cuotas - paid.cuotas,

    'saldo_por_cuotas_completas',
      cr.importe_cuota * (cr.cantidad_cuotas - paid.cuotas),

    'saldo_monetario_real',
      greatest(
        0,
        cr.importe_cuota * cr.cantidad_cuotas - paid.total
      ),

    'fecha_evaluacion',
      evaluacion.fecha,

    'cuotas_exigibles',
      due.cuotas,

    'diferencia_cuotas',
      paid.cuotas - due.cuotas,

    'cuotas_atrasadas',
      greatest(0, due.cuotas - paid.cuotas),

    'importe_atrasado',
      greatest(
        0,
        due.cuotas * cr.importe_cuota - paid.total
      ),

    'estado',
      coalesce(
        cierre.tipo,
        public.hugella_estado_credito(
          cr.cantidad_cuotas,
          paid.cuotas,
          due.cuotas
        )
      ),

    'cobranza_futura_habilitada',
      cierre.credito_id is null,

    'calculos_solo_historicos',
      cierre.credito_id is not null,

    'tipo_cierre',
      cierre.tipo,

    'fecha_cierre',
      cierre.fecha
  )
  into v_ficha

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
  ) paid

  cross join lateral (
    select coalesce(
      cierre.fecha,
      public.hugella_fecha_comercial()
    )::date as fecha
  ) evaluacion

  cross join lateral (
    select public.hugella_cuotas_exigibles(
      cr.fecha_inicio,
      cr.cantidad_cuotas,
      evaluacion.fecha
    ) as cuotas
  ) due

  where cr.id = p_credito_id;

  return v_ficha;
end;
$$;

alter function public.obtener_ficha_credito_admin(uuid)
  owner to postgres;

revoke all
on function public.obtener_ficha_credito_admin(uuid)
from public, anon, authenticated, service_role;

grant execute
on function public.obtener_ficha_credito_admin(uuid)
to authenticated;


-- ------------------------------------------------------------
-- 2. LISTADO GENERAL DE CRÉDITOS
--
-- Usa fecha de cierre como fecha de evaluación cuando corresponde.
-- ------------------------------------------------------------

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
    )::bigint as cuotas
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


-- ------------------------------------------------------------
-- 3. VISTA FINANCIERA
--
-- Conservamos exactamente las columnas públicas actuales.
-- Internamente contemplamos tanto DEVUELTO como RETIRADO.
-- ------------------------------------------------------------

create or replace view public.vw_creditos_financieros as

with pagos_validos as (
  select
    pagos.credito_id,
    coalesce(
      sum(pagos.importe),
      0::numeric
    ) as total_pagado

  from public.pagos

  where pagos.estado = 'VALIDO'::text

  group by pagos.credito_id
),

cierres as (
  select
    cc.credito_id,
    cc.tipo as tipo_cierre,
    cc.fecha as fecha_cierre,

    (cc.tipo = 'DEVUELTO'::text) as devuelto,

    case
      when cc.tipo = 'DEVUELTO'::text
        then cc.fecha
      else null::date
    end as fecha_devolucion

  from public.cierres_creditos cc
),

base as (
  select
    cr.id,
    cr.codigo,
    cr.cliente_id,
    cl.nombre as cliente,
    cr.producto,
    cr.fecha_inicio,
    cr.cantidad_cuotas,
    cr.importe_cuota,
    cr.inversion,

    cr.cantidad_cuotas::numeric
      * cr.importe_cuota as total_credito,

    coalesce(
      pv.total_pagado,
      0::numeric
    ) as total_pagado,

    c.tipo_cierre,
    c.fecha_cierre,

    coalesce(
      c.devuelto,
      false
    ) as devuelto,

    c.fecha_devolucion

  from public.creditos cr

  join public.clientes cl
    on cl.id = cr.cliente_id

  left join pagos_validos pv
    on pv.credito_id = cr.id

  left join cierres c
    on c.credito_id = cr.id
),

calculo as (
  select
    b.id,
    b.codigo,
    b.cliente_id,
    b.cliente,
    b.producto,
    b.fecha_inicio,
    b.cantidad_cuotas,
    b.importe_cuota,
    b.inversion,
    b.total_credito,
    b.total_pagado,
    b.tipo_cierre,
    b.fecha_cierre,
    b.devuelto,
    b.fecha_devolucion,

    least(
      b.cantidad_cuotas,
      floor(
        b.total_pagado / b.importe_cuota
      )::integer
    ) as cuotas_cubiertas,

    round(
      b.total_pagado
      - floor(
          b.total_pagado / b.importe_cuota
        ) * b.importe_cuota,
      2
    ) as saldo_parcial,

    public.hugella_cuotas_exigibles(
      b.fecha_inicio,
      b.cantidad_cuotas,
      coalesce(
        b.fecha_cierre,
        public.hugella_fecha_comercial()
      )
    ) as cuotas_que_deberia_llevar

  from base b
)

select
  id,
  codigo,
  cliente_id,
  cliente,
  producto,
  fecha_inicio,
  cantidad_cuotas,
  importe_cuota,
  inversion,
  total_credito,
  total_pagado,

  greatest(
    total_credito - total_pagado,
    0::numeric
  ) as saldo_pendiente,

  cuotas_cubiertas,
  saldo_parcial,
  cuotas_que_deberia_llevar,

  greatest(
    cuotas_que_deberia_llevar::numeric
      * importe_cuota
      - total_pagado,
    0::numeric
  ) as importe_atrasado,

  coalesce(
    tipo_cierre,
    case
      when total_pagado
           > cuotas_que_deberia_llevar::numeric * importe_cuota
        then 'ADELANTADO'::text

      when total_pagado
           = cuotas_que_deberia_llevar::numeric * importe_cuota
        then 'AL DIA'::text

      else 'ATRASADO'::text
    end
  ) as estado_financiero,

  devuelto,
  fecha_devolucion,

  case
    when inversion is not null
      then total_credito - inversion
    else null::numeric
  end as ganancia_bruta_proyectada

from calculo;


-- ------------------------------------------------------------
-- 4. PROYECCIÓN DE COBRANZA FUTURA
--
-- Todo crédito con cierre queda completamente fuera:
-- DEVUELTO y RETIRADO.
-- ------------------------------------------------------------

create or replace view public.vw_proyeccion_cobranza_diaria as

with pagos_validos as (
  select
    pagos.credito_id,
    coalesce(
      sum(pagos.importe),
      0::numeric
    ) as total_pagado

  from public.pagos

  where pagos.estado = 'VALIDO'::text

  group by pagos.credito_id
),

base as (
  select
    cr.id,
    cr.codigo,
    cr.fecha_inicio,
    cr.cantidad_cuotas,
    cr.importe_cuota,

    coalesce(
      pv.total_pagado,
      0::numeric
    ) as total_pagado

  from public.creditos cr

  left join pagos_validos pv
    on pv.credito_id = cr.id

  where not exists (
    select 1
    from public.cierres_creditos cc
    where cc.credito_id = cr.id
  )
),

calendario as (
  select
    b.id,
    b.codigo,
    b.fecha_inicio,
    b.cantidad_cuotas,
    b.importe_cuota,
    b.total_pagado,

    d.fecha::date as fecha_cuota,

    row_number() over (
      partition by b.id
      order by d.fecha
    )::integer as numero_cuota

  from base b

  cross join lateral generate_series(
    b.fecha_inicio::timestamp without time zone,

    b.fecha_inicio
      + (b.cantidad_cuotas * 2)::double precision
        * '1 day'::interval,

    '1 day'::interval
  ) d(fecha)

  where extract(isodow from d.fecha) <> 7::numeric
),

cuotas as (
  select
    calendario.id,
    calendario.codigo,
    calendario.fecha_cuota,
    calendario.numero_cuota,

    greatest(
      least(
        calendario.importe_cuota,

        calendario.numero_cuota::numeric
          * calendario.importe_cuota
          - calendario.total_pagado
      ),
      0::numeric
    ) as importe_pendiente

  from calendario

  where calendario.numero_cuota
        <= calendario.cantidad_cuotas
)

select
  fecha_cuota as fecha,

  count(*) filter (
    where importe_pendiente > 0::numeric
  )::integer as cuotas_con_saldo,

  count(distinct id) filter (
    where importe_pendiente > 0::numeric
  )::integer as creditos_con_cobranza,

  round(
    sum(importe_pendiente) filter (
      where importe_pendiente > 0::numeric
    ),
    2
  ) as cobranza_programada

from cuotas

where fecha_cuota >
  public.hugella_fecha_comercial()

group by fecha_cuota

order by fecha_cuota;


-- ------------------------------------------------------------
-- Validaciones estructurales.
-- Si alguna no se cumple, toda la migración hace rollback.
-- ------------------------------------------------------------

do $$
begin
  if to_regprocedure(
    'public.hugella_cuotas_exigibles(date,integer,date)'
  ) is null then
    raise exception
      'Falta hugella_cuotas_exigibles(date,integer,date)';
  end if;

  if exists (
    select 1
    from public.cierres_creditos cc

    join public.creditos cr
      on cr.id = cc.credito_id

    where public.hugella_cuotas_exigibles(
      cr.fecha_inicio,
      cr.cantidad_cuotas,
      cc.fecha
    )
    is distinct from
    least(
      cr.cantidad_cuotas,
      (
        select count(*)::integer
        from generate_series(
          cr.fecha_inicio,
          cc.fecha,
          interval '1 day'
        ) as d(fecha)
        where extract(isodow from d.fecha) <> 7
      )
    )
  ) then
    raise exception
      'Las cuotas congeladas no coinciden con la fecha de cierre';
  end if;
end;
$$;


notify pgrst, 'reload schema';

commit;
