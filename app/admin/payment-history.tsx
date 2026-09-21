"use client";

import { useState, type FormEvent } from "react";
import { focusStyle, money, type PaymentHistoryItem } from "./admin-types";

type Props = {
  status: "idle" | "loading" | "success" | "error";
  payments: PaymentHistoryItem[];
  error: string;
  disabled: boolean;
  onAnnul: (payment: PaymentHistoryItem, reason: string, operationId: string) => Promise<string | null>;
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value.slice(0, 10)}T00:00:00Z`));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Mendoza",
  }).format(new Date(value));
}

export default function PaymentHistory({ status, payments, error, disabled, onAnnul }: Props) {
  const [selectedPayment, setSelectedPayment] = useState<PaymentHistoryItem | null>(null);
  const [operationId, setOperationId] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [annulmentError, setAnnulmentError] = useState("");

  function openAnnulment(payment: PaymentHistoryItem) {
    setSelectedPayment(payment);
    setOperationId(crypto.randomUUID());
    setReason("");
    setAnnulmentError("");
  }

  function closeAnnulment() {
    if (submitting) return;
    setSelectedPayment(null);
    setOperationId("");
    setReason("");
    setAnnulmentError("");
  }

  function changeReason(value: string) {
    if (annulmentError && value !== reason) {
      setOperationId(crypto.randomUUID());
      setAnnulmentError("");
    }
    setReason(value);
  }

  async function submitAnnulment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedPayment || submitting) return;
    const normalizedReason = reason.trim();
    if (!normalizedReason) {
      setAnnulmentError("Ingresá el motivo de la anulación.");
      return;
    }

    setSubmitting(true);
    setAnnulmentError("");
    const failure = await onAnnul(selectedPayment, normalizedReason, operationId);
    setSubmitting(false);
    if (failure) {
      setAnnulmentError(failure);
      return;
    }
    closeAnnulment();
  }

  return (
    <section aria-labelledby="payment-history-title" className="min-w-0 rounded-[var(--hugella-radius-card)] border border-[var(--hugella-border)] bg-white p-5 sm:p-7">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="section-kicker">Movimientos</p><h2 id="payment-history-title" className="text-xl font-bold">Historial de pagos</h2></div>{status === "success" && payments.length > 0 && <span className="text-sm text-[var(--hugella-navy-secondary)]">{payments.length} registro{payments.length === 1 ? "" : "s"}</span>}</div>
      <div role="status" aria-live="polite" aria-atomic="true" className="mt-5">
        {status === "loading" && <p className="text-sm text-[var(--hugella-navy-secondary)]">Consultando historial...</p>}
        {status === "error" && <p className="rounded-[var(--hugella-radius-sm)] border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        {status === "success" && payments.length === 0 && <p className="text-sm text-[var(--hugella-navy-secondary)]">No hay pagos registrados.</p>}
      </div>
      {status === "success" && payments.length > 0 && <ul className="mt-5 space-y-3">{payments.map((payment) => {
        const annulled = payment.estado === "ANULADO";
        return <li key={payment.pago_id} className={`min-w-0 rounded-[var(--hugella-radius-sm)] border p-4 ${annulled ? "border-red-200 bg-red-50/50" : "border-[var(--hugella-border)] transition hover:border-[var(--hugella-gold)]"}`}>
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="text-sm font-bold text-[var(--hugella-navy)]">{formatDate(payment.fecha_pago)}</p><p className="mt-1 text-xs text-[var(--hugella-navy-secondary)]">Registrado: {formatDateTime(payment.created_at)}</p><p className={`mt-1 break-words text-2xl font-bold ${annulled ? "text-red-800 line-through" : "text-[var(--hugella-navy)]"}`}>{money.format(Number(payment.importe))}</p></div><div className="flex flex-wrap justify-end gap-2">{annulled && <span className="shrink-0 rounded-[var(--hugella-radius-sm)] border border-red-300 bg-red-100 px-2 py-1 text-[0.68rem] font-bold uppercase tracking-wide text-red-800">ANULADO</span>}{payment.origen && <span className={`shrink-0 rounded-[var(--hugella-radius-sm)] border px-2 py-1 text-[0.68rem] font-bold uppercase tracking-wide ${payment.origen.toUpperCase() === "ADMIN" ? "border-[var(--hugella-gold)] bg-[var(--hugella-gold)]/10 text-[var(--hugella-navy)]" : "border-slate-300 bg-slate-100 text-slate-700"}`}>{payment.origen}</span>}</div></div>
          <dl className="mt-4 grid min-w-0 grid-cols-2 gap-x-4 gap-y-3 border-t border-[var(--hugella-border)] pt-4 text-sm"><div className="min-w-0"><dt className="text-[var(--hugella-navy-secondary)]">Cuotas aplicadas</dt><dd className="mt-1 font-bold">{payment.cuotas_aplicadas}</dd></div><div className="min-w-0"><dt className="text-[var(--hugella-navy-secondary)]">Medio de pago</dt><dd className="mt-1 break-words font-semibold">{payment.medio_pago}</dd></div>{payment.observaciones && <div className="col-span-2 min-w-0"><dt className="text-[var(--hugella-navy-secondary)]">Observaciones</dt><dd className="mt-1 break-words">{payment.observaciones}</dd></div>}{annulled && <><div className="col-span-2 min-w-0"><dt className="font-semibold text-red-800">Motivo de anulación</dt><dd className="mt-1 break-words text-red-950">{payment.motivo_anulacion}</dd></div><div className="col-span-2 min-w-0"><dt className="font-semibold text-red-800">Anulado el</dt><dd className="mt-1 text-red-950">{payment.anulado_at ? formatDateTime(payment.anulado_at) : "—"}</dd></div></>}</dl>
          {!annulled && <div className="mt-4 flex justify-end border-t border-[var(--hugella-border)] pt-4"><button type="button" disabled={disabled || submitting} onClick={() => openAnnulment(payment)} className={`min-h-11 rounded-[var(--hugella-radius-sm)] border border-red-300 px-4 py-2 text-sm font-bold text-red-800 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 ${focusStyle}`}>Anular pago</button></div>}
        </li>;
      })}</ul>}

      {selectedPayment && <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-slate-950/55 p-4" role="dialog" aria-modal="true" aria-labelledby="annulment-title"><section className="w-full max-w-lg rounded-[var(--hugella-radius-card)] bg-white p-5 shadow-2xl sm:p-7">
        <p className="section-kicker">Operación irreversible</p><h3 id="annulment-title" className="text-xl font-bold">Anular pago</h3><p className="mt-2 text-sm text-[var(--hugella-navy-secondary)]">El pago permanecerá en el historial como anulado y dejará de contabilizarse.</p>
        <dl className="mt-5 grid grid-cols-2 gap-4 rounded-[var(--hugella-radius-sm)] border border-[var(--hugella-border)] bg-[var(--canvas)] p-4 text-sm"><div><dt className="text-[var(--hugella-navy-secondary)]">Importe</dt><dd className="mt-1 text-lg font-bold">{money.format(Number(selectedPayment.importe))}</dd></div><div><dt className="text-[var(--hugella-navy-secondary)]">Fecha del pago</dt><dd className="mt-1 font-semibold">{formatDate(selectedPayment.fecha_pago)}</dd></div><div><dt className="text-[var(--hugella-navy-secondary)]">Hora de registro</dt><dd className="mt-1 font-semibold">{formatDateTime(selectedPayment.created_at)}</dd></div><div><dt className="text-[var(--hugella-navy-secondary)]">Medio</dt><dd className="mt-1 break-words font-semibold">{selectedPayment.medio_pago}</dd></div>{selectedPayment.observaciones && <div className="col-span-2"><dt className="text-[var(--hugella-navy-secondary)]">Observaciones</dt><dd className="mt-1 break-words">{selectedPayment.observaciones}</dd></div>}</dl>
        <form onSubmit={submitAnnulment} className="mt-5"><fieldset disabled={submitting} className="space-y-4 disabled:opacity-60"><div><label className="field-label" htmlFor="annulment-reason">Motivo de la anulación</label><textarea id="annulment-reason" value={reason} onChange={(event) => changeReason(event.target.value)} className="field-control min-h-24 resize-y" maxLength={500} required autoFocus /></div>{annulmentError && <p role="alert" className="rounded-[var(--hugella-radius-sm)] border border-red-200 bg-red-50 p-3 text-sm text-red-800">{annulmentError}</p>}<div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><button type="button" disabled={submitting} onClick={closeAnnulment} className={`min-h-11 rounded-[var(--hugella-radius-sm)] border border-[var(--hugella-border)] px-4 py-2 font-semibold disabled:cursor-not-allowed ${focusStyle}`}>Cancelar</button><button type="submit" disabled={submitting || !reason.trim()} className={`min-h-11 rounded-[var(--hugella-radius-sm)] bg-red-700 px-4 py-2 font-bold text-white transition hover:bg-red-800 disabled:cursor-wait disabled:opacity-60 ${focusStyle}`}>{submitting ? "Anulando…" : "Confirmar anulación"}</button></div></fieldset></form>
      </section></div>}
    </section>
  );
}
