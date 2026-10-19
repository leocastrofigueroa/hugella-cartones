import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import NewCreditForm from "./new-credit-form";
import { isAdminClient, type AdminClient } from "../admin-types";
import styles from "../admin.module.css";

export default async function NewCreditPage({
  searchParams,
}: {
  searchParams: Promise<{ cliente?: string; compra?: string }>;
}) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();

  if (!data?.claims?.sub) {
    redirect("/admin/login");
  }

  const params = await searchParams;
  const clienteId = params.cliente;
  const compraId = params.compra;

  let initialClient: AdminClient | null = null;
  let initialPurchase: {
    id: string;
    producto: string;
    inversion: string;
  } | null = null;

  if (
    clienteId &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      clienteId
    )
  ) {
    const result = await supabase.rpc("obtener_cliente_admin", {
      p_cliente_id: clienteId,
    });

    if (
      !result.error &&
      Array.isArray(result.data) &&
      result.data.length === 1 &&
      isAdminClient(result.data[0])
    ) {
      initialClient = result.data[0];
    }
  }

  if (
    compraId &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      compraId
    )
  ) {
    const result = await supabase.rpc("obtener_compra_gasto_admin", {
      p_compra_gasto_id: compraId,
    });

    if (
      !result.error &&
      result.data &&
      typeof result.data === "object" &&
      !Array.isArray(result.data)
    ) {
      const purchase = result.data as Record<string, unknown>;
      const items = Array.isArray(purchase.items)
        ? purchase.items
        : [];

      const descriptions = items
        .map((item) => {
          if (
            item &&
            typeof item === "object" &&
            !Array.isArray(item) &&
            typeof (item as Record<string, unknown>).descripcion === "string"
          ) {
            return (item as Record<string, unknown>).descripcion as string;
          }

          return "";
        })
        .map((value) => value.trim())
        .filter(Boolean);

      const total =
        typeof purchase.total === "number" ||
        typeof purchase.total === "string"
          ? String(purchase.total)
          : "";

      if (
        purchase.tipo === "MERCADERIA" &&
        descriptions.length > 0 &&
        /^\d+(\.\d+)?$/.test(total)
      ) {
        const numericTotal = Number(total);

        if (
          Number.isFinite(numericTotal) &&
          numericTotal > 0
        ) {
          initialPurchase = {
            id: compraId,
            producto: descriptions.join(" + "),
            inversion: numericTotal.toFixed(2),
          };
        }
      }
    }
  }

  return (
    <main
      className={`${styles.root} min-h-screen bg-[var(--hugella-bg)] text-[var(--hugella-navy)]`}
    >
      <header className="bg-[var(--hugella-navy)] px-5 py-5 text-white">
        <div className="mx-auto max-w-3xl">
          <Link href="/admin" className="underline">
            HUGELLA · Admin
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-3xl space-y-6 px-5 py-8">
        <div>
          <p className="section-kicker">Administración</p>
          <h1 className="text-3xl font-bold">Nuevo crédito</h1>
          <p className="mt-2">
            {initialPurchase
              ? "Crédito nuevo asociado a una compra registrada."
              : initialClient
                ? `Cliente seleccionado: ${initialClient.nombre}.`
                : "Buscá al cliente por DNI para comenzar."}
          </p>
        </div>

        <NewCreditForm
          initialClient={initialClient}
          initialPurchase={initialPurchase}
        />
      </div>
    </main>
  );
}
