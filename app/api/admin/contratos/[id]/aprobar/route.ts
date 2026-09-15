import { createAdminClient } from "@/utils/supabase/admin";
import { createClient as createSessionClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

function isUuid(value: string) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value,
    );
}

function jsonError(error: string, status: number) {
    return Response.json({ error }, { status });
}

export async function POST(
    request: Request,
    context: { params: Promise<{ id: string }> },
) {
    try {
        const origin = request.headers.get("origin");

        if (origin && new URL(origin).host !== new URL(request.url).host) {
            return jsonError("Solicitud no permitida.", 403);
        }

        const { id } = await context.params;

        if (!isUuid(id)) {
            return jsonError("El contrato indicado no es válido.", 400);
        }

        /*
         * Comprobamos la sesión del administrador.
         */
        const sessionClient = await createSessionClient();
        const { data: claimsData, error: claimsError } =
            await sessionClient.auth.getClaims();

        const userId = claimsData?.claims?.sub;

        if (claimsError || !userId) {
            return jsonError("Tu sesión venció. Volvé a iniciar sesión.", 401);
        }

        const adminClient = createAdminClient();

        /*
         * Solo una persona expresamente autorizada puede aprobar.
         */
        const { data: authorization, error: authorizationError } =
            await adminClient
                .from("autorizados_contratos")
                .select("user_id,nombre,puede_aprobar,activo")
                .eq("user_id", userId)
                .eq("activo", true)
                .eq("puede_aprobar", true)
                .maybeSingle();

        if (authorizationError) {
            console.error(
                "Error verificando autorización de aprobación:",
                authorizationError,
            );

            return jsonError("No se pudo verificar tu autorización.", 500);
        }

        if (!authorization) {
            return jsonError(
                "Tu cuenta no está autorizada para aprobar contratos.",
                403,
            );
        }

        /*
         * La firma de Facundo debe estar registrada antes de aprobar.
         */
        const { data: configuration, error: configurationError } =
            await adminClient
                .from("configuracion_contratos")
                .select(
                    "firma_titular_ruta,firma_titular_sha256,firma_registrada_at",
                )
                .eq("id", 1)
                .maybeSingle();

        if (configurationError) {
            console.error(
                "Error consultando firma del titular:",
                configurationError,
            );

            return jsonError(
                "No se pudo consultar la firma registrada del titular.",
                500,
            );
        }

        if (
            !configuration?.firma_titular_ruta ||
            !configuration.firma_titular_sha256
        ) {
            return jsonError(
                "Antes de aprobar contratos debemos registrar la firma de Facundo.",
                409,
            );
        }

        /*
         * Verificamos que el contrato exista y continúe como borrador.
         */
        const { data: currentContract, error: contractError } =
            await adminClient
                .from("contratos")
                .select("id,estado,access_token")
                .eq("id", id)
                .maybeSingle();

        if (contractError) {
            console.error("Error consultando contrato:", contractError);
            return jsonError("No se pudo consultar el contrato.", 500);
        }

        if (!currentContract) {
            return jsonError("El contrato no existe.", 404);
        }

        if (currentContract.estado !== "BORRADOR") {
            return jsonError(
                `El contrato ya se encuentra en estado ${currentContract.estado}.`,
                409,
            );
        }

        const approvedAt = new Date().toISOString();

        /*
         * Copiamos al contrato la firma exacta registrada para el titular.
         */
        const { data: approvedContract, error: updateError } =
            await adminClient
                .from("contratos")
                .update({
                    estado: "APROBADO",
                    aprobado_por: userId,
                    aprobado_at: approvedAt,
                    firma_empresa_ruta: configuration.firma_titular_ruta,
                    firma_empresa_sha256: configuration.firma_titular_sha256,
                    updated_at: approvedAt,
                })
                .eq("id", id)
                .eq("estado", "BORRADOR")
                .eq("estado", "APROBADO")
                .select("id,estado,access_token")
                .maybeSingle();

        if (updateError) {
            console.error("Error aprobando contrato:", updateError);
            return jsonError("No se pudo aprobar el contrato.", 500);
        }

        if (!approvedContract) {
            return jsonError(
                "El contrato cambió de estado antes de poder aprobarlo.",
                409,
            );
        }

        const forwardedFor = request.headers.get("x-forwarded-for");
        const requestIp = forwardedFor?.split(",")[0]?.trim() || null;
        const userAgent = request.headers.get("user-agent");

        /*
         * Registramos quién realizó la aprobación.
         */
        const { error: eventError } = await adminClient
            .from("eventos_contrato")
            .insert({
                contrato_id: id,
                evento: "CONTRATO_APROBADO",
                actor_tipo: "ADMIN",
                actor_user_id: userId,
                ip: requestIp,
                user_agent: userAgent,
                detalles: {
                    aprobado_por_nombre: authorization.nombre,
                    firma_titular_ruta: configuration.firma_titular_ruta,
                    firma_titular_sha256: configuration.firma_titular_sha256,
                },
            });

        if (eventError) {
            console.error(
                "Error registrando evento de aprobación:",
                eventError,
            );

            /*
             * Si falla la auditoría, deshacemos la aprobación.
             */
            await adminClient
                .from("contratos")
                .update({
                    estado: "BORRADOR",
                    aprobado_por: null,
                    aprobado_at: null,
                    firma_empresa_ruta: null,
                    firma_empresa_sha256: null,
                    updated_at: new Date().toISOString(),
                })
                .eq("id", id)
                .eq("aprobado_por", userId);

            return jsonError(
                "No se pudo registrar la auditoría de la aprobación.",
                500,
            );
        }

        return Response.json({
            contract: {
                id: approvedContract.id,
                estado: approvedContract.estado,
                publicUrl: `/contrato/${approvedContract.access_token}`,
            },
        });
    } catch (error) {
        console.error("Error inesperado aprobando contrato:", error);

        return jsonError(
            "Ocurrió un error inesperado al aprobar el contrato.",
            500,
        );
    }
}