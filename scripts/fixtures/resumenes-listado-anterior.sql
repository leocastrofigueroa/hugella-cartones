-- Sólo definiciones SQL anteriores para comparación local; sin datos ni credenciales.
create or replace function public.listar_resumenes_tarjeta_admin(p_tarjeta_id uuid,p_limite integer default 50,p_offset integer default 0)
returns table(periodo_id uuid,orden integer,fecha_cierre date,fecha_vencimiento date,
  total_obligaciones_hugella numeric,total_pagado numeric,saldo numeric,estado text)
language plpgsql stable security definer set search_path='' as $rpc$
begin
  if auth.uid() is null or public.es_admin_hugella() is not true then raise exception 'No autorizado' using errcode='42501'; end if;
  if p_tarjeta_id is null or p_limite is null or p_limite not between 1 and 100 or p_offset is null or p_offset<0 then
    raise exception 'Paginación inválida' using errcode='22023'; end if;
  if not exists(select 1 from public.tarjetas_credito where id=p_tarjeta_id) then
    raise exception 'Tarjeta inexistente' using errcode='22023'; end if;
  -- Página primero. Reutiliza el cálculo JSON con rechazo explícito de inconsistencias.
  return query select p.id,p.orden,p.fecha_cierre,p.fecha_vencimiento,
    (r.j->>'total_obligaciones_hugella')::numeric,(r.j->>'total_pagado')::numeric,
    (r.j->>'saldo')::numeric,r.j->>'estado'
    from (select per.* from public.periodos_tarjetas per where per.tarjeta_id=p_tarjeta_id
      order by per.orden limit p_limite offset p_offset) p
    cross join lateral (select public.obtener_saldo_periodo_tarjeta_admin(p.id) j) r
    order by p.orden;
end;
$rpc$;
create or replace function public.listar_resumenes_tarjeta_financieros_admin(p_tarjeta_id uuid,p_limite integer default 50,p_offset integer default 0)
returns setof jsonb language plpgsql stable security definer set search_path='' as $rpc$
begin
  -- La RPC existente valida autorización, tarjeta y paginación.
  return query select to_jsonb(s)||public.obtener_saldo_periodo_tarjeta_admin(s.periodo_id)
    from public.listar_resumenes_tarjeta_admin(p_tarjeta_id,p_limite,p_offset) s order by s.orden;
end;
$rpc$;
