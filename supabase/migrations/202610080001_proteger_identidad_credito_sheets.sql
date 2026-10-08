-- Verified locally against the literal production body supplied by the user.
-- Preserve signature, jsonb return, SECURITY DEFINER, search_path, owner and ACL.
-- Unsupported source shapes abort atomically; this migration is applied once.
BEGIN;

DO $migration$
DECLARE
  target oid := to_regprocedure('public.actualizar_credito_desde_sheets(text,text,text,text,text,text,date,integer,numeric)');
  original text;
  definition text;
  patched text;
  metadata jsonb;
  client_pattern text := 'update\s+public\.clientes\s+set\s+nombre\s*=\s*p_nombre\s*,\s*dni\s*=\s*p_dni\s*,\s*telefono\s*=\s*p_telefono\s*,\s*domicilio\s*=\s*p_domicilio\s+where\s+id\s*=\s*v_cliente_id\s*;';
  credit_pattern text := 'update\s+public\.creditos\s+set\s+producto\s*=\s*p_producto\s*,\s*fecha_inicio\s*=\s*p_fecha_inicio\s*,\s*cantidad_cuotas\s*=\s*p_cantidad_cuotas\s*,\s*importe_cuota\s*=\s*p_importe_cuota\s+where\s+id\s*=\s*v_credito_id\s*;';
  guard text := $guard$
  -- Identity is checked under locks before the only remaining write.
  DECLARE
    identity_credit public.creditos%ROWTYPE;
    identity_client public.clientes%ROWTYPE;
    sheet_dni text;
    stored_dni text;
    sheet_name text;
    stored_name text;
  BEGIN
    IF nullif(btrim(p_codigo), '') IS NULL THEN
      RAISE EXCEPTION 'Crédito %: código vacío', p_codigo USING ERRCODE = '22023';
    END IF;
    BEGIN
      SELECT * INTO STRICT identity_credit FROM public.creditos
      WHERE codigo = p_codigo FOR UPDATE;
    EXCEPTION
      WHEN no_data_found OR too_many_rows THEN
        RAISE EXCEPTION 'Crédito %: código inexistente o ambiguo', p_codigo USING ERRCODE = '22023';
    END;
    IF identity_credit.id IS DISTINCT FROM v_credito_id
       OR identity_credit.cliente_id IS DISTINCT FROM v_cliente_id THEN
      RAISE EXCEPTION 'Crédito %: asociación modificada concurrentemente', p_codigo USING ERRCODE = '22023';
    END IF;
    SELECT * INTO identity_client FROM public.clientes
    WHERE id = identity_credit.cliente_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Crédito %: cliente asociado inexistente', p_codigo USING ERRCODE = '22023';
    END IF;
    sheet_dni := regexp_replace(coalesce(p_dni, ''), '[^0-9]', '', 'g');
    stored_dni := regexp_replace(coalesce(identity_client.dni, ''), '[^0-9]', '', 'g');
    IF sheet_dni = '' OR stored_dni = '' OR sheet_dni <> stored_dni THEN
      RAISE EXCEPTION 'Crédito %: DNI vacío o diferente del cliente asociado; no se aplicaron cambios', p_codigo USING ERRCODE = '22023';
    END IF;
    sheet_name := upper(btrim(regexp_replace(coalesce(p_nombre, ''), '[[:space:]]+', ' ', 'g')));
    stored_name := upper(btrim(regexp_replace(coalesce(identity_client.nombre, ''), '[[:space:]]+', ' ', 'g')));
    IF sheet_name = '' OR stored_name = '' OR sheet_name <> stored_name THEN
      RAISE EXCEPTION 'Crédito %: nombre vacío o diferente del cliente asociado; no se aplicaron cambios', p_codigo USING ERRCODE = '22023';
    END IF;
    IF nullif(regexp_replace(coalesce(p_producto, ''), '[[:space:]]', '', 'g'), '') IS NULL
       OR p_fecha_inicio IS NULL OR NOT isfinite(p_fecha_inicio)
       OR p_cantidad_cuotas IS NULL OR p_cantidad_cuotas <= 0
       OR p_importe_cuota IS NULL OR p_importe_cuota <= 0
       OR p_importe_cuota::text IN ('NaN', 'Infinity', '-Infinity') THEN
      RAISE EXCEPTION 'Crédito %: producto, fecha, cantidad de cuotas o importe inválido', p_codigo USING ERRCODE = '22023';
    END IF;
    -- p_telefono and p_domicilio remain accepted only for API compatibility.
  END;
  $guard$;
BEGIN
  IF target IS NULL THEN
    RAISE EXCEPTION 'Revisión requerida: falta actualizar_credito_desde_sheets';
  END IF;
  SELECT p.prosrc, pg_get_functiondef(p.oid), to_jsonb(p) - 'prosrc'
  INTO original, definition, metadata FROM pg_proc p WHERE p.oid = target;
  IF (SELECT lanname FROM pg_language WHERE oid = (metadata->>'prolang')::oid) <> 'plpgsql'
     OR regexp_count(original, client_pattern, 1, 'i') <> 1
     OR regexp_count(original, credit_pattern, 1, 'i') <> 1
     OR regexp_count(original, '\mupdate\M', 1, 'i') <> 2
     OR original ~* '\m(insert|delete|merge|execute|perform|call)\M'
     OR original ~* '\mexception\s+when\M'
     OR strpos(lower(original), lower((regexp_match(original, client_pattern, 'i'))[1]))
        > strpos(lower(original), lower((regexp_match(original, credit_pattern, 'i'))[1])) THEN
    RAISE EXCEPTION 'Revisión requerida: cuerpo RPC no compatible; no se modificó la función';
  END IF;
  -- replace(), not regexp replacement, preserves literal escapes in the guard.
  patched := replace(original, (regexp_match(original, client_pattern, 'i'))[1], guard);
  EXECUTE replace(definition, original, patched);
  IF (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = target) IS DISTINCT FROM metadata
     OR (SELECT prosrc FROM pg_proc WHERE oid = target) IS DISTINCT FROM patched THEN
    RAISE EXCEPTION 'Metadatos o permisos cambiaron: se revierte la migración';
  END IF;
END;
$migration$;

COMMIT;
