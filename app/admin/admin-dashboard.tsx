"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { createClient } from "@/utils/supabase/client";
import styles from "./admin.module.css";
import CreditSearch from "./credit-search";
import CreditResults from "./credit-results";
import CreditDetail from "./credit-detail";
import PaymentForm from "./payment-form";
import { focusStyle, money, type Credit, type PaymentInput, type PaymentResult } from "./admin-types";

type SearchStatus = "idle" | "loading" | "done" | "error";

export default function AdminDashboard({ email }: { email: string }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Credit[]>([]);
  const [selected, setSelected] = useState<Credit | null>(null);
  const [searchStatus, setSearchStatus] = useState<SearchStatus>("idle");
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [paymentError, setPaymentError] = useState("");
  const [success, setSuccess] = useState("");
  const [refreshError, setRefreshError] = useState("");
  const [formVersion, setFormVersion] = useState(0);
  // Synchronous lock covers searches, payment submission, and its refresh.
  const busy = useRef(false);
  const disabled = searchStatus === "loading" || submitting;

  async function searchCredits() {
    if (busy.current) return;
    const normalized = query.trim();
    setSelected(null);
    setResults([]);
    setSearchError("");
    setPaymentError("");
    setSuccess("");
    setRefreshError("");
    if (!normalized) {
      setSearchStatus("idle");
      return;
    }

    busy.current = true;
    setSearchStatus("loading");
    try {
      const { data, error } = await createClient().rpc("buscar_creditos_admin", { p_busqueda: normalized });
      if (error) {
        setSearchError(error.code === "42501" ? "Tu cuenta no tiene permisos de administración." : "No se pudo realizar la búsqueda. Intentá nuevamente.");
        setSearchStatus("error");
        return;
      }
      if (data !== null && !Array.isArray(data)) throw new Error("Invalid search response");
      setResults((data ?? []) as Credit[]);
      setSearchStatus("done");
    } catch {
      setSearchError("No se pudo realizar la búsqueda. Revisá tu conexión e intentá nuevamente.");
      setSearchStatus("error");
    } finally {
      busy.current = false;
    }
  }

  function selectCredit(credit: Credit) {
    if (busy.current || selected?.credito_id === credit.credito_id) return;
    setSelected(credit);
    setPaymentError("");
    setSuccess("");
    setRefreshError("");
  }

  async function handlePayment(input: PaymentInput) {
    if (busy.current || !selected) return;
    const credit = selected;
    busy.current = true;
    setSubmitting(true);
    setPaymentError("");
    setSuccess("");
    setRefreshError("");

    try {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("registrar_pago_admin", {
        p_credito_id: credit.credito_id,
        p_fecha_pago: input.p_fecha_pago,
        p_importe: input.p_importe,
        p_medio_pago: input.p_medio_pago,
        p_observaciones: input.p_observaciones,
      });
      if (error) {
        setPaymentError("No se pudo registrar el pago. Revisá los datos ingresados y los permisos de tu cuenta.");
        return;
      }
      const payment = (Array.isArray(data) ? data[0] : undefined) as PaymentResult | undefined;
      if (!payment) {
        setPaymentError("No recibimos la confirmación del pago. Verificá si se registró antes de volver a enviarlo.");
        return;
      }

      setSuccess(`Pago registrado para ${credit.codigo_credito}. Se aplicaron ${payment.cuotas_aplicadas} cuota${payment.cuotas_aplicadas === 1 ? "" : "s"} y el remanente acumulado es ${money.format(Number(payment.remanente))}.`);
      setFormVersion((version) => version + 1);
      setRefreshing(true);
      // Refresh separately: it must never erase a confirmed payment message.
      try {
        const { data: refreshed, error: refreshFailure } = await supabase.rpc("buscar_creditos_admin", { p_busqueda: credit.codigo_credito });
        if (refreshFailure || !Array.isArray(refreshed)) throw new Error("Credit refresh failed");
        const updated = (refreshed as Credit[]).find((item) => item.credito_id === credit.credito_id);
        if (!updated) throw new Error("Credit missing from refresh");
        setSelected(updated);
        setResults((current) => current.map((item) => item.credito_id === updated.credito_id ? updated : item));
      } catch {
        setSelected(null);
        setResults([]);
        setSearchStatus("idle");
        setRefreshError("El pago ya fue registrado, pero no pudimos actualizar la ficha. Volvé a buscar el crédito para ver sus datos actuales. No vuelvas a registrar este pago.");
      }
    } catch {
      setPaymentError("Se interrumpió la comunicación al registrar el pago. Verificá si se registró antes de volver a enviarlo.");
    } finally {
      setRefreshing(false);
      setSubmitting(false);
      busy.current = false;
    }
  }

  async function signOut() {
    if (busy.current) return;
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/admin/login");
    router.refresh();
  }

  return (
    <main className={`${styles.root} min-h-screen bg-[var(--canvas)] text-[var(--ink)]`}>
      <header aria-label="Cuenta de administración" className="bg-[var(--hugella-navy-deep)] text-white">
        <div className="mx-auto flex w-full max-w-6xl min-w-0 flex-wrap items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <div className="w-[clamp(9rem,45vw,13.75rem)] min-w-0 max-w-full">
            <Image src="/hugella-logo.png" alt="HUGELLA Equipamiento Comercial" width={2172} height={724} priority className="block h-auto w-full max-w-full object-contain" />
          </div>
          <div className="ml-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-4">
            <p className="hidden min-w-0 max-w-xs text-right text-xs text-white/75 [overflow-wrap:anywhere] lg:block">{email}</p>
            <button type="button" disabled={disabled} onClick={signOut} className={`min-h-11 max-w-full rounded-[var(--hugella-radius-sm)] border border-[var(--hugella-gold)]/60 px-4 py-2 whitespace-normal text-sm font-semibold text-[var(--hugella-gold-light)] transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-60 ${focusStyle}`}>Cerrar sesión</button>
          </div>
        </div>
      </header>

      <div className="min-w-0">
        <header className="border-b border-[var(--hugella-border)] bg-white px-5 py-6 sm:px-8">
          <div className="mx-auto max-w-6xl"><p className="section-kicker">Gestión de cobranzas</p><h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Créditos y pagos</h1><p className="mt-2 text-sm text-[var(--hugella-navy-secondary)]">Buscá un crédito, revisá sus cuotas y registrá un pago.</p></div>
        </header>
        <div className="mx-auto max-w-6xl space-y-6 px-5 py-6 sm:px-8 sm:py-8">
          <section aria-label="Búsqueda de créditos" className="rounded-[var(--hugella-radius-card)] border border-[var(--hugella-border)] bg-white p-5 sm:p-6">
            <CreditSearch query={query} onChange={setQuery} onSearch={searchCredits} disabled={disabled} searching={searchStatus === "loading"} />
            <div role="status" aria-live="polite" aria-atomic="true" className="mt-4 text-sm">
              {searchStatus === "idle" && <p className="text-[var(--hugella-navy-secondary)]">Buscá un crédito para comenzar.</p>}
              {searchStatus === "loading" && <p className="font-semibold">Buscando créditos…</p>}
              {searchStatus === "done" && <p>{results.length === 0 ? "No se encontraron créditos para esta búsqueda." : "Seleccioná un resultado para consultar su ficha y registrar un pago."}</p>}
              {searchError && <p className="text-red-800">{searchError}</p>}
            </div>
            {results.length > 0 && <CreditResults credits={results} selectedId={selected?.credito_id} disabled={disabled} onSelect={selectCredit} />}
          </section>

          <div role="status" aria-live="polite" aria-atomic="true" className="space-y-3">
            {success && <p className="rounded-[var(--hugella-radius-sm)] border border-[var(--hugella-gold)] bg-[var(--hugella-gold)]/10 p-4 text-sm font-semibold [overflow-wrap:anywhere]">{success}</p>}
            {refreshing && <p className="text-sm">Actualizando la ficha del crédito…</p>}
            {refreshError && <p className="rounded-[var(--hugella-radius-sm)] border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">{refreshError}</p>}
            {paymentError && <p className="rounded-[var(--hugella-radius-sm)] border border-red-200 bg-red-50 p-4 text-sm text-red-800">{paymentError}</p>}
          </div>

          {selected && (
            <div className="grid min-w-0 grid-cols-1 items-start gap-6 xl:grid-cols-2">
              <CreditDetail credit={selected} />
              <PaymentForm key={`${selected.credito_id}-${formVersion}`} disabled={submitting} refreshing={refreshing} onPayment={handlePayment} />
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
