import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import NewCreditForm from "./new-credit-form";
import { isAdminClient, type AdminClient } from "../admin-types";
import styles from "../admin.module.css";

export default async function NewCreditPage({
  searchParams,
}: {
  searchParams: Promise<{ cliente?: string }>;
}) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();

  if (!data?.claims?.sub) {
    redirect("/admin/login");
  }

  const params = await searchParams;
  const clienteId = params.cliente;

  let initialClient: AdminClient | null = null;

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
            {initialClient
              ? `Cliente seleccionado: ${initialClient.nombre}.`
              : "Buscá al cliente por DNI para comenzar."}
          </p>
        </div>

        <NewCreditForm initialClient={initialClient} />
      </div>
    </main>
  );
}
