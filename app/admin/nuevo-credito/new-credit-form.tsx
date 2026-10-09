"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import styles from "../admin.module.css";
import { creationMoney, focusStyle, isAdminClient, isCreditCreationResult, localDate, normalizeDni, validateCreditCreation, type AdminClient, type CreditCreationInput, type CreditCreationResult } from "../admin-types";

type Phase = "editing" | "review" | "sending" | "uncertain" | "success";
type Review = { payload: CreditCreationInput; name: string };
const placeholderId = "00000000-0000-4000-8000-000000000000";
const button = `min-h-12 rounded-lg bg-[var(--hugella-navy)] px-5 py-3 font-semibold text-white disabled:opacity-50 ${focusStyle}`;
const card = "space-y-5 rounded-[var(--hugella-radius-card)] border border-[var(--hugella-border)] bg-white p-5 sm:p-7";

export default function NewCreditForm() {
  const [dni, setDni] = useState("");
  const [lookup, setLookup] = useState<"idle" | "loading" | "existing" | "new" | "error">("idle");
  const [client, setClient] = useState<AdminClient | null>(null);
  const [fields, setFields] = useState({ nombre: "", telefono: "", domicilio: "", producto: "", fecha: localDate(), cuotas: "", importe: "" });
  const [phase, setPhase] = useState<Phase>("editing");
  const [review, setReview] = useState<Review | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<CreditCreationResult | null>(null);
  const searchVersion = useRef(0);
  const busy = useRef(false);
  const intention = useRef<Readonly<CreditCreationInput> | null>(null);
  const wasUncertain = useRef(false);

  useEffect(() => {
    if (phase !== "sending" && phase !== "uncertain") return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [phase]);

  function changeDni(value: string) {
    searchVersion.current++;
    setDni(normalizeDni(value)); setLookup("idle"); setClient(null); setError("");
  }
  async function search(event: FormEvent) {
    event.preventDefault();
    if (!/^[0-9]{7,9}$/.test(dni)) { setError("El DNI debe contener entre 7 y 9 dígitos."); return; }
    const version = ++searchVersion.current;
    setLookup("loading"); setClient(null); setError("");
    try {
      const response = await fetch("/api/admin/clientes/buscar", { method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", body: JSON.stringify({ dni }) });
      const body = await response.json();
      if (version !== searchVersion.current) return;
      if (!response.ok || !body || !("client" in body)) throw new Error();
      if (body.client === null) { setLookup("new"); setFields(old => ({ ...old, nombre: "", telefono: "", domicilio: "" })); }
      else if (isAdminClient(body.client) && normalizeDni(body.client.dni) === dni) { setClient(body.client); setLookup("existing"); }
      else throw new Error();
    } catch {
      if (version === searchVersion.current) { setLookup("error"); setError("No pudimos buscar al cliente. Revisá tu sesión y reintentá."); }
    }
  }
  function prepare(event: FormEvent) {
    event.preventDefault();
    if (lookup !== "new" && lookup !== "existing") return;
    const payload: CreditCreationInput = {
      p_operacion_id: placeholderId, p_dni: dni, p_cliente_nuevo: lookup === "new",
      p_cliente_id_esperado: client?.id ?? null,
      p_nombre: client ? null : fields.nombre.trim(), p_telefono: client ? null : fields.telefono.trim() || null,
      p_domicilio: client ? null : fields.domicilio.trim() || null,
      p_producto: fields.producto.trim(), p_fecha_inicio: fields.fecha,
      p_cantidad_cuotas: Number(fields.cuotas), p_importe_cuota: fields.importe.trim().replace(",", "."),
    };
    const invalid = validateCreditCreation(payload);
    if (invalid) { setError(invalid); return; }
    setReview({ payload, name: client?.nombre ?? fields.nombre.trim() }); setConfirmed(false); setError(""); setPhase("review");
  }
  async function create(event: FormEvent) {
    event.preventDefault();
    if (busy.current || !review || !confirmed) return;
    busy.current = true;
    if (!intention.current) intention.current = Object.freeze({ ...review.payload, p_operacion_id: crypto.randomUUID() });
    const payload = intention.current;
    setPhase("sending"); setError("");
    try {
      const response = await fetch("/api/admin/creditos", { method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", body: JSON.stringify(payload) });
      const body = await response.json();
      if (response.ok && isCreditCreationResult(body?.result, payload)) { setResult(body.result); setPhase("success"); return; }
      const safeCodes = ["VALIDATION", "DNI_CONFLICT", "IDENTITY", "CODE_LIMIT", "REJECTED"];
      const preflight = ["SESSION", "PERMISSION", "ORIGIN"];
      if (!response.ok && body?.outcome === "rejected" && (safeCodes.includes(body.code) || (!wasUncertain.current && preflight.includes(body.code)))) {
        intention.current = null; wasUncertain.current = false; setPhase("editing"); setReview(null);
        if (["DNI_CONFLICT", "IDENTITY"].includes(body.code)) { setClient(null); setLookup("idle"); }
        setError(typeof body.error === "string" ? body.error : "Revisá los datos y volvé a confirmar."); return;
      }
      throw new Error();
    } catch {
      wasUncertain.current = true; setPhase("uncertain");
      setError("No pudimos confirmar el resultado. Reintentá la misma solicitud. Si tu sesión venció, iniciá sesión en otra pestaña antes de reintentar.");
    } finally { busy.current = false; }
  }
  function reset() {
    intention.current = null; wasUncertain.current = false; searchVersion.current++;
    setDni(""); setLookup("idle"); setClient(null); setReview(null); setResult(null); setConfirmed(false); setError("");
    setFields({ nombre: "", telefono: "", domicilio: "", producto: "", fecha: localDate(), cuotas: "", importe: "" }); setPhase("editing");
  }
  const field = (key: keyof typeof fields, label: string, type = "text", required = true) => <label className="block"><span className="field-label">{label}</span><input className="field-control" name={key} type={type} required={required} value={fields[key]} inputMode={key === "importe" ? "decimal" : key === "cuotas" ? "numeric" : undefined} onChange={e => setFields(old => ({ ...old, [key]: e.target.value }))} /></label>;
  return <div className="space-y-6">
    {error && <p role="alert" className="rounded-lg border border-red-300 bg-red-50 p-4 text-red-800">{error}</p>}
    {phase === "editing" && <>
      <form id="client-search-form" onSubmit={search} className={card}><label className="block"><span className="field-label">DNI del cliente</span><input name="dni" className="field-control" inputMode="numeric" autoComplete="off" value={dni} onChange={e => changeDni(e.target.value)} required /></label><button className={button} disabled={lookup === "loading"}>Buscar cliente</button><p role="status" aria-live="polite">{lookup === "loading" ? "Buscando cliente…" : lookup === "new" ? "El DNI no está registrado. Cargá los datos del cliente nuevo." : lookup === "existing" ? "Cliente encontrado. Sus datos se conservarán." : ""}</p></form>
      {(lookup === "existing" || lookup === "new") && <form id="credit-data-form" className={card} onSubmit={prepare}>
        <h2 className="text-xl font-bold">Cliente</h2>
        {client ? <dl className="grid gap-3 sm:grid-cols-2">{[["Nombre", client.nombre], ["DNI", client.dni], ["Teléfono", client.telefono], ["Domicilio", client.domicilio]].map(([label, value]) => <div key={label}><dt className="font-semibold">{label}</dt><dd>{value || "Sin informar"}</dd></div>)}</dl> : <div className="grid gap-4 sm:grid-cols-2">{field("nombre", "Nombre")}{field("telefono", "Teléfono (opcional)", "tel", false)}{field("domicilio", "Domicilio (opcional)", "text", false)}</div>}
        <h2 className="text-xl font-bold">Datos del crédito</h2><div className="grid gap-4 sm:grid-cols-2">{field("producto", "Producto")}{field("fecha", "Fecha de entrega", "date")}{field("cuotas", "Cantidad de cuotas")}{field("importe", "Importe por cuota")}</div><p>No se permiten entregas los domingos. El código se asignará automáticamente.</p><button className={button}>Revisar crédito</button>
      </form>}
    </>}
    {review && ["review", "sending", "uncertain"].includes(phase) && <form id="credit-confirm-form" onSubmit={create} className={card}>
      <h2 className="text-xl font-bold">Revisá antes de crear</h2><dl className="grid gap-4 sm:grid-cols-2">{[["Cliente", review.name], ["DNI", review.payload.p_dni], ["Producto", review.payload.p_producto], ["Fecha de entrega", review.payload.p_fecha_inicio], ["Cuotas", String(review.payload.p_cantidad_cuotas)], ["Importe por cuota", creationMoney(review.payload.p_importe_cuota)], ["Total del crédito", creationMoney(review.payload.p_importe_cuota, review.payload.p_cantidad_cuotas)]].map(([label, value]) => <div key={label}><dt className="font-semibold">{label}</dt><dd>{value}</dd></div>)}</dl>
      <p>El código se asignará automáticamente al crear el crédito.</p><label className={`${styles.creditConfirmation} flex items-start gap-3`}><input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={confirmed} disabled={phase !== "review"} onChange={e => setConfirmed(e.target.checked)} /><span className="min-w-0 flex-1">Confirmo que los datos son correctos y quiero crear este crédito.</span></label>
      <div className="flex flex-col gap-3 sm:flex-row"><button className={button} disabled={!confirmed || phase === "sending"}>{phase === "sending" ? "Creando crédito…" : phase === "uncertain" ? "Reintentar misma solicitud" : "Crear crédito"}</button>{phase === "review" && <button type="button" className="min-h-12 rounded-lg border px-5" onClick={() => { setPhase("editing"); setReview(null); }}>Volver a editar</button>}</div>
      {(phase === "uncertain" || phase === "sending") && <p role="status" aria-live="polite">La intención se conserva solo mientras esta página permanezca abierta. No recargues ni cierres la página: no hay recuperación automática después de hacerlo.</p>}
    </form>}
    {phase === "success" && result && review && <section className={card} aria-live="polite"><h2 className="text-xl font-bold">Crédito creado correctamente.</h2><p className="text-2xl font-bold">{result.codigo}</p><p>Cliente: {review.name}</p><p>Producto: {review.payload.p_producto}</p>{result.ya_procesada && <p>Esta solicitud ya estaba procesada.</p>}<div className="flex flex-col gap-3 sm:flex-row"><Link href="/admin" className={button}>Volver al Admin</Link><button className={button} type="button" onClick={reset}>Crear otro crédito</button></div></section>}
  </div>;
}
