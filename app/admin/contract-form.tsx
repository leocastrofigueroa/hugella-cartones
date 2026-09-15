"use client";

import { FormEvent, useState } from "react";
import { focusStyle, money, type Credit } from "./admin-types";

type CreateContractResponse = {
    error?: string;
    contract?: {
        id: string;
        token: string;
    };
};

const fieldStyle =
    "mt-2 min-h-11 w-full rounded-[var(--hugella-radius-sm)] border border-[var(--hugella-border)] bg-white px-3 py-2 text-base text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-60";

export default function ContractForm({ credit }: { credit: Credit }) {
    const [precioContado, setPrecioContado] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");
    const [contractUrl, setContractUrl] = useState("");

    const totalFinanciado =
        Number(credit.importe_cuota) * credit.cantidad_cuotas;

    const diferencia =
        precioContado && Number(precioContado) > 0
            ? totalFinanciado - Number(precioContado)
            : null;

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();

        if (submitting) return;

        setSubmitting(true);
        setError("");
        setSuccess("");
        setContractUrl("");

        const formData = new FormData(event.currentTarget);
        const input = Object.fromEntries(formData.entries());

        try {
            const response = await fetch("/api/admin/contratos", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    ...input,
                    creditId: credit.credito_id,
                }),
            });

            const result = (await response.json()) as CreateContractResponse;

            if (!response.ok || !result.contract) {
                setError(
                    result.error ??
                    "No se pudo crear el borrador del contrato.",
                );
                return;
            }

            
            const url = `${window.location.origin}/admin/contratos/${result.contract.id}`;

            setContractUrl(url);
            setSuccess(
                "El borrador se creó correctamente. Todavía no fue enviado al cliente.",
            );
        } catch {
            setError(
                "No se pudo comunicar con el servidor. Intentá nuevamente.",
            );
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <section
            aria-labelledby="contract-form-title"
            className="min-w-0 rounded-[var(--hugella-radius-card)] border border-[var(--hugella-border)] bg-white p-5 sm:p-7 xl:col-span-2"
        >
            <p className="section-kicker">Contrato digital</p>

            <h2
                id="contract-form-title"
                className="mt-2 text-2xl font-bold"
            >
                Preparar contrato
            </h2>

            <p className="mt-2 text-sm text-[var(--hugella-navy-secondary)]">
                Completá los datos que no están guardados en el crédito. Primero
                se creará un borrador para revisar; no se enviará automáticamente.
            </p>

            <div className="mt-5 grid gap-3 rounded-[var(--hugella-radius-sm)] bg-[var(--canvas)] p-4 sm:grid-cols-3">
                <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-[var(--hugella-navy-secondary)]">
                        Producto
                    </p>
                    <p className="mt-1 font-semibold [overflow-wrap:anywhere]">
                        {credit.producto}
                    </p>
                </div>

                <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-[var(--hugella-navy-secondary)]">
                        Cuotas
                    </p>
                    <p className="mt-1 font-semibold">
                        {credit.cantidad_cuotas} de{" "}
                        {money.format(Number(credit.importe_cuota))}
                    </p>
                </div>

                <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-[var(--hugella-navy-secondary)]">
                        Total financiado
                    </p>
                    <p className="mt-1 font-semibold">
                        {money.format(totalFinanciado)}
                    </p>
                </div>
            </div>

            <form onSubmit={handleSubmit} className="mt-6 space-y-6">
                <div className="grid gap-5 md:grid-cols-2">
                    <label className="text-sm font-semibold">
                        Fecha prevista de entrega
                        <input
                            className={`${fieldStyle} ${focusStyle}`}
                            type="date"
                            name="fechaEntregaPrevista"
                            required
                            disabled={submitting}
                        />
                    </label>

                    <label className="text-sm font-semibold">
                        Precio de contado de referencia
                        <input
                            className={`${fieldStyle} ${focusStyle}`}
                            type="number"
                            name="precioContado"
                            min="0.01"
                            step="0.01"
                            required
                            value={precioContado}
                            onChange={(event) => setPrecioContado(event.target.value)}
                            disabled={submitting}
                        />
                    </label>

                    <label className="text-sm font-semibold">
                        Anticipo
                        <input
                            className={`${fieldStyle} ${focusStyle}`}
                            type="number"
                            name="anticipo"
                            min="0"
                            step="0.01"
                            defaultValue="0"
                            disabled={submitting}
                        />
                    </label>

                    <label className="text-sm font-semibold">
                        Gastos administrativos informados
                        <input
                            className={`${fieldStyle} ${focusStyle}`}
                            type="number"
                            name="gastosAdministrativos"
                            min="0"
                            step="0.01"
                            defaultValue="0"
                            disabled={submitting}
                        />
                    </label>

                    <label className="text-sm font-semibold">
                        Rubro del comercio
                        <input
                            className={`${fieldStyle} ${focusStyle}`}
                            type="text"
                            name="clienteRubro"
                            maxLength={120}
                            disabled={submitting}
                        />
                    </label>

                    <label className="text-sm font-semibold">
                        Correo electrónico del cliente
                        <input
                            className={`${fieldStyle} ${focusStyle}`}
                            type="email"
                            name="clienteEmail"
                            maxLength={254}
                            disabled={submitting}
                        />
                    </label>

                    <label className="text-sm font-semibold">
                        Domicilio comercial
                        <input
                            className={`${fieldStyle} ${focusStyle}`}
                            type="text"
                            name="domicilioComercial"
                            maxLength={300}
                            disabled={submitting}
                        />
                    </label>

                    <label className="text-sm font-semibold">
                        Domicilio de entrega
                        <input
                            className={`${fieldStyle} ${focusStyle}`}
                            type="text"
                            name="domicilioEntrega"
                            maxLength={300}
                            required
                            disabled={submitting}
                        />
                    </label>

                    <label className="text-sm font-semibold">
                        Domicilio de cobro
                        <input
                            className={`${fieldStyle} ${focusStyle}`}
                            type="text"
                            name="domicilioCobro"
                            maxLength={300}
                            disabled={submitting}
                        />
                    </label>

                    <label className="text-sm font-semibold">
                        Cantidad de productos
                        <input
                            className={`${fieldStyle} ${focusStyle}`}
                            type="number"
                            name="cantidadProducto"
                            min="1"
                            step="1"
                            defaultValue="1"
                            required
                            disabled={submitting}
                        />
                    </label>

                    <label className="text-sm font-semibold">
                        Número de serie
                        <input
                            className={`${fieldStyle} ${focusStyle}`}
                            type="text"
                            name="numeroSerie"
                            maxLength={200}
                            disabled={submitting}
                        />
                    </label>

                    <label className="text-sm font-semibold">
                        ¿Se exhibió el producto?
                        <select
                            className={`${fieldStyle} ${focusStyle}`}
                            name="productoExhibido"
                            defaultValue=""
                            disabled={submitting}
                        >
                            <option value="">Sin informar</option>
                            <option value="true">Sí</option>
                            <option value="false">No</option>
                        </select>
                    </label>
                </div>

                <label className="block text-sm font-semibold">
                    Observaciones de entrega
                    <textarea
                        className={`${fieldStyle} min-h-28 resize-y ${focusStyle}`}
                        name="observacionesEntrega"
                        maxLength={1500}
                        disabled={submitting}
                    />
                </label>

                {diferencia !== null && (
                    <div className="rounded-[var(--hugella-radius-sm)] border border-[var(--hugella-gold)] bg-[var(--hugella-gold)]/10 p-4 text-sm">
                        <p>
                            Diferencia entre el precio de contado y el total financiado:{" "}
                            <strong>{money.format(diferencia)}</strong>
                        </p>
                    </div>
                )}

                <div aria-live="polite" className="space-y-3">
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

                    {contractUrl && (
                        <p className="text-sm [overflow-wrap:anywhere]">
                            Revisar borrador:{" "}
                            <a
                                href={contractUrl}
                                className={`font-semibold underline ${focusStyle}`}
                                target="_blank"
                                rel="noreferrer"
                            >
                                {contractUrl}
                            </a>
                        </p>
                    )}
                </div>

                <button
                    type="submit"
                    disabled={submitting}
                    className={`min-h-12 rounded-[var(--hugella-radius-sm)] bg-[var(--hugella-navy)] px-5 py-3 font-semibold text-white transition hover:bg-[var(--hugella-navy-deep)] disabled:cursor-not-allowed disabled:opacity-60 ${focusStyle}`}
                >
                    {submitting ? "Creando borrador…" : "Crear borrador de contrato"}
                </button>
            </form>
        </section>
    );
}