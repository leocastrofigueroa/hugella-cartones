-- Garantía global de identidad sin reescribir clientes ni cambiar RPC.
-- Misma normalización ASCII que proteger_identidad_credito_sheets.
-- NULL y DNI sin dígitos generan NULL: no colisionan entre sí.
-- Si hay identidades duplicadas, falla y revierte; no corrige datos.
-- Rollback manual, NO ejecutado por esta migración:
-- DROP INDEX public.clientes_dni_normalizado_unique;

begin;

create unique index clientes_dni_normalizado_unique
  on public.clientes (
    nullif(regexp_replace(coalesce(dni, ''), '[^0-9]', '', 'g'), '')
  );

commit;
