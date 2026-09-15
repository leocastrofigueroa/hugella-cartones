import { CONTRACT_TERMS, CONTRACT_TERMS_VERSION } from "@/utils/contracts/terms";
import { createAdminClient } from "@/utils/supabase/admin";
import { createClient as createSessionClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

type RequestBody = Record<string, unknown>;

class ValidationError extends Error { }

function getValue(body: RequestBody, ...names: string[]) {
    for (const name of names) {
        if (body[name] !== undefined) return body[name];
    }

    return undefined;
}

function getText(
    body: RequestBody,
    names: string[],
    label: string,
    options: { required?: boolean; maxLength?: number } = {},
) {
    const value = getValue(body, ...names);
    const text = typeof value === "string" ? value.trim() : "";

    if (options.required && !text) {
        throw new ValidationError(`Falta completar: ${label}.`);
    }

    if (options.maxLength && text.length > options.maxLength) {
        throw new ValidationError(`${label} es demasiado extenso.`);
    }

    return text || null;
}

function getNumber(
    body: RequestBody,
    names: string[],
    label: string,
    options: { minimum?: number; required?: boolean } = {},
) {
    const rawValue = getValue(body, ...names);

    if (
        rawValue === undefined ||
        rawValue === null ||
        rawValue === ""
    ) {
        if (options.required) {
            throw new ValidationError(`Falta completar: ${label}.`);
        }

        return 0;
    }

    const value =
        typeof rawValue === "number" ? rawValue : Number(rawValue);

    if (!Number.isFinite(value)) {
        throw new ValidationError(`${label} no es válido.`);
    }

    if (options.minimum !== undefined && value < options.minimum) {
        throw new ValidationError(
            `${label} debe ser igual o mayor que ${options.minimum}.`,
        );
    }

    return value;
}

function getBooleanOrNull(body: RequestBody, names: string[]) {
    const value = getValue(body, ...names);

    if (value === true || value === "true") return true;
    if (value === false || value === "false") return false;

    return null;
}

function isUuid(value: string) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value,
    );
}

