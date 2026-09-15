import { createHash } from "node:crypto";
import { createAdminClient } from "@/utils/supabase/admin";
import { createClient as createSessionClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

const MAX_SIGNATURE_SIZE = 2 * 1024 * 1024;

function jsonError(error: string, status: number) {
    return Response.json({ error }, { status });
}

function isPng(bytes: Uint8Array) {
    const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];

    return (
        bytes.length >= pngSignature.length &&
        pngSignature.every((value, index) => bytes[index] === value)
    );
}

export async function POST(request: Request) {
    try {
        const origin = request.headers.get("origin");

        if (origin && new URL(origin).host !== new URL(request.url).host) {
            return jsonError("Solicitud no permitida.", 403);
        }

        /*
         * Verificamos quién tiene la sesión administrativa abierta.
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
         * Solo una persona autorizada para aprobar contratos
         * puede registrar la firma del titular.
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
                "Error verificando autorización de firma:",
                authorizationError,
            );

            return jsonError("No se pudo verificar tu autorización.", 500);
        }

        if (!authorization) {
            return jsonError(
                "Tu cuenta no está autorizada para registrar la firma.",
                403,
            );
        }

        let formData: FormData;

        try {
            formData = await request.formData();
        } catch {
            return jsonError("No se pudo leer el archivo enviado.", 400);
        }

        const signatureFile = formData.get("signature");

        if (!(signatureFile instanceof File)) {
            return jsonError("Seleccioná una imagen de la firma.", 400);
        }

        if (signatureFile.size === 0) {
            return jsonError("La imagen seleccionada está vacía.", 400);
        }

        if (signatureFile.size > MAX_SIGNATURE_SIZE) {
            return jsonError(
                "La imagen de la firma no puede superar los 2 MB.",
                413,
            );
        }

        if (signatureFile.type !== "image/png") {
            return jsonError("La firma debe estar en formato PNG.", 415);
        }

        const bytes = new Uint8Array(await signatureFile.arrayBuffer());

        /*
         * También comprobamos el contenido real del archivo,
         * no solamente su extensión.
         */
        if (!isPng(bytes)) {
            return jsonError(
                "El archivo seleccionado no es una imagen PNG válida.",
                415,
            );
        }

        const sha256 = createHash("sha256")
            .update(bytes)
            .digest("hex");

        const now = new Date().toISOString();
        const safeTimestamp = now.replaceAll(":", "-");
        const storagePath =
            `firmas-titular/${safeTimestamp}-${sha256.slice(0, 16)}.png`;

        const { data: currentConfiguration, error: configurationError } =
            await adminClient
                .from("configuracion_contratos")
                .select("firma_titular_ruta")
                .eq("id", 1)
                .maybeSingle();

        if (configurationError || !currentConfiguration) {
            console.error(
                "Error consultando configuración de firma:",
                configurationError,
            );

            return jsonError(
                "No se pudo consultar la configuración del titular.",
                500,
            );
        }

        /*
         * Guardamos la imagen dentro del bucket privado.
         */
        const { error: uploadError } = await adminClient.storage
            .from("contratos-privados")
            .upload(storagePath, bytes, {
                contentType: "image/png",
                cacheControl: "3600",
                upsert: false,
            });

        if (uploadError) {
            console.error("Error subiendo firma:", uploadError);

            return jsonError(
                "No se pudo guardar la imagen de la firma.",
                500,
            );
        }

        /*
         * Registramos la ruta, su huella digital y quién la cargó.
         */
        const { error: updateError } = await adminClient
            .from("configuracion_contratos")
            .update({
                firma_titular_ruta: storagePath,
                firma_titular_sha256: sha256,
                firma_registrada_por: userId,
                firma_registrada_at: now,
                updated_at: now,
            })
            .eq("id", 1);

        if (updateError) {
            console.error(
                "Error actualizando configuración de firma:",
                updateError,
            );

            await adminClient.storage
                .from("contratos-privados")
                .remove([storagePath]);

            return jsonError(
                "La imagen se recibió, pero no se pudo registrar.",
                500,
            );
        }

        return Response.json({
            signature: {
                path: storagePath,
                sha256,
                registeredAt: now,
                registeredBy: authorization.nombre,
            },
        });
    } catch (error) {
        console.error(
            "Error inesperado registrando firma:",
            error,
        );

        return jsonError(
            "Ocurrió un error inesperado al registrar la firma.",
            500,
        );
    }
}