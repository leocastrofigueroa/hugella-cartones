import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { createAdminClient } from "@/utils/supabase/admin";
import { generarContratoPdf } from "@/utils/contracts/generate-pdf";

export const runtime = "nodejs";

const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Snapshot = Record<string, unknown>;

function jsonError(error: string, status: number) {
    return Response.json(
        { error },
        {
            status,
            headers: {
                "Cache-Control": "no-store",
            },
        },
    );
}

function snapshotString(
    snapshot: Snapshot,
    key: string,
) {
    const value = snapshot[key];

    return typeof value === "string" && value.trim()
        ? value
        : null;
}

function sha256(bytes: Uint8Array) {
    return createHash("sha256")
        .update(bytes)
        .digest("hex");
}

async function downloadPrivateFile(
    admin: ReturnType<typeof createAdminClient>,
    path: string,
) {
    const { data, error } = await admin.storage
        .from("contratos-privados")
        .download(path);

    if (error || !data) {
        throw new Error("PRIVATE_FILE_NOT_FOUND");
    }

    return new Uint8Array(
        await data.arrayBuffer(),
    );
}

function pdfResponse(
    bytes: Uint8Array,
    contractId: string,
) {
    return new Response(Buffer.from(bytes), {
        status: 200,
        headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition":
                `inline; filename="contrato-hugella-${contractId}.pdf"`,
            "Cache-Control": "private, no-store, max-age=0",
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "no-referrer",
        },
    });
}

