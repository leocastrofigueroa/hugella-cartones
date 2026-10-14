-- Backfill histórico de períodos de tarjetas.
-- Fuente: hoja "Listas" del sistema histórico HUGELLA.
--
-- Objetivos:
-- 1. Incorporar los períodos históricos faltantes de Visa Facu y Visa Leo.
-- 2. Conservar el UUID del período Visa Leo 22/10/2026 -> 02/11/2026
--    porque ya está utilizado por una obligación real.
-- 3. No mover ni reasignar obligaciones.
-- 4. Fallar cerrado si producción no coincide exactamente con el estado auditado.

begin;

do $migration$
declare
  v_actor constant uuid := '34366896-c76c-4959-ac05-519274da9736';
  v_visa_facu constant uuid := '028985a6-a5f7-4569-948b-10abf9ba2b76';
  v_visa_leo constant uuid := '6087c186-6e63-4469-9b4d-99f0873caf5e';

  v_periodo_leo_actual constant uuid :=
    '5d5a4689-416e-451b-add1-ec71fd3eea36';

  v_obligacion_actual constant uuid :=
    '545c1742-003a-451c-9e55-748d1cc93dcb';

  v_periodo_leo_historico uuid := gen_random_uuid();
begin
  ---------------------------------------------------------------------------
  -- PREFLIGHT
  ---------------------------------------------------------------------------

  if not exists (
    select 1
    from auth.users
    where id = v_actor
  ) then
    raise exception 'Actor histórico esperado no existe';
  end if;

  if not exists (
    select 1
    from public.tarjetas_credito
    where id = v_visa_facu
      and nombre = 'Visa Facu'
      and entidad = 'Santander'
      and activo is true
  ) then
    raise exception 'Visa Facu no coincide con el estado auditado';
  end if;

  if not exists (
    select 1
    from public.tarjetas_credito
    where id = v_visa_leo
      and nombre = 'Visa Leo'
      and entidad = 'Santander'
      and activo is true
  ) then
    raise exception 'Visa Leo no coincide con el estado auditado';
  end if;

  -- Antes de este backfill Visa Facu no debe tener períodos.
  if exists (
    select 1
    from public.periodos_tarjetas
    where tarjeta_id = v_visa_facu
  ) then
    raise exception 'Visa Facu ya tiene períodos: revisión manual requerida';
  end if;

  -- Visa Leo debe tener exactamente el único período que auditamos.
  if (
    select count(*)
    from public.periodos_tarjetas
    where tarjeta_id = v_visa_leo
  ) <> 1 then
    raise exception 'Visa Leo no tiene exactamente un período: revisión requerida';
  end if;

  if not exists (
    select 1
    from public.periodos_tarjetas
    where id = v_periodo_leo_actual
      and tarjeta_id = v_visa_leo
      and orden = 1
      and fecha_cierre = date '2026-10-22'
      and fecha_vencimiento = date '2026-11-02'
      and actor_id = v_actor
  ) then
    raise exception 'Período actual de Visa Leo no coincide con el estado auditado';
  end if;

  -- Debe existir exactamente la obligación real auditada en ese período.
  if (
    select count(*)
    from public.obligaciones_tarjetas
    where periodo_id = v_periodo_leo_actual
  ) <> 1 then
    raise exception 'Cantidad inesperada de obligaciones en período Visa Leo';
  end if;

  if not exists (
    select 1
    from public.obligaciones_tarjetas
    where id = v_obligacion_actual
      and compra_id = '7171c5cb-90dc-4a41-a470-29b207bc2895'::uuid
      and tramo_id = '362fba80-fa95-49ff-8514-22dbf1627c2d'::uuid
      and tarjeta_id = v_visa_leo
      and numero_cuota = 1
      and cantidad_cuotas = 3
      and importe = 114499.67
      and periodo_id = v_periodo_leo_actual
  ) then
    raise exception 'Obligación real de Visa Leo no coincide con la auditoría';
  end if;

  if exists (
    select 1
    from public.pagos_resumenes_tarjetas
    where periodo_id = v_periodo_leo_actual
  ) then
    raise exception 'El período Visa Leo ya posee pagos: backfill cancelado';
  end if;

  -- Bloqueos para evitar cambios concurrentes durante la corrección.
  perform 1
  from public.tarjetas_credito
  where id in (v_visa_facu, v_visa_leo)
  order by id
  for update;

  perform 1
  from public.periodos_tarjetas
  where id = v_periodo_leo_actual
  for update;

  ---------------------------------------------------------------------------
   ---------------------------------------------------------------------------
  -- VISA LEO
  --
  -- Primero corregimos Visa Leo, antes de generar eventos diferidos
  -- adicionales sobre periodos_tarjetas.
  --
  -- El período 22/10 -> 02/11 ya existe como orden 1 y está utilizado.
  -- Conservamos exactamente su UUID y todos sus vínculos.
  ---------------------------------------------------------------------------

  alter table public.periodos_tarjetas
    disable trigger periodo_utilizado_inmutable;

  -- Pasa el período real existente de orden 1 a orden 2.
  update public.periodos_tarjetas
  set orden = 2
  where id = v_periodo_leo_actual;

  -- Incorpora el período histórico anterior como orden 1.
  insert into public.periodos_tarjetas
    (id, tarjeta_id, orden, fecha_cierre, fecha_vencimiento, actor_id)
  values
    (
      v_periodo_leo_historico,
      v_visa_leo,
      1,
      date '2026-09-24',
      date '2026-10-05',
      v_actor
    );

  -- Forzamos ahora la validación diferida generada por la corrección
  -- antes de intentar volver a alterar los triggers de esta tabla.
  set constraints all immediate;

  alter table public.periodos_tarjetas
    enable trigger periodo_utilizado_inmutable;

  -- Las validaciones siguientes vuelven a quedar diferidas hasta que
  -- explícitamente las forcemos al final.
  set constraints all deferred;

  ---------------------------------------------------------------------------
  -- VISA FACU
  --
  -- No existían períodos previos. Se incorporan los cuatro períodos
  -- históricos en orden cronológico.
  ---------------------------------------------------------------------------

  insert into public.periodos_tarjetas
    (tarjeta_id, orden, fecha_cierre, fecha_vencimiento, actor_id)
  values
    (v_visa_facu, 1, date '2026-07-23', date '2026-08-03', v_actor),
    (v_visa_facu, 2, date '2026-08-20', date '2026-09-01', v_actor),
    (v_visa_facu, 3, date '2026-09-24', date '2026-10-05', v_actor),
    (v_visa_facu, 4, date '2026-10-22', date '2026-11-02', v_actor);
  ---------------------------------------------------------------------------
  -- POSTCHECK
  ---------------------------------------------------------------------------

  if (
    select count(*)
    from public.periodos_tarjetas
    where tarjeta_id = v_visa_facu
  ) <> 4 then
    raise exception 'Backfill Visa Facu incompleto';
  end if;

  if (
    select count(*)
    from public.periodos_tarjetas
    where tarjeta_id = v_visa_leo
  ) <> 2 then
    raise exception 'Backfill Visa Leo incompleto';
  end if;

  -- El período utilizado conserva exactamente su UUID y ahora es orden 2.
  if not exists (
    select 1
    from public.periodos_tarjetas
    where id = v_periodo_leo_actual
      and tarjeta_id = v_visa_leo
      and orden = 2
      and fecha_cierre = date '2026-10-22'
      and fecha_vencimiento = date '2026-11-02'
  ) then
    raise exception 'Período utilizado Visa Leo no quedó en orden 2';
  end if;

  -- La obligación real debe seguir apuntando al mismo UUID.
  if not exists (
    select 1
    from public.obligaciones_tarjetas
    where id = v_obligacion_actual
      and periodo_id = v_periodo_leo_actual
  ) then
    raise exception 'La obligación real cambió de período';
  end if;

  -- Las cuotas 2 y 3 de la compra real deben continuar sin asignación.
  if exists (
    select 1
    from public.obligaciones_tarjetas
    where tramo_id = '362fba80-fa95-49ff-8514-22dbf1627c2d'::uuid
      and numero_cuota in (2, 3)
      and periodo_id is not null
  ) then
    raise exception 'El backfill asignó indebidamente cuotas futuras';
  end if;

  -- Comprobación explícita del orden cronológico final.
  if exists (
    select 1
    from public.periodos_tarjetas p
    join public.periodos_tarjetas vecino
      on vecino.tarjeta_id = p.tarjeta_id
     and vecino.id <> p.id
    where p.tarjeta_id in (v_visa_facu, v_visa_leo)
      and (
        (
          vecino.orden < p.orden
          and (
            vecino.fecha_cierre >= p.fecha_cierre
            or vecino.fecha_vencimiento >= p.fecha_vencimiento
          )
        )
        or
        (
          vecino.orden > p.orden
          and (
            vecino.fecha_cierre <= p.fecha_cierre
            or vecino.fecha_vencimiento <= p.fecha_vencimiento
          )
        )
      )
  ) then
    raise exception 'Orden cronológico final de períodos inválido';
  end if;
end;
$migration$;

-- Fuerza ahora los constraint triggers diferidos.
-- Si cualquier integridad financiera quedó inválida, falla antes del COMMIT.
set constraints all immediate;

commit;
