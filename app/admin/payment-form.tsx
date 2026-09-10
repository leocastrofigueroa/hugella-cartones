import { useState, type FormEvent } from "react";
import { focusStyle, localDate, type PaymentInput } from "./admin-types";

type Props = {
  disabled: boolean;
  refreshing: boolean;
  onPayment: (payment: PaymentInput) => Promise<void>;
};

export default function PaymentForm({ disabled, refreshing, onPayment }: Props) {
  const [date] = useState(localDate);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled) return;
    const form = new FormData(event.currentTarget);
    void onPayment({
      p_fecha_pago: String(form.get("date") ?? ""),
      p_importe: Number(form.get("amount")),
      p_medio_pago: String(form.get("method") ?? ""),
      p_observaciones: String(form.get("notes") ?? "").trim() || null,
    });
  }

  return (
    <section aria-labelledby="payment-title" className="min-w-0 rounded-[var(--hugella-radius-card)] border border-[var(--hugella-border)] bg-white p-5 sm:p-7">
      <p className="section-kicker">Nuevo movimiento</p>
      <h2 id="payment-title" className="text-xl font-bold">Registrar pago</h2>
      <form onSubmit={submit} aria-busy={disabled} className="mt-6">
        <fieldset disabled={disabled} className="min-w-0 space-y-5 disabled:opacity-60">
          <legend className="sr-only">Datos del pago para el crédito seleccionado</legend>
          <div>
            <label className="field-label" htmlFor="amount">Importe recibido</label>
            <input className="field-control text-lg font-bold" id="amount" name="amount" type="number" inputMode="decimal" min="0.01" step="0.01" required aria-describedby="amount-hint" />
            <p id="amount-hint" className="mt-2 text-sm text-[var(--hugella-navy-secondary)]">Ingresá el importe en pesos. Las cuotas aplicadas y el remanente se calculan al registrar el pago.</p>
          </div>
          <div><label className="field-label" htmlFor="date">Fecha</label><input className="field-control min-w-0 max-w-full" id="date" name="date" type="date" defaultValue={date} required /></div>
          <div><label className="field-label" htmlFor="method">Medio de pago</label><select className="field-control" id="method" name="method" defaultValue="Transferencia"><option>Transferencia</option><option>Efectivo</option><option>Tarjeta de débito</option><option>Mercado Pago</option></select></div>
          <div><label className="field-label" htmlFor="notes">Observaciones <span className="font-normal">(opcional)</span></label><textarea className="field-control min-h-24 resize-y" id="notes" name="notes" maxLength={500} /></div>
          <button type="submit" className={`min-h-13 w-full rounded-[var(--hugella-radius-sm)] bg-[var(--hugella-gold)] px-5 py-3.5 font-bold text-[var(--hugella-navy-deep)] transition hover:bg-[var(--hugella-gold-light)] disabled:cursor-wait ${focusStyle}`}>{refreshing ? "Actualizando crédito…" : disabled ? "Registrando…" : "Registrar pago"}</button>
        </fieldset>
      </form>
    </section>
  );
}
