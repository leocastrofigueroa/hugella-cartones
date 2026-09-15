import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { createAdminClient } from "@/utils/supabase/admin";

export const runtime = "nodejs";

const acceptanceText = "Declaro que leí el contrato completo, acepto todas sus condiciones y reconozco los precios y el plan de cuotas detallados. Autorizo el registro de la fecha, hora, dirección IP y datos de mi dispositivo como evidencia de mi aceptación y firma.";
const signableStates = ["APROBADO", "ENVIADO", "VISTO"];
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const maxSignatureSize = 1024 * 1024;
const maxBodySize = maxSignatureSize + 16 * 1024;

function json(body: Record<string, unknown>, status = 200) {
    return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function normalizeName(value: string) {
    return value
        .normalize("NFD")
        .replace(/\p{M}/gu, "")
        .toLocaleLowerCase("es-AR")
        .trim()
        .replace(/\s+/g, " ")
        .split(" ")
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, "es"))
        .join(" ");
}


function normalizeDni(value: string) {
    return value.replace(/[.\s]/g, "");
}

// Cap the actual stream, including requests without Content-Length.
async function readForm(request: Request) {
    const reader = request.body?.getReader();
    if (!reader) throw new Error("INVALID_BODY");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > maxBodySize) {
                await reader.cancel();
                throw new Error("BODY_TOO_LARGE");
            }
            chunks.push(value);
        }
    } finally {
        reader.releaseLock();
    }
    return new Response(Buffer.concat(chunks), { headers: { "Content-Type": request.headers.get("content-type") ?? "" } }).formData();
}

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
    try {
        const origin = request.headers.get("origin");
        const site = request.headers.get("sec-fetch-site");
        if (origin !== new URL(request.url).origin || (site !== null && site !== "same-origin")) {
            return json({ error: "Solicitud no permitida. Abrí el contrato desde esta aplicación." }, 403);
        }
        const { token } = await params;
        if (!uuidPattern.test(token)) return json({ error: "El enlace del contrato no es válido." }, 400);
        if (!request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data;")) {
            return json({ error: "El envío debe incluir los datos y la firma PNG." }, 415);
        }
        let form: FormData;
        try {
            form = await readForm(request);
        } catch (cause) {
            return json({ error: cause instanceof Error && cause.message === "BODY_TOO_LARGE" ? "La firma no puede superar 1 MB." : "No se pudo leer el formulario enviado." }, cause instanceof Error && cause.message === "BODY_TOO_LARGE" ? 413 : 400);
        }
        const nameEntry = form.get("nombre");
        const dniEntry = form.get("dni");
        const name = typeof nameEntry === "string" ? nameEntry.trim().replace(/\s+/g, " ") : "";
        const dni = typeof dniEntry === "string" ? normalizeDni(dniEntry) : "";
        if (name.length < 2 || name.length > 150 || /[\u0000-\u001f\u007f]/.test(name)) return json({ error: "Ingresá tu nombre completo, entre 2 y 150 caracteres." }, 400);
        if (!/^\d{7,9}$/.test(dni)) return json({ error: "Ingresá un DNI de 7 a 9 dígitos; podés incluir puntos y espacios." }, 400);
        if (form.get("aceptacion") !== "true" || form.get("texto_aceptacion") !== acceptanceText) return json({ error: "Debés aceptar expresamente las condiciones del contrato." }, 400);
        const signature = form.get("signature");
        if (!(signature instanceof File) || signature.size === 0) return json({ error: "Adjuntá tu firma en formato PNG." }, 400);
        if (signature.size > maxSignatureSize) return json({ error: "La firma no puede superar 1 MB." }, 413);
        if (signature.type !== "image/png") return json({ error: "La firma debe ser una imagen PNG." }, 415);
        const bytes = Buffer.from(await signature.arrayBuffer());
        const magic = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
        if (bytes.length < 45 || !bytes.subarray(0, 8).equals(magic)
            || bytes.readUInt32BE(8) !== 13 || bytes.toString("ascii", 12, 16) !== "IHDR"
            || bytes.readUInt32BE(16) === 0 || bytes.readUInt32BE(20) === 0
            || bytes.readUInt32BE(16) > 4096 || bytes.readUInt32BE(20) > 4096
            || !bytes.subarray(-12).equals(Buffer.from([0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]))) {
            return json({ error: "El archivo no es una firma PNG válida." }, 415);
        }

        const admin = createAdminClient();
        const { data: contract, error: queryError } = await admin.from("contratos")
            .select("id,estado,cliente_nombre,cliente_dni,firmado_at,updated_at")
            .eq("access_token", token).maybeSingle();
        if (queryError) return json({ error: "No se pudo consultar el contrato. Intentá nuevamente." }, 503);
        if (!contract || ![...signableStates, "FIRMADO"].includes(contract.estado)) return json({ error: "El contrato no está disponible para firmar." }, 404);
        if (!signableStates.includes(contract.estado) || contract.firmado_at) return json({ error: "Este contrato ya fue firmado y no puede volver a firmarse." }, 409);
        if (form.get("revision") !== contract.updated_at) return json({ error: "El contrato cambió. Volvé a cargar la página y revisalo antes de firmar." }, 409);
        if (normalizeName(name) !== normalizeName(contract.cliente_nombre)) return json({ error: "El nombre ingresado no coincide con el del contrato. Revisá los datos e intentá nuevamente." }, 400);
        if (contract.cliente_dni && normalizeDni(contract.cliente_dni) !== dni) return json({ error: "El DNI ingresado no coincide con el del contrato. Revisá los datos e intentá nuevamente." }, 400);

        const candidateIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip")?.trim() || "";
        const ip = isIP(candidateIp) ? candidateIp : null;
        const userAgent = request.headers.get("user-agent")?.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 512) || null;
        const hash = createHash("sha256").update(bytes).digest("hex");
        const path = `firmas-cliente/${contract.id}/${randomUUID()}.png`;
        const bucket = admin.storage.from("contratos-privados");
        const removeUpload = async () => {
            for (let attempt = 0; attempt < 2; attempt++) {
                try {
                    const { error } = await bucket.remove([path]);
                    if (!error) return true;
                } catch { /* Retry only this request's private object. */ }
            }
            return false;
        };
        const { error: uploadError } = await bucket.upload(path, bytes, { contentType: "image/png", cacheControl: "0", upsert: false });
        if (uploadError) {
            await removeUpload();
            return json({ error: "No se pudo guardar la firma. Intentá nuevamente." }, 503);
        }

        // The RPC locks the row and commits the signature and audit together.
        // Retrying with this unique path is idempotent if the response was lost.
        const argumentsForSignature = {
            p_id: contract.id, p_token: token, p_revision: contract.updated_at,
            p_nombre: name, p_dni: dni, p_texto_aceptacion: acceptanceText,
            p_ruta: path, p_sha256: hash, p_ip: ip, p_user_agent: userAgent,
        };
        for (let attempt = 0; attempt < 2; attempt++) {
            const { data: result, error: signingError } = await admin.rpc("firmar_contrato_cliente", argumentsForSignature);
            if (!signingError && result?.ok === true) return json({ ok: true, message: "Contrato firmado correctamente", firmado_at: result.firmado_at });
            if ((!signingError && result?.ok === false) || (signingError && /^(?:[0-9A-Z]{5}|PGRST20[2345]|PGRST30[12])$/.test(signingError.code))) {
                if (attempt > 0) {
                    // A failure on retry cannot prove the first attempt did not
                    // commit. Preserve its image until the outcome is known.
                    return json({ error: "No pudimos confirmar el resultado. Volvé a cargar el contrato antes de reintentar." }, 503);
                }
                // A returned SQL error means PostgreSQL rolled back the transaction.
                const removed = await removeUpload();
                return json({
                    error: removed
                        ? (!signingError ? "El contrato cambió o ya fue firmado. Volvé a cargar la página." : "No se pudo registrar la firma y su auditoría. Intentá nuevamente.")
                        : "La firma no se registró, pero no se pudo retirar el archivo temporal. Contactá a HUGELLA antes de reintentar."
                }, !signingError ? 409 : 503);
            }
        }
        // A transport failure is ambiguous: never delete an image that a committed
        // transaction may reference. Refresh lets the client see the durable result.
        return json({ error: "No pudimos confirmar el resultado. Volvé a cargar el contrato para comprobar si se registró la firma antes de reintentar." }, 503);
    } catch {
        // Never log request data, tokens, raw database errors or signature bytes.
        return json({ error: "No se pudo confirmar la operación. Volvé a cargar el contrato antes de reintentar." }, 503);
    }
}
