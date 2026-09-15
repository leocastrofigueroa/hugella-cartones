import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createAdminClient } from "@/utils/supabase/admin";
import { createClient as createSessionClient } from "@/utils/supabase/server";
import ApprovalControls from "../approval-controls";
import SignatureRegistration from "../signature-registration";

const money = new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 2,
});

function formatDate(value: string | null) {
    if (!value) return "Sin informar";

    return new Intl.DateTimeFormat("es-AR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        timeZone: "UTC",
    }).format(new Date(`${value}T00:00:00Z`));
}

function valueOrNotReported(value: string | null) {
    return value?.trim() || "Sin informar";
}

function productExhibition(value: boolean | null) {
    if (value === true) return "Sí";
    if (value === false) return "No";
    return "Sin informar";
}

function isUuid(value: string) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value,
    );
}

export default async function AdminContractPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = await params;

    if (!isUuid(id)) {
        notFound();
    }

    const sessionClient = await createSessionClient();
    const { data: claimsData } = await sessionClient.auth.getClaims();
    const userId = claimsData?.claims?.sub;

    if (!userId) {
        redirect("/admin/login");
    }

    const adminClient = createAdminClient();

    const { data: authorization } = await adminClient
        .from("autorizados_contratos")
        .select("user_id,nombre,puede_preparar,puede_aprobar,activo")
        .eq("user_id", userId)
        .eq("activo", true)
        .maybeSingle();

    if (!authorization) {
        redirect("/admin");
    }

    const { data: contract, error } = await adminClient
        .from("contratos")
        .select(`
      id,
      access_token,
      estado,
      vendedor_nombre_comercial,
      vendedor_titular_nombre,
      vendedor_titular_cuit,
      vendedor_domicilio,
      vendedor_email,
      cliente_nombre,
      cliente_dni,
      cliente_telefono,
      cliente_email,
      cliente_rubro,
      cliente_domicilio_particular,
      cliente_domicilio_comercial,
      domicilio_entrega,
      domicilio_cobro,
      producto,
      cantidad_producto,
      numero_serie,
      observaciones_entrega,
      producto_exhibido,
      fecha_contrato,
      fecha_entrega_prevista,
      precio_contado,
      anticipo,
      monto_financiado,
      precio_total,
      cantidad_cuotas,
      importe_cuota,
      periodicidad,
      tasa_efectiva_anual,
      costo_financiero_total,
      gastos_administrativos,
      version_condiciones,
      condiciones_texto,
      aprobado_at,
      enviado_at,
      visto_at,
      firmado_at,
      created_at
    `)
        .eq("id", id)
        .maybeSingle();

    if (error) {
        console.error("Error consultando contrato:", error);
        throw new Error("No se pudo consultar el contrato.");
    }

    if (!contract) {
        notFound();
    }
    const { data: signatureConfiguration, error: signatureError } =
        await adminClient
            .from("configuracion_contratos")
            .select("firma_titular_ruta,firma_titular_sha256")
            .eq("id", 1)
            .maybeSingle();

    if (signatureError) {
        console.error(
            "Error consultando firma registrada:",
            signatureError,
        );

        throw new Error("No se pudo consultar la firma registrada.");
    }

    const isSignatureRegistered = Boolean(
        signatureConfiguration?.firma_titular_ruta &&
        signatureConfiguration.firma_titular_sha256,
    );

    const totalCuotas =
        Number(contract.cantidad_cuotas) * Number(contract.importe_cuota);

    const publicUrl =
        contract.estado === "APROBADO" ||
            contract.estado === "ENVIADO" ||
            contract.estado === "VISTO" ||
            contract.estado === "FIRMADO"
            ? `/contrato/${contract.access_token}`
            : null;

    return (
        <main className="min-h-screen bg-[var(--canvas)] text-[var(--ink)]">
            <header className="bg-[var(--hugella-navy-deep)] text-white">
                <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
                    <Image
                        src="/hugella-logo.png"
                        alt="HUGELLA Equipamiento Comercial"
                        width={2172}
                        height={724}
                        priority
                        className="h-auto w-[clamp(9rem,45vw,13.75rem)] object-contain"
                    />

                    <Link
                        href="/admin"
                        className="rounded-[var(--hugella-radius-sm)] border border-[var(--hugella-gold)]/60 px-4 py-2 text-sm font-semibold text-[var(--hugella-gold-light)]"
                    >
                        Volver al panel
                    </Link>
                </div>
            </header>

            <div className="mx-auto max-w-5xl space-y-6 px-5 py-6 sm:px-8 sm:py-8">
                <section className="rounded-[var(--hugella-radius-card)] border border-[var(--hugella-border)] bg-white p-5 sm:p-7">
                    <p className="section-kicker">Revisión administrativa</p>

                    <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                        <h1 className="text-2xl font-bold sm:text-3xl">
                            Contrato de {contract.cliente_nombre}
                        </h1>

                        <span className="rounded-full bg-[var(--hugella-gold)]/15 px-4 py-2 text-sm font-bold text-[var(--hugella-navy)]">
                            {contract.estado}
                        </span>
                    </div>

                    <p className="mt-3 text-sm text-[var(--hugella-navy-secondary)]">
                        Revisá cuidadosamente todos los datos antes de aprobarlo. Mientras
                        permanezca como borrador, el cliente no podrá acceder al contrato.
                    </p>

                    {publicUrl ? (
                        <p className="mt-5 rounded-[var(--hugella-radius-sm)] border border-green-200 bg-green-50 p-4 text-sm [overflow-wrap:anywhere]">
                            Enlace para el cliente:{" "}
                            <Link
                                href={publicUrl}
                                target="_blank"
                                className="font-semibold underline"
                            >
                                {publicUrl}
                            </Link>
                        </p>
                    ) : (
                        <p className="mt-5 rounded-[var(--hugella-radius-sm)] border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
                            Este contrato todavía no está aprobado y no debe enviarse al
                            cliente.
                        </p>
                    )}
                </section>

                <section className="rounded-[var(--hugella-radius-card)] border border-[var(--hugella-border)] bg-white p-5 sm:p-7">
                    <h2 className="text-xl font-bold">Vendedor</h2>

                    <dl className="mt-5 grid gap-5 sm:grid-cols-2">
                        <div>
                            <dt className="text-sm text-[var(--hugella-navy-secondary)]">
                                Nombre comercial
                            </dt>
                            <dd className="mt-1 font-semibold">
                                {contract.vendedor_nombre_comercial}
                            </dd>
                        </div>

                        <div>
                            <dt className="text-sm text-[var(--hugella-navy-secondary)]">
                                Titular
                            </dt>
                            <dd className="mt-1 font-semibold">
                                {contract.vendedor_titular_nombre}
                            </dd>
                        </div>

                        <div>
                            <dt className="text-sm text-[var(--hugella-navy-secondary)]">
                                CUIT
                            </dt>
                            <dd className="mt-1 font-semibold">
                                {contract.vendedor_titular_cuit}
                            </dd>
                        </div>

                        <div>
                            <dt className="text-sm text-[var(--hugella-navy-secondary)]">
                                Correo electrónico
                            </dt>
                            <dd className="mt-1 font-semibold [overflow-wrap:anywhere]">
                                {contract.vendedor_email}
                            </dd>
                        </div>

                        <div className="sm:col-span-2">
                            <dt className="text-sm text-[var(--hugella-navy-secondary)]">
                                Domicilio legal
                            </dt>
                            <dd className="mt-1 font-semibold">
                                {contract.vendedor_domicilio}
                            </dd>
                        </div>
                    </dl>
                </section>

                <section className="rounded-[var(--hugella-radius-card)] border border-[var(--hugella-border)] bg-white p-5 sm:p-7">
                    <h2 className="text-xl font-bold">Cliente</h2>

                    <dl className="mt-5 grid gap-5 sm:grid-cols-2">
                        <div>
                            <dt className="text-sm text-[var(--hugella-navy-secondary)]">
                                Nombre
                            </dt>
                            <dd className="mt-1 font-semibold">
                                {contract.cliente_nombre}
                            </dd>
                        </div>

                        <div>
                            <dt className="text-sm text-[var(--hugella-navy-secondary)]">
                                DNI
                            </dt>
                            <dd className="mt-1 font-semibold">
                                {valueOrNotReported(contract.cliente_dni)}
                            </dd>
                        </div>

                        <div>
                            <dt className="text-sm text-[var(--hugella-navy-secondary)]">
                                Teléfono
                            </dt>
                            <dd className="mt-1 font-semibold">
                                {valueOrNotReported(contract.cliente_telefono)}
                            </dd>
                        </div>

                        <div>
                            <dt className="text-sm text-[var(--hugella-navy-secondary)]">
                                Correo electrónico
                            </dt>
                            <dd className="mt-1 font-semibold [overflow-wrap:anywhere]">
                                {valueOrNotReported(contract.cliente_email)}
                            </dd>
                        </div>

                        <div>
                            <dt className="text-sm text-[var(--hugella-navy-secondary)]">
                                Rubro
                            </dt>
                            <dd className="mt-1 font-semibold">
                                {valueOrNotReported(contract.cliente_rubro)}
                            </dd>
                        </div>

                        <div>
                            <dt className="text-sm text-[var(--hugella-navy-secondary)]">
                                Domicilio particular
                            </dt>
                            <dd className="mt-1 font-semibold">
                                {valueOrNotReported(
                                    contract.cliente_domicilio_particular,
                                )}
                            </dd>
                        </div>

                        <div>
                            <dt className="text-sm text-[var(--hugella-navy-secondary)]">
                                Domicilio comercial
                            </dt>
                            <dd className="mt-1 font-semibold">
                                {valueOrNotReported(
                                    contract.cliente_domicilio_comercial,
                                )}
                            </dd>
                        </div>

                        <div>
                            <dt className="text-sm text-[var(--hugella-navy-secondary)]">
                                Domicilio de entrega
                            </dt>
                            <dd className="mt-1 font-semibold">
                                {valueOrNotReported(contract.domicilio_entrega)}
                            </dd>
                        </div>
                    </dl>
                </section>

                <section className="rounded-[var(--hugella-radius-card)] border border-[var(--hugella-border)] bg-white p-5 sm:p-7">
                    <h2 className="text-xl font-bold">Operación</h2>

                    <dl className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                        <div className="sm:col-span-2 lg:col-span-3">
                            <dt className="text-sm text-[var(--hugella-navy-secondary)]">
                                Producto
                            </dt>
                            <dd className="mt-1 text-lg font-semibold">
                                {contract.producto}
                            </dd>
                        </div>

                        <div>
                            <dt className="text-sm text-[var(--hugella-navy-secondary)]">
                                Cantidad
                            </dt>
                            <dd className="mt-1 font-semibold">
                                {contract.cantidad_producto}
                            </dd>
                        </div>

                        <div>
                            <dt className="text-sm text-[var(--hugella-navy-secondary)]">
                                Número de serie
                            </dt>
                            <dd className="mt-1 font-semibold">
                                {valueOrNotReported(contract.numero_serie)}
                            </dd>
                        </div>

                        <div>
                            <dt className="text-sm text-[var(--hugella-navy-secondary)]">
                                Producto exhibido
                            </dt>
                            <dd className="mt-1 font-semibold">
                                {productExhibition(contract.producto_exhibido)}
                            </dd>
                        </div>

                        <div>
                            <dt className="text-sm text-[var(--hugella-navy-secondary)]">
                                Fecha del contrato
                            </dt>
                            <dd className="mt-1 font-semibold">
                                {formatDate(contract.fecha_contrato)}
                            </dd>
                        </div>

                        <div>
                            <dt className="text-sm text-[var(--hugella-navy-secondary)]">
                                Entrega prevista
                            </dt>
                            <dd className="mt-1 font-semibold">
                                {formatDate(contract.fecha_entrega_prevista)}
                            </dd>
                        </div>

                        <div>
                            <dt className="text-sm text-[var(--hugella-navy-secondary)]">
                                Domicilio de cobro
                            </dt>
                            <dd className="mt-1 font-semibold">
                                {valueOrNotReported(contract.domicilio_cobro)}
                            </dd>
                        </div>
                    </dl>

                    <div className="mt-6 grid gap-4 rounded-[var(--hugella-radius-sm)] bg-[var(--canvas)] p-5 sm:grid-cols-2 lg:grid-cols-3">
                        <div>
                            <p className="text-sm text-[var(--hugella-navy-secondary)]">
                                Precio de contado
                            </p>
                            <p className="mt-1 text-xl font-bold">
                                {money.format(Number(contract.precio_contado))}
                            </p>
                        </div>

                        <div>
                            <p className="text-sm text-[var(--hugella-navy-secondary)]">
                                Anticipo
                            </p>
                            <p className="mt-1 text-xl font-bold">
                                {money.format(Number(contract.anticipo))}
                            </p>
                        </div>

                        <div>
                            <p className="text-sm text-[var(--hugella-navy-secondary)]">
                                Total de cuotas
                            </p>
                            <p className="mt-1 text-xl font-bold">
                                {money.format(totalCuotas)}
                            </p>
                        </div>

                        <div>
                            <p className="text-sm text-[var(--hugella-navy-secondary)]">
                                Plan
                            </p>
                            <p className="mt-1 font-bold">
                                {contract.cantidad_cuotas} cuotas de{" "}
                                {money.format(Number(contract.importe_cuota))}
                            </p>
                        </div>

                        <div>
                            <p className="text-sm text-[var(--hugella-navy-secondary)]">
                                Precio total
                            </p>
                            <p className="mt-1 text-xl font-bold text-[var(--hugella-navy)]">
                                {money.format(Number(contract.precio_total))}
                            </p>
                        </div>

                        <div>
                            <p className="text-sm text-[var(--hugella-navy-secondary)]">
                                Gastos administrativos
                            </p>
                            <p className="mt-1 text-xl font-bold">
                                {money.format(
                                    Number(contract.gastos_administrativos ?? 0),
                                )}
                            </p>
                        </div>
                    </div>

                    {contract.observaciones_entrega && (
                        <div className="mt-6">
                            <h3 className="font-bold">Observaciones de entrega</h3>
                            <p className="mt-2 whitespace-pre-wrap text-sm">
                                {contract.observaciones_entrega}
                            </p>
                        </div>
                    )}
                </section>

                <section className="rounded-[var(--hugella-radius-card)] border border-[var(--hugella-border)] bg-white p-5 sm:p-7">
                    <h2 className="text-xl font-bold">Condiciones contractuales</h2>

                    <p className="mt-2 text-sm text-[var(--hugella-navy-secondary)]">
                        Versión: {contract.version_condiciones}
                    </p>

                    <div className="mt-5 whitespace-pre-wrap rounded-[var(--hugella-radius-sm)] border border-[var(--hugella-border)] bg-[var(--canvas)] p-5 text-sm leading-7">
                        {contract.condiciones_texto}
                    </div>
                </section>
                <SignatureRegistration
                    isRegistered={isSignatureRegistered}
                />
                <ApprovalControls
                    contractId={contract.id}
                    state={contract.estado}
                    canApprove={authorization.puede_aprobar}
                />
            </div>
        </main>
    );
}