export async function GET(
    _request: Request,
    {
        params,
    }: {
        params: Promise<{ token: string }>;
    },
) {
    try {
        const { token } = await params;

        if (!uuidPattern.test(token)) {
            return jsonError(
                "El enlace del contrato no es válido.",
                400,
            );
        }

        const admin = createAdminClient();

        const {
            data: contract,
            error: contractError,
        } = await admin
            .from("contratos")
            .select(`
                id,
                estado,
                firmado_at,
                documento_snapshot,
                pdf_ruta,
                pdf_sha256
            `)
            .eq("access_token", token)
            .maybeSingle();

        if (contractError) {
            return jsonError(
                "No se pudo consultar el contrato.",
                503,
            );
        }

        if (
            !contract ||
            contract.estado !== "FIRMADO" ||
            !contract.firmado_at
        ) {
            return jsonError(
                "El contrato todavía no está disponible como PDF final.",
                404,
            );
        }

        /*
         * Si el PDF ya fue generado anteriormente,
         * devolvemos exactamente ese mismo archivo.
         */
        if (contract.pdf_ruta || contract.pdf_sha256) {
            if (
                !contract.pdf_ruta ||
                !contract.pdf_sha256
            ) {
                return jsonError(
                    "El registro del PDF final está incompleto.",
                    503,
                );
            }

            let existingPdf: Uint8Array;

            try {
                existingPdf =
                    await downloadPrivateFile(
                        admin,
                        contract.pdf_ruta,
                    );
            } catch {
                return jsonError(
                    "El PDF final no está disponible en este momento.",
                    503,
                );
            }

            /*
             * Comprobamos que el archivo almacenado siga siendo
             * exactamente el mismo que se registró originalmente.
             */
            if (
                sha256(existingPdf) !==
                contract.pdf_sha256
            ) {
                return jsonError(
                    "No se pudo verificar la integridad del PDF final.",
                    503,
                );
            }

            return pdfResponse(
                existingPdf,
                contract.id,
            );
        }

        /*
         * Un PDF nuevo siempre se construye desde el snapshot
         * congelado al momento de la firma.
         */
        if (
            !contract.documento_snapshot ||
            typeof contract.documento_snapshot !==
            "object" ||
            Array.isArray(contract.documento_snapshot)
        ) {
            return jsonError(
                "El contrato firmado no tiene un documento congelado válido.",
                503,
            );
        }

        const snapshot =
            contract.documento_snapshot as Snapshot;

        const empresaPath = snapshotString(
            snapshot,
            "firma_empresa_ruta",
        );

        const clientePath = snapshotString(
            snapshot,
            "firma_cliente_ruta",
        );

        const empresaHash = snapshotString(
            snapshot,
            "firma_empresa_sha256",
        );

        const clienteHash = snapshotString(
            snapshot,
            "firma_cliente_sha256",
        );

        if (
            !empresaPath ||
            !clientePath ||
            !empresaHash ||
            !clienteHash
        ) {
            return jsonError(
                "Falta evidencia necesaria para generar el PDF final.",
                503,
            );
        }

        let firmaEmpresa: Uint8Array;
        let firmaCliente: Uint8Array;

        try {
            [
                firmaEmpresa,
                firmaCliente,
            ] = await Promise.all([
                downloadPrivateFile(
                    admin,
                    empresaPath,
                ),
                downloadPrivateFile(
                    admin,
                    clientePath,
                ),
            ]);
        } catch {
            return jsonError(
                "No se pudieron recuperar las firmas del contrato.",
                503,
            );
        }

        /*
         * Verificamos las dos firmas antes de incorporarlas.
         * Si algún archivo cambió, no generamos el documento.
         */
        if (
            sha256(firmaEmpresa) !== empresaHash ||
            sha256(firmaCliente) !== clienteHash
        ) {
            return jsonError(
                "No se pudo verificar la integridad de las firmas.",
                503,
            );
        }

        const pdfBytes =
            await generarContratoPdf(
                snapshot,
                firmaEmpresa,
                firmaCliente,
            );

        const pdfHash = sha256(pdfBytes);

        /*
         * Cada intento usa una ruta única.
         * Si dos solicitudes llegan al mismo tiempo, solamente
         * una podrá registrar su PDF en la fila del contrato.
         */
        const pdfPath =
            `pdf-final/${contract.id}/${randomUUID()}.pdf`;

        const { error: uploadError } =
            await admin.storage
                .from("contratos-privados")
                .upload(
                    pdfPath,
                    pdfBytes,
                    {
                        contentType:
                            "application/pdf",
                        cacheControl: "0",
                        upsert: false,
                    },
                );

        if (uploadError) {
            return jsonError(
                "No se pudo guardar el PDF final.",
                503,
            );
        }

        const now = new Date().toISOString();

        const {
            data: registered,
            error: updateError,
        } = await admin
            .from("contratos")
            .update({
                pdf_ruta: pdfPath,
                pdf_sha256: pdfHash,
                updated_at: now,
            })
            .eq("id", contract.id)
            .is("pdf_ruta", null)
            .is("pdf_sha256", null)
            .select("pdf_ruta,pdf_sha256")
            .maybeSingle();

        if (updateError) {
            await admin.storage
                .from("contratos-privados")
                .remove([pdfPath]);

            return jsonError(
                "No se pudo registrar el PDF final.",
                503,
            );
        }

        /*
         * Si otra solicitud se adelantó y registró el PDF,
         * eliminamos nuestro archivo temporal y devolvemos
         * el documento que ganó la carrera.
         */
        if (!registered) {
            await admin.storage
                .from("contratos-privados")
                .remove([pdfPath]);

            const {
                data: current,
                error: currentError,
            } = await admin
                .from("contratos")
                .select("pdf_ruta,pdf_sha256")
                .eq("id", contract.id)
                .maybeSingle();

            if (
                currentError ||
                !current?.pdf_ruta ||
                !current.pdf_sha256
            ) {
                return jsonError(
                    "No se pudo confirmar el PDF final.",
                    503,
                );
            }

            let currentPdf: Uint8Array;

            try {
                currentPdf =
                    await downloadPrivateFile(
                        admin,
                        current.pdf_ruta,
                    );
            } catch {
                return jsonError(
                    "El PDF final no está disponible.",
                    503,
                );
            }

            if (
                sha256(currentPdf) !==
                current.pdf_sha256
            ) {
                return jsonError(
                    "No se pudo verificar la integridad del PDF final.",
                    503,
                );
            }

            return pdfResponse(
                currentPdf,
                contract.id,
            );
        }

        return pdfResponse(
            pdfBytes,
            contract.id,
        );
    } catch {
        return jsonError(
            "No se pudo generar el PDF final del contrato.",
            503,
        );
    }
}