function isDate(value: string) {
    return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function jsonError(error: string, status: number) {
    return Response.json({ error }, { status });
}

export async function POST(request: Request) {
    try {
        /*
         * Evita que otro sitio pueda enviar formularios utilizando
         * la sesión abierta del administrador.
         */
        const origin = request.headers.get("origin");

        if (origin && new URL(origin).host !== new URL(request.url).host) {
            return jsonError("Solicitud no permitida.", 403);
        }

        /*
         * Primero comprobamos qué administrador tiene la sesión abierta.
         */
        const sessionClient = await createSessionClient();
        const { data: claimsData, error: claimsError } =
            await sessionClient.auth.getClaims();

        const userId = claimsData?.claims?.sub;

        if (claimsError || !userId) {
            return jsonError("Tu sesión venció. Volvé a iniciar sesión.", 401);
        }

        /*
         * Desde este punto se usa la clave privada solamente en el servidor.
         */
        const adminClient = createAdminClient();

        const { data: authorized, error: authorizationError } = await adminClient
            .from("autorizados_contratos")
            .select("user_id,nombre,puede_preparar,activo")
            .eq("user_id", userId)
            .eq("activo", true)
            .eq("puede_preparar", true)
            .maybeSingle();

        if (authorizationError) {
            console.error("Error verificando autorización:", authorizationError);
            return jsonError("No se pudo verificar tu autorización.", 500);
        }

        if (!authorized) {
            return jsonError(
                "Tu cuenta no está autorizada para preparar contratos.",
                403,
            );
        }

        let body: RequestBody;

        try {
            const parsedBody: unknown = await request.json();

            if (
                !parsedBody ||
                typeof parsedBody !== "object" ||
                Array.isArray(parsedBody)
            ) {
                throw new Error("Invalid body");
            }

            body = parsedBody as RequestBody;
        } catch {
            return jsonError("Los datos enviados no son válidos.", 400);
        }

        /*
         * Validación de los datos recibidos desde el formulario.
         */
        const creditId =
            getText(body, ["creditId", "creditoId"], "crédito", {
                required: true,
                maxLength: 36,
            }) ?? "";

        if (!isUuid(creditId)) {
            throw new ValidationError("El identificador del crédito no es válido.");
        }

        const fechaEntregaPrevista =
            getText(
                body,
                ["fechaEntregaPrevista"],
                "fecha prevista de entrega",
                {
                    required: true,
                    maxLength: 10,
                },
            ) ?? "";

        if (!isDate(fechaEntregaPrevista)) {
            throw new ValidationError(
                "La fecha prevista de entrega no es válida.",
            );
        }

        const precioContado = getNumber(
            body,
            ["precioContado"],
            "precio de contado",
            { required: true, minimum: 0.01 },
        );

        const anticipo = getNumber(body, ["anticipo"], "anticipo", {
            minimum: 0,
        });

        const gastosAdministrativos = getNumber(
            body,
            ["gastosAdministrativos"],
            "gastos administrativos",
            { minimum: 0 },
        );

        const cantidadProducto = getNumber(
            body,
            ["cantidadProducto", "cantidadProductos"],
            "cantidad de productos",
            { required: true, minimum: 1 },
        );

        if (!Number.isInteger(cantidadProducto)) {
            throw new ValidationError(
                "La cantidad de productos debe ser un número entero.",
            );
        }

        const clienteRubro = getText(
            body,
            ["clienteRubro", "rubroComercio"],
            "rubro del comercio",
            { maxLength: 200 },
        );

        const clienteEmail = getText(
            body,
            ["clienteEmail"],
            "correo electrónico del cliente",
            { maxLength: 320 },
        );

        if (
            clienteEmail &&
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clienteEmail)
        ) {
            throw new ValidationError(
                "El correo electrónico del cliente no es válido.",
            );
        }

        const clienteDomicilioComercial = getText(
            body,
            ["clienteDomicilioComercial", "domicilioComercial"],
            "domicilio comercial",
            { maxLength: 500 },
        );

        const domicilioEntrega = getText(
            body,
            ["domicilioEntrega"],
            "domicilio de entrega",
            { required: true, maxLength: 500 },
        );

        const domicilioCobro = getText(
            body,
            ["domicilioCobro"],
            "domicilio de cobro",
            { maxLength: 500 },
        );

        const numeroSerie = getText(
            body,
            ["numeroSerie"],
            "número de serie",
            { maxLength: 200 },
        );

        const observacionesEntrega = getText(
            body,
            ["observacionesEntrega"],
            "observaciones de entrega",
            { maxLength: 2000 },
        );

        const productoExhibido = getBooleanOrNull(body, [
            "productoExhibido",
        ]);

        /*
         * Obtenemos el crédito desde la base. No confiamos en precios
         * ni datos del producto enviados por el navegador.
         */
        const { data: credit, error: creditError } = await adminClient
            .from("creditos")
            .select(
                "id,cliente_id,codigo,producto,fecha_inicio,cantidad_cuotas,importe_cuota",
            )
            .eq("id", creditId)
            .maybeSingle();

        if (creditError) {
            console.error("Error consultando crédito:", creditError);
            return jsonError("No se pudo consultar el crédito.", 500);
        }

        if (!credit) {
            return jsonError("El crédito seleccionado ya no existe.", 404);
        }

        const { data: client, error: clientError } = await adminClient
            .from("clientes")
            .select("id,nombre,dni,domicilio,telefono")
            .eq("id", credit.cliente_id)
            .maybeSingle();

        if (clientError) {
            console.error("Error consultando cliente:", clientError);
            return jsonError("No se pudo consultar al cliente.", 500);
        }

        if (!client) {
            return jsonError("No se encontraron los datos del cliente.", 404);
        }

        const { data: configuration, error: configurationError } =
            await adminClient
                .from("configuracion_contratos")
                .select(
                    "nombre_comercial,titular_nombre,titular_cuit,domicilio_legal,email_contacto",
                )
                .eq("id", 1)
                .maybeSingle();

        if (configurationError) {
            console.error(
                "Error consultando configuración:",
                configurationError,
            );
            return jsonError(
                "No se pudo consultar la configuración de HUGELLA.",
                500,
            );
        }

        if (!configuration) {
            return jsonError(
                "Todavía no está configurada la información legal de HUGELLA.",
                500,
            );
        }

        /*
         * Por ahora permitimos un solo contrato activo por crédito.
         */
        const activeStates = [
            "BORRADOR",
            "PENDIENTE_APROBACION",
            "APROBADO",
            "ENVIADO",
            "VISTO",
            "FIRMADO",
            "REVOCACION_SOLICITADA",
        ];

        const { data: existingContract, error: existingError } =
            await adminClient
                .from("contratos")
                .select("id,access_token,estado")
                .eq("credito_id", creditId)
                .in("estado", activeStates)
                .limit(1)
                .maybeSingle();

        if (existingError) {
            console.error(
                "Error buscando contrato existente:",
                existingError,
            );
            return jsonError(
                "No se pudo verificar si el crédito ya tiene un contrato.",
                500,
            );
        }

        if (existingContract) {
            return Response.json(
                {
                    error: `Este crédito ya tiene un contrato en estado ${existingContract.estado}.`,
                    contract: {
                        id: existingContract.id,
                        token: existingContract.access_token,
                    },
                },
                { status: 409 },
            );
        }

        const cantidadCuotas = Number(credit.cantidad_cuotas);
        const importeCuota = Number(credit.importe_cuota);
        const totalCuotas = cantidadCuotas * importeCuota;
        const precioTotal = anticipo + totalCuotas;
        const montoFinanciado = Math.max(precioContado - anticipo, 0);

        if (!Number.isFinite(precioTotal)) {
            return jsonError(
                "No se pudo calcular el total del contrato.",
                422,
            );
        }

        if (anticipo > precioTotal) {
            throw new ValidationError(
                "El anticipo no puede superar el precio total.",
            );
        }

        /*
         * Creamos el borrador con una copia de todos los datos.
         */
        const { data: contract, error: contractError } = await adminClient
            .from("contratos")
            .insert({
                credito_id: credit.id,
                estado: "BORRADOR",

                vendedor_nombre_comercial: configuration.nombre_comercial,
                vendedor_titular_nombre: configuration.titular_nombre,
                vendedor_titular_cuit: configuration.titular_cuit,
                vendedor_domicilio: configuration.domicilio_legal,
                vendedor_email: configuration.email_contacto,

                cliente_nombre: client.nombre,
                cliente_dni: client.dni,
                cliente_telefono: client.telefono,
                cliente_email: clienteEmail,
                cliente_rubro: clienteRubro,
                cliente_domicilio_particular: client.domicilio,
                cliente_domicilio_comercial: clienteDomicilioComercial,
                domicilio_entrega: domicilioEntrega,
                domicilio_cobro: domicilioCobro,

                producto: credit.producto,
                cantidad_producto: cantidadProducto,
                numero_serie: numeroSerie,
                observaciones_entrega: observacionesEntrega,
                producto_exhibido: productoExhibido,

                fecha_entrega_prevista: fechaEntregaPrevista,

                precio_contado: precioContado,
                anticipo,
                monto_financiado: montoFinanciado,
                precio_total: precioTotal,
                cantidad_cuotas: cantidadCuotas,
                importe_cuota: importeCuota,
                periodicidad: "DIARIA_SIN_DOMINGOS",
                gastos_administrativos: gastosAdministrativos,

                version_condiciones: CONTRACT_TERMS_VERSION,
                condiciones_texto: CONTRACT_TERMS,

                created_by: userId,
            })
            .select("id,access_token,estado")
            .single();

        if (contractError || !contract) {
            console.error("Error creando contrato:", contractError);
            return jsonError(
                "No se pudo crear el borrador del contrato.",
                500,
            );
        }

        /*
         * Guardamos quién creó el contrato y desde qué dispositivo.
         */
        const forwardedFor = request.headers.get("x-forwarded-for");
        const requestIp = forwardedFor?.split(",")[0]?.trim() || null;
        const userAgent = request.headers.get("user-agent");

        const { error: eventError } = await adminClient
            .from("eventos_contrato")
            .insert({
                contrato_id: contract.id,
                evento: "BORRADOR_CREADO",
                actor_tipo: "ADMIN",
                actor_user_id: userId,
                ip: requestIp,
                user_agent: userAgent,
                detalles: {
                    administrador: authorized.nombre,
                    codigo_credito: credit.codigo,
                },
            });

        if (eventError) {
            console.error("Error creando evento:", eventError);

            /*
             * Si no puede registrarse la auditoría, eliminamos el borrador
             * para no dejar un contrato sin historial.
             */
            await adminClient
                .from("contratos")
                .delete()
                .eq("id", contract.id);

            return jsonError(
                "No se pudo registrar el historial del contrato.",
                500,
            );
        }

        return Response.json(
            {
                contract: {
                    id: contract.id,
                    token: contract.access_token,
                    estado: contract.estado,
                },
            },
            { status: 201 },
        );
    } catch (error) {
        if (error instanceof ValidationError) {
            return jsonError(error.message, 422);
        }

        console.error("Error inesperado creando contrato:", error);

        return jsonError(
            "Ocurrió un error inesperado al crear el contrato.",
            500,
        );
    }
}