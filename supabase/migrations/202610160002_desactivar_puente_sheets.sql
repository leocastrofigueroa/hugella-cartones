begin;

-- HUGELLA ya opera desde la aplicación administrativa y Supabase.
-- Se conserva toda la infraestructura histórica de Sheets como respaldo,
-- pero se impide que usuarios autenticados sigan utilizando el puente.
--
-- Este cambio es reversible mediante GRANT EXECUTE sobre estas mismas firmas.

revoke execute
on function public.actualizar_credito_desde_sheets(
  text,
  text,
  text,
  text,
  text,
  text,
  date,
  integer,
  numeric
)
from authenticated;

revoke execute
on function public.crear_credito_sheets(
  uuid,
  text,
  boolean,
  uuid,
  text,
  text,
  text,
  text,
  date,
  integer,
  numeric
)
from authenticated;

revoke execute
on function public.finalizar_evento_pago_sheets(
  uuid,
  uuid,
  text,
  text
)
from authenticated;

revoke execute
on function public.marcar_pago_sincronizado_sheets(uuid)
from authenticated;

revoke execute
on function public.obtener_cierres_creditos_sheets(uuid)
from authenticated;

revoke execute
on function public.obtener_pagos_admin_pendientes_sheets()
from authenticated;

revoke execute
on function public.preparar_retiro_pago_sheets(
  uuid,
  uuid
)
from authenticated;

revoke execute
on function public.reservar_eventos_pagos_sheets(integer)
from authenticated;

commit;
