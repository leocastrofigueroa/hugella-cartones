begin;

-- Motor monetario interno. Todas las escrituras de pagos deben serializarse
-- bloqueando primero la fila del credito mediante esta funcion.
create function public.recalcular_pagos_credito(p_credito_id uuid)
returns table(
  total_pagado numeric,
  cuotas_pagadas integer,
  cuotas_pendientes integer,
  remanente numeric,
  estado text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_importe_cuota numeric;
  v_cantidad_cuotas integer;
  v_fecha_inicio date;
  v_valor_total numeric;
  v_total_pagado numeric;
  v_acumulado numeric := 0;
  v_cuotas_antes integer := 0;
  v_cuotas_despues integer := 0;
  v_remanente numeric := 0;
  v_estado text;
  v_pago record;
begin
  if p_credito_id is null then
    raise exception using
      errcode = '22023',
      message = 'Credit id is required';
  end if;

  select cr.importe_cuota, cr.cantidad_cuotas, cr.fecha_inicio
    into v_importe_cuota, v_cantidad_cuotas, v_fecha_inicio
  from public.creditos as cr
  where cr.id = p_credito_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Credit not found';
  end if;

  if v_importe_cuota is null or v_importe_cuota <= 0 then
    raise exception using
      errcode = '22023',
      message = 'Credit installment amount must be positive';
  end if;
  if v_cantidad_cuotas is null or v_cantidad_cuotas <= 0 then
    raise exception using
      errcode = '22023',
      message = 'Credit installment count must be positive';
  end if;
  if v_fecha_inicio is null then
    raise exception using
      errcode = '22023',
      message = 'Credit start date is required';
  end if;

  v_valor_total := v_importe_cuota * v_cantidad_cuotas;

  select coalesce(sum(pg.importe), 0)
    into v_total_pagado
  from public.pagos as pg
  where pg.credito_id = p_credito_id
    and pg.estado = 'VALIDO';

  if v_total_pagado > v_valor_total then
    raise exception using
      errcode = '23514',
      message = 'Valid payments exceed credit total';
  end if;

  for v_pago in
    select pg.id, pg.importe
    from public.pagos as pg
    where pg.credito_id = p_credito_id
      and pg.estado = 'VALIDO'
    order by pg.created_at asc, pg.id asc
    for update
  loop
    v_cuotas_antes := least(
      v_cantidad_cuotas::numeric,
      floor(v_acumulado / v_importe_cuota)
    )::integer;
    v_acumulado := v_acumulado + v_pago.importe;
    v_cuotas_despues := least(
      v_cantidad_cuotas::numeric,
      floor(v_acumulado / v_importe_cuota)
    )::integer;
    v_remanente := v_acumulado - (v_cuotas_despues * v_importe_cuota);

    update public.pagos as pg
    set cuotas_aplicadas = v_cuotas_despues - v_cuotas_antes,
        remanente = v_remanente
    where pg.id = v_pago.id
      and pg.estado = 'VALIDO';
  end loop;

  v_estado := public.hugella_estado_credito(
    v_cantidad_cuotas,
    v_cuotas_despues::bigint,
    public.hugella_cuotas_exigibles(v_fecha_inicio, v_cantidad_cuotas)
  );

  update public.creditos as cr
  set estado = v_estado
  where cr.id = p_credito_id;

  return query select
    v_total_pagado,
    v_cuotas_despues,
    v_cantidad_cuotas - v_cuotas_despues,
    v_remanente,
    v_estado;
end;
$$;

revoke all on function public.recalcular_pagos_credito(uuid)
  from public, anon, authenticated;

commit;
