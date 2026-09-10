-- LOCAL REVIEW ONLY. No table writes, payment changes, or auth/RLS changes.
-- CREATE (not OR REPLACE) deliberately fails on unexpected name collisions.
create function public.hugella_fecha_comercial()
returns date language sql stable set search_path = ''
as $$
  select (statement_timestamp() at time zone 'America/Argentina/Mendoza')::date;
$$;

create function public.hugella_cuotas_exigibles(
  p_fecha_inicio date,
  p_cantidad_cuotas integer,
  p_fecha_evaluacion date default public.hugella_fecha_comercial()
)
returns integer language sql immutable strict set search_path = ''
as $$
  -- Inclusive interval. Each complete ISO week contributes one Sunday.
  -- Date subtraction avoids DST/UTC duration errors and is O(1).
  select greatest(0, least(p_cantidad_cuotas,
    case when p_fecha_evaluacion < p_fecha_inicio then 0
    else (p_fecha_evaluacion - p_fecha_inicio + 1)
      - ((p_fecha_evaluacion - p_fecha_inicio + 1
          + extract(isodow from p_fecha_inicio)::integer - 1) / 7)
    end
  ));
$$;

create function public.hugella_estado_credito(
  p_cantidad_cuotas integer,
  p_cuotas_pagadas bigint,
  p_cuotas_exigibles integer
)
returns text language sql immutable strict set search_path = ''
as $$
  select case
    when p_cuotas_pagadas >= p_cantidad_cuotas then 'CANCELADO'
    when p_cuotas_pagadas > p_cuotas_exigibles then 'ADELANTADO'
    when p_cuotas_pagadas = p_cuotas_exigibles then 'AL DIA'
    else 'ATRASADO'
  end;
$$;

-- Pure functions only: these grants expose no rows or financial information.
revoke all on function public.hugella_fecha_comercial() from public;
revoke all on function public.hugella_cuotas_exigibles(date, integer, date) from public;
revoke all on function public.hugella_estado_credito(integer, bigint, integer) from public;
grant execute on function public.hugella_fecha_comercial() to anon, authenticated;
grant execute on function public.hugella_cuotas_exigibles(date, integer, date) to anon, authenticated;
grant execute on function public.hugella_estado_credito(integer, bigint, integer) to anon, authenticated;
