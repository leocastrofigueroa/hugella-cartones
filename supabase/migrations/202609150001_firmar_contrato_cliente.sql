begin;

-- Called only by the server's admin client. The public browser has no EXECUTE.
-- Contract transition and immutable audit are one transaction: either both
-- persist or neither does. Storage cleanup is handled by the calling route.
create or replace function public.firmar_contrato_cliente(
    p_id uuid,
    p_token uuid,
    p_revision timestamptz,
    p_nombre text,
    p_dni text,
    p_texto_aceptacion text,
    p_ruta text,
    p_sha256 text,
    p_ip inet,
    p_user_agent text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
    v_contract public.contratos%rowtype;
    v_signed_at timestamptz;
    v_snapshot jsonb;
    v_acceptance constant text := 'Declaro que leí el contrato completo, acepto todas sus condiciones y reconozco los precios y el plan de cuotas detallados. Autorizo el registro de la fecha, hora, dirección IP y datos de mi dispositivo como evidencia de mi aceptación y firma.';
begin
    select * into v_contract from public.contratos
    where id = p_id and access_token = p_token
    for update;

    if not found then
        return jsonb_build_object('ok', false);
    end if;

    -- Retrying this exact operation after a lost response must not duplicate audit.
    if v_contract.estado = 'FIRMADO' and v_contract.firmado_at is not null
       and v_contract.firma_cliente_ruta = p_ruta
       and v_contract.firma_cliente_sha256 = p_sha256 then
        return jsonb_build_object('ok', true, 'firmado_at', v_contract.firmado_at);
    end if;

    if v_contract.estado not in ('APROBADO', 'ENVIADO', 'VISTO')
       or v_contract.firmado_at is not null
       or v_contract.updated_at is distinct from p_revision then
        return jsonb_build_object('ok', false);
    end if;

    if p_nombre is null or char_length(p_nombre) not between 2 and 150
       or p_dni is null or p_dni !~ '^[0-9]{7,9}$'
       or p_texto_aceptacion is distinct from v_acceptance
       or p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$'
       or p_ruta is null or p_ruta !~ ('^firmas-cliente/' || p_id::text || '/[0-9a-f-]{36}\.png$')
       or char_length(p_user_agent) > 512 then
        raise exception using errcode = '22023', message = 'Datos de firma inválidos.';
    end if;

    if v_contract.cliente_dni is not null and v_contract.cliente_dni <> ''
       and regexp_replace(v_contract.cliente_dni, '[.[:space:]]', '', 'g') <> p_dni then
        return jsonb_build_object('ok', false);
    end if;

    v_signed_at := clock_timestamp();

    -- Explicit allowlist: future columns, access tokens and credentials cannot
    -- accidentally become part of the accepted document.
    select jsonb_object_agg(key, value) into v_snapshot
    from jsonb_each(to_jsonb(v_contract))
    where key = any(array[
        'id', 'credito_id',
        'vendedor_nombre_comercial', 'vendedor_titular_nombre', 'vendedor_titular_cuit',
        'vendedor_domicilio', 'vendedor_email',
        'cliente_nombre', 'cliente_dni', 'cliente_telefono', 'cliente_email', 'cliente_rubro',
        'cliente_domicilio_particular', 'cliente_domicilio_comercial',
        'domicilio_entrega', 'domicilio_cobro', 'producto', 'cantidad_producto',
        'numero_serie', 'observaciones_entrega', 'producto_exhibido',
        'fecha_contrato', 'fecha_entrega_prevista', 'fecha_entrega_real',
        'precio_contado', 'anticipo', 'monto_financiado', 'precio_total',
        'cantidad_cuotas', 'importe_cuota', 'periodicidad', 'tasa_efectiva_anual',
        'costo_financiero_total', 'gastos_administrativos',
        'version_condiciones', 'condiciones_texto', 'aprobado_por', 'aprobado_at',
        'firma_empresa_ruta', 'firma_empresa_sha256'
    ]);

    v_snapshot := v_snapshot || jsonb_build_object(
        'estado', 'FIRMADO', 'firmado_at', v_signed_at,
        'cliente_acepto_condiciones', true, 'texto_aceptacion', v_acceptance,
        'nombre_declarado', p_nombre, 'dni_declarado', p_dni,
        'firma_cliente_ruta', p_ruta, 'firma_cliente_sha256', p_sha256
    );

    update public.contratos set
        estado = 'FIRMADO',
        cliente_acepto_condiciones = true,
        texto_aceptacion = v_acceptance,
        firma_cliente_ruta = p_ruta,
        firma_cliente_sha256 = p_sha256,
        firmado_at = v_signed_at,
        firma_ip = p_ip,
        firma_user_agent = p_user_agent,
        documento_snapshot = v_snapshot,
        updated_at = v_signed_at
    where id = v_contract.id;

    insert into public.eventos_contrato (
        contrato_id, evento, actor_tipo, ip, user_agent, detalles
    ) values (
        v_contract.id, 'FIRMA_CLIENTE', 'CLIENTE', p_ip, p_user_agent,
        jsonb_build_object(
            'firma_cliente_sha256', p_sha256,
            'nombre_declarado', p_nombre,
            'dni_enmascarado', repeat('*', char_length(p_dni) - 3) || right(p_dni, 3)
        )
    );

    return jsonb_build_object('ok', true, 'firmado_at', v_signed_at);
end;
$$;

revoke all on function public.firmar_contrato_cliente(uuid, uuid, timestamptz, text, text, text, text, text, inet, text)
    from public, anon, authenticated;
grant execute on function public.firmar_contrato_cliente(uuid, uuid, timestamptz, text, text, text, text, text, inet, text)
    to service_role;

commit;
