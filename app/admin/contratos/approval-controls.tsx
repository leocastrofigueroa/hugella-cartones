"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type ApprovalResponse = {
    error?: string;
    contract?: {
        id: string;
        estado: string;
        publicUrl: string;
    };
};

export default function ApprovalControls({
    contractId,
    state,
    canApprove,
}: {
    contractId: string;
    state: string;
    canApprove: boolean;
}) {
    const router = useRouter();
    const [confirmed, setConfirmed] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");

    if (state !== "BORRADOR") {
        return (
            <section className="rounded-[var(--hugella-radius-card)] border border-green-200 bg-green-50 p-5 sm:p-7">
                <h2 className="text-lg font-bold text-green-950">
                    Contrato {state.toLowerCase()}
                </h2>

                <p className="mt-2 text-sm text-green-950">
                    Este contrato ya salió de la etapa de borrador.
                </p>
            </section>
        );
    }

    if (!canApprove) {
        return (
            <section className="rounded-[var(--hugella-radius-card)] border border-amber-300 bg-amber-50 p-5 sm:p-7">
                <h2 className="text-lg font-bold text-amber-950">
                    Aprobación pendiente
                </h2>

                <p className="mt-2 text-sm text-amber-950">
                    Tu cuenta puede revisar este contrato, pero no está autorizada para
                    aprobarlo.
                </p>
            </section>
        );
    }

    async function approveContract() {
        if (!confirmed || submitting) return;

        setSubmitting(true);
        setError("");
        setSuccess("");

        try {
            const response = await fetch(
                `/api/admin/contratos/${contractId}/aprobar`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                },
            );

            const result = (await response.json()) as ApprovalResponse;

            if (!response.ok || !result.contract) {
                setError(
                    result.error ?? "No se pudo aprobar el contrato.",
                );
                return;
            }

            setSuccess(
                "El contrato fue aprobado. El enlace para WhatsApp ya está habilitado.",
            );

            setConfirmed(false);
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
        <section className="rounded-[var(--hugella-radius-card)] border border-[var(--hugella-gold)] bg-white p-5 sm:p-7">
            <p className="section-kicker">Confirmación administrativa</p>

            <h2 className="mt-2 text-xl font-bold">
                Aprobar contrato
            </h2>

            <p className="mt-2 text-sm text-[var(--hugella-navy-secondary)]">
                Al aprobarlo, quedarán registrados tu usuario, la fecha, la hora, el
                dispositivo y la firma guardada de Facundo.
            </p>

            <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-[var(--hugella-radius-sm)] border border-[var(--hugella-border)] bg-[var(--canvas)] p-4">
                <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(event) => setConfirmed(event.target.checked)}
                    disabled={submitting}
                    className="mt-1 h-5 w-5 shrink-0 accent-[var(--hugella-navy)]"
                />

                <span className="text-sm font-semibold">
                    Confirmo que revisé los datos, precios y condiciones de este
                    contrato y autorizo su envío al cliente.
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
                onClick={approveContract}
                disabled={!confirmed || submitting}
                className="mt-5 min-h-12 rounded-[var(--hugella-radius-sm)] bg-[var(--hugella-navy)] px-5 py-3 font-semibold text-white transition hover:bg-[var(--hugella-navy-deep)] disabled:cursor-not-allowed disabled:opacity-50"
            >
                {submitting
                    ? "Aprobando contrato…"
                    : "Aprobar y habilitar enlace"}
            </button>
        </section>
    );
}