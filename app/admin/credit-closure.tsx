import { useEffect, useRef, useState, type FormEvent } from "react";
import { createClient } from "@/utils/supabase/client";
import { focusStyle, localDate, type Credit, type CreditClosure, type CreditClosureInput, isClosedCredit } from "./admin-types";

type Props = {
  credit: Credit;
  disabled: boolean;
  onClose: (input: CreditClosureInput, operationId: string) => Promise<string | null>;
};

export default function CreditClosureForm({ credit, disabled, onClose }: Props) {
  const closed = isClosedCredit(credit);
  const [closure, setClosure] = useState<CreditClosure | null>(null);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const busy = useRef(false);
  const request = useRef<{ payload: string; id: string } | null>(null);

  useEffect(() => {
    if (!closed) return;
    let current = true;
    void (async () => {
      try {
        const { data, error } = await createClient().rpc("obtener_cierre_credito_admin", { p_credito_id: credit.credito_id });
        if (error || !Array.isArray(data) || !data[0]) throw new Error("Missing closure");
        if (current) setClosure(data[0] as CreditClosure);
      } catch {
        if (current) setError("No se pudo consultar el detalle del cierre. Volvé a buscar el crédito.");
      }
    })();
    return () => { current = false; };
  }, [closed, credit.credito_id]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || busy.current || closed) return;
    const form = new FormData(event.currentTarget);
    const input: CreditClosureInput = {
      p_tipo: String(form.get("tipo")) as CreditClosureInput["p_tipo"],
      p_fecha: String(form.get("fecha") || ""),
      p_motivo: String(form.get("motivo") || "").trim(),
      p_observaciones: String(form.get("observaciones") || "").trim() || null,
    };
    if (!input.p_motivo || !input.p_fecha || form.get("confirmacion") !== "on") {
      setError("Completá la fecha, el motivo y la confirmación del cierre.");
      return;
    }
    const payload = JSON.stringify(input);
    if (request.current?.payload !== payload) request.current = { payload, id: crypto.randomUUID() };
    busy.current = true;
    setSending(true);
    setError("");
    try {
      const failure = await onClose(input, request.current.id);
      if (failure) setError(failure);
    } catch {
      setError("No pudimos confirmar el cierre. Reintentá la misma solicitud.");
    } finally {
      busy.current = false;
      setSending(false);
    }
  }

  return <section aria-labelledby="closure-title" className="min-w-0 rounded-[var(--hugella-radius-card)] border border-[var(--hugella-border)] bg-white p-5 sm:p-7">
    <h2 id="closure-title" className="text-xl font-bold">Cierre por devolución o retiro</h2>
    {closed ? <>
      <p className="mt-3 font-semibold">{credit.estado}. Sin cobranza futura. Los pagos históricos se conservan.</p>
      {closure ? <dl className="mt-4 space-y-2 text-sm [overflow-wrap:anywhere]">
        <div><dt>Fecha de cierre</dt><dd>{closure.fecha}</dd></div>
        <div><dt>Motivo</dt><dd>{closure.motivo}</dd></div>
        <div><dt>Observaciones</dt><dd>{closure.observaciones || "Sin observaciones"}</dd></div>
        <div><dt>Administrador</dt><dd>{closure.actor_id}</dd></div>
        <div><dt>Registrado</dt><dd>{closure.created_at}</dd></div>
      </dl> : !error && <p role="status" className="mt-3">Consultando cierre…</p>}
    </> : <form onSubmit={submit} className="mt-4">
      <p className="mb-4 text-sm">El cierre conserva el plan y los pagos realizados. Desde esa fecha deja de proyectar cobros y de mostrarse al cliente.</p>
      <fieldset disabled={disabled || sending} className="min-w-0 space-y-4 disabled:opacity-60">
        <div><label className="field-label" htmlFor="closure-type">Tipo de cierre</label><select id="closure-type" name="tipo" className="field-control"><option value="DEVUELTO">DEVUELTO — devolución voluntaria</option><option value="RETIRADO">RETIRADO — recuperación por HUGELLA</option></select></div>
        <div><label className="field-label" htmlFor="closure-date">Fecha efectiva</label><input id="closure-date" name="fecha" type="date" required defaultValue={localDate()} max={localDate()} className="field-control" /></div>
        <div><label className="field-label" htmlFor="closure-reason">Motivo</label><textarea id="closure-reason" name="motivo" required maxLength={1000} className="field-control" /></div>
        <div><label className="field-label" htmlFor="closure-notes">Observaciones</label><textarea id="closure-notes" name="observaciones" maxLength={4000} className="field-control" /></div>
        <label className="flex w-full min-w-0 items-start gap-3 text-sm">
          <span className="block w-11 shrink-0"><input name="confirmacion" type="checkbox" required className="h-11 w-11" /></span>
          <span className="min-w-0 flex-1">Confirmo el cierre del crédito {credit.codigo_credito}. Esta operación no registra un pago ni tiene reapertura en esta pantalla.</span>
        </label>
        <button type="submit" className={`min-h-12 rounded border px-4 py-3 font-semibold ${focusStyle}`}>{sending ? "Cerrando…" : "Cerrar crédito"}</button>
      </fieldset>
    </form>}
    {error && <p role="alert" className="mt-3 text-sm text-red-800">{error}</p>}
  </section>;
}
