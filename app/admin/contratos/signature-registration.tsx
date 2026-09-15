"use client";

import { ChangeEvent, useState } from "react";
import { useRouter } from "next/navigation";

type SignatureResponse = {
    error?: string;
    signature?: {
        path: string;
        sha256: string;
        registeredAt: string;
        registeredBy: string;
    };
};

export default function SignatureRegistration({
    isRegistered,
}: {
    isRegistered: boolean;
}) {
    const router = useRouter();
    const [file, setFile] = useState<File | null>(null);
    const [authorized, setAuthorized] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");

    function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
        setFile(event.target.files?.[0] ?? null);
        setError("");
        setSuccess("");
    }

    async function uploadSignature() {
        if (!file || !authorized || submitting) return;

        setSubmitting(true);
        setError("");
        setSuccess("");

        const formData = new FormData();
        formData.append("signature", file);

        try {
            const response = await fetch("/api/admin/firma-titular", {
                method: "POST",
                body: formData,
            });

            const result = (await response.json()) as SignatureResponse;

            if (!response.ok || !result.signature) {
                setError(
                    result.error ??
                    "No se pudo registrar la firma del titular.",
                );
                return;
            }

            setSuccess(
                `La firma se registró correctamente por ${result.signature.registeredBy}.`,
            );

            setFile(null);
            setAuthorized(false);
            router.refresh();
        } catch {
            setError(
                "No se pudo comunicar con el servidor. Intentá nuevamente.",
            );
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <section className="rounded-[var(--hugella-radius-card)] border border-[var(--hugella-border)] bg-white p-5 sm:p-7">
            <p className="section-kicker">Firma del titular</p>

            <h2 className="mt-2 text-xl font-bold">
                {isRegistered
                    ? "Firma de Facundo registrada"
                    : "Registrar firma de Facundo"}
            </h2>

            <p className="mt-2 text-sm text-[var(--hugella-navy-secondary)]">
                Esta imagen se guarda de manera privada y se incorporará a los
                contratos cuando Leonardo o Facundo los aprueben.
            </p>

            {isRegistered && (
                <p className="mt-4 rounded-[var(--hugella-radius-sm)] border border-green-200 bg-green-50 p-4 text-sm font-semibold text-green-900">
                    La firma ya está disponible. También podés reemplazarla
                    seleccionando una nueva imagen.
                </p>
            )}

            <label className="mt-5 block text-sm font-semibold">
                Imagen PNG de la firma
                <input
                    type="file"
                    accept="image/png,.png"
                    onChange={handleFileChange}
                    disabled={submitting}
                    className="mt-2 block w-full rounded-[var(--hugella-radius-sm)] border border-[var(--hugella-border)] bg-[var(--canvas)] p-3 text-sm"
                />
            </label>

            <p className="mt-2 text-xs text-[var(--hugella-navy-secondary)]">
                Debe contener únicamente la firma, con fondo blanco o transparente,
                y pesar menos de 2 MB.
            </p>

            <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-[var(--hugella-radius-sm)] border border-[var(--hugella-border)] bg-[var(--canvas)] p-4">
                <input
                    type="checkbox"
                    checked={authorized}
                    onChange={(event) => setAuthorized(event.target.checked)}
                    disabled={submitting}
                    className="mt-1 h-5 w-5 shrink-0 accent-[var(--hugella-navy)]"
                />

                <span className="text-sm font-semibold">
                    Confirmo que Facundo Daniel Ansaldi autorizó el registro y la
                    utilización de esta firma para aprobar los contratos de HUGELLA.
                </span>
            </label>

            <div aria-live="polite" className="mt-4 space-y-3">
                {error && (
                    <p className="rounded-[var(--hugella-radius-sm)] border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                        {error}
                    </p>
                )}

                {success && (
                    <p className="rounded-[var(--hugella-radius-sm)] border border-green-200 bg-green-50 p-4 text-sm text-green-900">
                        {success}
                    </p>
                )}
            </div>

            <button
                type="button"
                onClick={uploadSignature}
                disabled={!file || !authorized || submitting}
                className="mt-5 min-h-12 rounded-[var(--hugella-radius-sm)] bg-[var(--hugella-navy)] px-5 py-3 font-semibold text-white transition hover:bg-[var(--hugella-navy-deep)] disabled:cursor-not-allowed disabled:opacity-50"
            >
                {submitting
                    ? "Guardando firma…"
                    : isRegistered
                        ? "Reemplazar firma"
                        : "Registrar firma"}
            </button>
        </section>
    );
}