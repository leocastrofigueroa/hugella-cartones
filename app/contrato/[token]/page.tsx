import "server-only";

import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import ClientSignatureForm from "./client-signature-form";

export const metadata: Metadata = {
    title: "Contrato digital | HUGELLA",
    robots: { index: false, follow: false },
    referrer: "no-referrer",
};

const visibleStates = ["APROBADO", "ENVIADO", "VISTO", "FIRMADO"];
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const money = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 2 });
const decimal = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 4 });
const sectionStyle = "rounded-[var(--hugella-radius-card)] border border-[var(--hugella-border)] bg-white p-5 sm:p-7";

function amount(value: number | string | null) {
    return value == null ? "Sin informar" : money.format(Number(value));
}

function formatDate(value: string | null, withTime = false) {
    if (!value) return "Sin informar";
    const date = new Date(withTime ? value : `${value}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) return "Sin informar";
    return new Intl.DateTimeFormat("es-AR", {
        day: "2-digit", month: "2-digit", year: "numeric",
        ...(withTime ? { hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Mendoza" } as const : { timeZone: "UTC" }),
    }).format(date);
}

function Details({ items }: { items: [string, string | number | null][] }) {
    return (
        <dl className="mt-5 grid gap-5 sm:grid-cols-2">
            {items.map(([label, value]) => (
                <div key={label} className="min-w-0">
                    <dt className="text-sm text-[var(--hugella-navy-secondary)]">{label}</dt>
                    <dd className="mt-1 whitespace-pre-wrap font-semibold [overflow-wrap:anywhere]">
                        {typeof value === "string" ? value.trim() || "Sin informar" : value ?? "Sin informar"}
                    </dd>
                </div>
            ))}
        </dl>
    );
}

export default async function PublicContractPage({ params }: { params: Promise<{ token: string }> }) {
    const { token } = await params;
    if (!uuidPattern.test(token)) notFound();

    // Read the current state on each request; this page never grants write access.
    await connection();
    const adminClient = createAdminClient();
    const { data: contract, error } = await adminClient
        .from("contratos")
        .select(`
            id, estado,
            vendedor_nombre_comercial, vendedor_titular_nombre, vendedor_titular_cuit,
            vendedor_domicilio, vendedor_email,
            cliente_nombre, cliente_dni, cliente_telefono, cliente_email, cliente_rubro,
            cliente_domicilio_particular, cliente_domicilio_comercial,
            domicilio_entrega, domicilio_cobro, producto, cantidad_producto, numero_serie,
            observaciones_entrega, producto_exhibido, fecha_contrato, fecha_entrega_prevista,
            precio_contado, anticipo, monto_financiado, precio_total, cantidad_cuotas,
            importe_cuota, periodicidad, tasa_efectiva_anual, costo_financiero_total,
            gastos_administrativos, version_condiciones, condiciones_texto,
            aprobado_por, aprobado_at, firma_empresa_ruta,
            firmado_at, firma_cliente_ruta, updated_at
        `)
        .eq("access_token", token)
        .in("estado", visibleStates)
        .maybeSingle();

    if (error || !contract || !visibleStates.includes(contract.estado)) notFound();

    // Prefer the name recorded at approval time over a mutable account name.
    let approvedBy = "Sin informar";
    if (contract.aprobado_por) {
        const { data: approval, error: approvalError } = await adminClient
            .from("eventos_contrato")
            .select("detalles")
            .eq("contrato_id", contract.id)
            .eq("evento", "CONTRATO_APROBADO")
            .eq("actor_user_id", contract.aprobado_por)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
        if (approvalError) throw new Error("No se pudo consultar la aprobación del contrato.");
        const recordedName: unknown = approval?.detalles?.aprobado_por_nombre;
        if (typeof recordedName === "string" && recordedName.trim()) {
            approvedBy = recordedName;
        } else {
            const { data: approver, error: approverError } = await adminClient
                .from("autorizados_contratos")
                .select("nombre")
                .eq("user_id", contract.aprobado_por)
                .maybeSingle();
            if (approverError) throw new Error("No se pudo consultar la aprobación del contrato.");
            approvedBy = approver?.nombre || "Sin informar";
        }
    }

    let signatureUrl: string | null = null;
    if (contract.firma_empresa_ruta) {
        const { data: signature, error: signatureError } = await adminClient.storage
            .from("contratos-privados")
            .createSignedUrl(contract.firma_empresa_ruta, 5 * 60);
        if (!signatureError) signatureUrl = signature?.signedUrl ?? null;
    }

    let clientSignatureUrl: string | null = null;
    if (contract.estado === "FIRMADO" && contract.firma_cliente_ruta) {
        const { data: signature, error: signatureError } = await adminClient.storage
            .from("contratos-privados")
            .createSignedUrl(contract.firma_cliente_ruta, 5 * 60);
        if (!signatureError) clientSignatureUrl = signature?.signedUrl ?? null;
    }

    return (
        <main className="min-h-screen bg-[var(--canvas)] text-[var(--ink)]">
            <header className="bg-[var(--hugella-navy-deep)] text-white">
                <div className="mx-auto max-w-6xl px-5 py-4 sm:px-8">
                    <Image src="/hugella-logo.png" alt="HUGELLA Equipamiento Comercial" width={2172} height={724} priority className="h-auto w-[clamp(9rem,45vw,13.75rem)] object-contain" />
                </div>
            </header>
            <div className="mx-auto max-w-5xl space-y-6 px-5 py-6 sm:px-8 sm:py-8">
                <section className={sectionStyle}>
                    <p className="section-kicker">Contrato digital</p>
                    <h1 className="mt-2 text-2xl font-bold sm:text-3xl">Tu contrato HUGELLA</h1>
                    <p className="mt-3 leading-relaxed text-[var(--hugella-navy-secondary)]">Este documento contiene los datos de tu operación y las condiciones contractuales. Leé su contenido completo antes de continuar.</p>
                    <Details items={[["Estado", contract.estado], ["Fecha del contrato", formatDate(contract.fecha_contrato)]]} />
                </section>
                <section className={sectionStyle}>
                    <h2 className="text-xl font-bold">Vendedor</h2>
                    <Details items={[
                        ["Nombre comercial", contract.vendedor_nombre_comercial],
                        ["Titular", contract.vendedor_titular_nombre], ["CUIT", contract.vendedor_titular_cuit],
                        ["Domicilio legal", contract.vendedor_domicilio], ["Correo electrónico", contract.vendedor_email],
                    ]} />
                </section>
                <section className={sectionStyle}>
                    <h2 className="text-xl font-bold">Cliente</h2>
                    <Details items={[
                        ["Nombre", contract.cliente_nombre], ["DNI", contract.cliente_dni],
                        ["Teléfono", contract.cliente_telefono], ["Correo electrónico", contract.cliente_email],
                        ["Rubro", contract.cliente_rubro], ["Domicilio particular", contract.cliente_domicilio_particular],
                        ["Domicilio comercial", contract.cliente_domicilio_comercial],
                    ]} />
                </section>
                <section className={sectionStyle}>
                    <h2 className="text-xl font-bold">Producto y entrega</h2>
                    <Details items={[
                        ["Producto", contract.producto], ["Cantidad", contract.cantidad_producto],
                        ["Número de serie", contract.numero_serie],
                        ["Producto exhibido", contract.producto_exhibido == null ? null : contract.producto_exhibido ? "Sí" : "No"],
                        ["Entrega prevista", formatDate(contract.fecha_entrega_prevista)],
                        ["Domicilio de entrega", contract.domicilio_entrega], ["Domicilio de cobro", contract.domicilio_cobro],
                        ["Observaciones de entrega", contract.observaciones_entrega],
                    ]} />
                </section>
                <section className={sectionStyle}>
                    <h2 className="text-xl font-bold">Precio y financiación</h2>
                    <Details items={[
                        ["Precio de contado", amount(contract.precio_contado)], ["Anticipo", amount(contract.anticipo)],
                        ["Monto financiado", amount(contract.monto_financiado)],
                        ["Total financiado (suma de cuotas)", amount(Number(contract.cantidad_cuotas) * Number(contract.importe_cuota))],
                        ["Precio total", amount(contract.precio_total)], ["Cantidad de cuotas", contract.cantidad_cuotas],
                        ["Periodicidad", contract.periodicidad], ["Importe de cada cuota", amount(contract.importe_cuota)],
                        ["Gastos administrativos", amount(contract.gastos_administrativos)],
                        ...(contract.tasa_efectiva_anual != null ? [["Tasa efectiva anual (TEA)", `${decimal.format(Number(contract.tasa_efectiva_anual))} %`] as [string, string]] : []),
                        ...(contract.costo_financiero_total != null ? [["Costo financiero total (CFT)", `${decimal.format(Number(contract.costo_financiero_total))} %`] as [string, string]] : []),
                    ]} />
                </section>
                <section className={sectionStyle}>
                    <h2 className="text-xl font-bold">Condiciones contractuales</h2>
                    <p className="mt-2 text-sm text-[var(--hugella-navy-secondary)]">Versión: {contract.version_condiciones}</p>
                    <div className="mt-5 whitespace-pre-wrap rounded-[var(--hugella-radius-sm)] border border-[var(--hugella-border)] bg-[var(--canvas)] p-4 text-sm leading-7 [overflow-wrap:anywhere] sm:p-5">{contract.condiciones_texto}</div>
                </section>
                <section className={sectionStyle}>
                    <h2 className="text-xl font-bold">Firma empresarial</h2>
                    <Details items={[
                        ["Titular", contract.vendedor_titular_nombre], ["CUIT", contract.vendedor_titular_cuit],
                        ["Fecha de aprobación", formatDate(contract.aprobado_at, true)], ["Aprobado por", approvedBy],
                    ]} />
                    {signatureUrl ? (
                        <Image src={signatureUrl} alt={`Firma empresarial de ${contract.vendedor_titular_nombre}`} width={480} height={240} unoptimized className="mt-6 h-auto max-h-48 w-full max-w-sm object-contain object-left" />
                    ) : (
                        <p className="mt-5 text-sm text-[var(--hugella-navy-secondary)]">{contract.firma_empresa_ruta ? "No se pudo cargar la imagen de la firma empresarial. Volvé a cargar la página para intentarlo nuevamente." : "Imagen de la firma empresarial no disponible."}</p>
                    )}
                </section>
                {contract.estado === "FIRMADO" ? (
                    <section className={sectionStyle}>
                        <h2 className="text-xl font-bold text-green-800">
                            Contrato firmado correctamente
                        </h2>

                        <Details
                            items={[
                                ["Cliente", contract.cliente_nombre],
                                [
                                    "Fecha y hora de firma",
                                    formatDate(contract.firmado_at, true),
                                ],
                            ]}
                        />

                        {clientSignatureUrl ? (
                            <Image
                                src={clientSignatureUrl}
                                alt="Firma del cliente"
                                width={1000}
                                height={360}
                                unoptimized
                                className="mt-6 h-auto max-h-48 w-full max-w-md object-contain object-left"
                            />
                        ) : (
                            <p className="mt-5 text-sm text-[var(--hugella-navy-secondary)]">
                                La imagen de la firma no está disponible en este momento.
                                Volvé a cargar la página para consultarla.
                            </p>
                        )}

                        <a
                            href={`/api/contratos/${token}/pdf`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-7 inline-flex min-h-11 items-center justify-center rounded-[var(--hugella-radius-sm)] bg-[var(--hugella-gold)] px-5 py-3 font-semibold text-[var(--hugella-navy-deep)] transition hover:opacity-90"
                        >
                            Ver contrato firmado en PDF
                        </a>
                    </section>
                ) : ["APROBADO", "ENVIADO", "VISTO"].includes(contract.estado) && !contract.firmado_at ? (
                    <ClientSignatureForm token={token} revision={contract.updated_at} />
                ) : null}
            </div>
        </main>
    );
}
