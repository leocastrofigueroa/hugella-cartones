"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { createClient } from "@/utils/supabase/client";

type Credit = {
  credito_id: string;
  nombre_cliente: string;
  codigo_credito: string;
  producto: string;
  importe_cuota: number | string;
  cantidad_cuotas: number;
  cuotas_pagadas: number;
  cuotas_pendientes: number;
  estado: string;
};

type PaymentResult = {
  pago_id: string;
  cuotas_aplicadas: number;
  remanente: number | string;
  cuotas_pagadas: number;
  cuotas_pendientes: number;
};

const money = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 2 });

export default function AdminDashboard({ email }: { email: string }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Credit[]>([]);
  const [selected, setSelected] = useState<Credit | null>(null);
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  async function searchCredits(searchTerm: string, selectId?: string) {
    const normalized = searchTerm.trim();
    if (!normalized) {
      setResults([]);
      setSelected(null);
      return;
    }

    setSearching(true);
    setMessage(null);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("buscar_creditos_admin", { p_busqueda: normalized });
    setSearching(false);

    if (error) {
      setResults([]);
      setMessage({ type: "error", text: error.code === "42501" ? "Tu cuenta no tiene permisos de administración." : "No se pudo realizar la búsqueda." });
      return;
    }

    const credits = (data ?? []) as Credit[];
    setResults(credits);
    if (selectId) setSelected(credits.find((credit) => credit.credito_id === selectId) ?? null);
  }

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await searchCredits(query);
  }

  async function handlePayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;

    setSubmitting(true);
    setMessage(null);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("registrar_pago_admin", {
      p_credito_id: selected.credito_id,
      p_fecha_pago: String(form.get("date") ?? ""),
      p_importe: Number(form.get("amount")),
      p_medio_pago: String(form.get("method") ?? ""),
      p_observaciones: String(form.get("notes") ?? "").trim() || null,
    });
    setSubmitting(false);

    if (error) {
      setMessage({ type: "error", text: error.message || "No se pudo registrar el pago." });
      return;
    }

    const payment = ((data ?? []) as PaymentResult[])[0];
    if (!payment) {
      setMessage({ type: "error", text: "Supabase no devolvió el resultado del pago." });
      return;
    }

    setMessage({ type: "success", text: `Pago registrado. Se aplicaron ${payment.cuotas_aplicadas} cuota${payment.cuotas_aplicadas === 1 ? "" : "s"} y el remanente acumulado es ${money.format(Number(payment.remanente))}.` });
    formElement.reset();
    await searchCredits(selected.codigo_credito, selected.credito_id);
  }

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/admin/login");
    router.refresh();
  }

  return (
    <main className="min-h-screen bg-[var(--canvas)] text-[var(--ink)]">
      <aside className="bg-[var(--hugella-navy-deep)] text-white lg:fixed lg:inset-y-0 lg:w-64">
        <div className="flex h-full items-center justify-between px-5 py-4 lg:flex-col lg:items-stretch lg:px-6 lg:py-8">
          <Image src="/hugella-logo.png" alt="HUGELLA Equipamiento Comercial" width={2172} height={724} priority className="hugella-logo w-[155px] lg:w-[195px]" />
          <nav className="hidden space-y-2 lg:block"><span className="block rounded-[var(--hugella-radius-sm)] border-l-2 border-[var(--hugella-gold)] bg-white/6 px-4 py-3 text-sm font-semibold text-[var(--hugella-gold-light)]">Registrar pago</span><button type="button" onClick={signOut} className="w-full rounded-[var(--hugella-radius-sm)] px-4 py-3 text-left text-sm font-medium text-white/60 transition hover:bg-white/5 hover:text-white">Cerrar sesión</button></nav>
          <span className="hidden truncate text-xs text-white/35 lg:block">{email}</span><button type="button" onClick={signOut} className="rounded-[var(--hugella-radius-sm)] border border-[var(--hugella-gold)]/50 px-3 py-2 text-sm font-semibold text-[var(--hugella-gold-light)] lg:hidden">Cerrar sesión</button>
        </div>
      </aside>

      <div className="lg:ml-64">
        <header className="border-b border-slate-200 bg-white px-5 py-5 sm:px-8 lg:px-10"><div className="mx-auto max-w-6xl"><p className="section-kicker">Gestión de cobranzas</p><h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Registrar un pago</h1></div></header>
        <div className="mx-auto max-w-6xl px-5 py-7 sm:px-8 lg:px-10 lg:py-9">
          <form onSubmit={handleSearch} className="max-w-2xl"><label className="field-label" htmlFor="search">Buscar cliente o crédito</label><div className="flex gap-3"><div className="relative flex-1"><svg aria-hidden="true" viewBox="0 0 24 24" className="pointer-events-none absolute left-4 top-1/2 z-10 h-5 w-5 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg><input id="search" value={query} onChange={(event) => setQuery(event.target.value)} className="field-control field-control--search" placeholder="Nombre del cliente o código" /></div><button disabled={searching} className="rounded-[var(--hugella-radius-sm)] bg-[var(--hugella-navy)] px-5 font-bold text-white transition hover:bg-[var(--hugella-navy-secondary)] disabled:opacity-60">{searching ? "Buscando…" : "Buscar"}</button></div></form>

          {results.length > 0 && <section className="mt-4 max-w-2xl overflow-hidden rounded-[var(--hugella-radius-md)] border border-[var(--hugella-border)] bg-white shadow-[0_1px_4px_rgb(6_31_53/0.04)]"><p className="border-b border-[var(--hugella-border)] bg-[var(--hugella-navy)] px-5 py-3 text-xs font-bold uppercase tracking-wider text-white/75">Resultados</p><div className="divide-y divide-[var(--hugella-border)]">{results.map((credit) => <button key={credit.credito_id} type="button" onClick={() => { setSelected(credit); setMessage(null); }} className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition hover:bg-slate-50"><span><strong className="block">{credit.nombre_cliente}</strong><span className="text-sm text-[var(--muted)]">{credit.producto}</span></span><span className="shrink-0 font-mono text-sm font-semibold">{credit.codigo_credito}</span></button>)}</div></section>}
          {!searching && query && results.length === 0 && !message && <p className="mt-4 text-sm text-[var(--muted)]">No se encontraron créditos.</p>}

          {selected && <section className="mt-6 rounded-[var(--hugella-radius-card)] bg-[var(--hugella-navy)] p-5 text-white shadow-[0_2px_8px_rgb(6_31_53/0.07)] sm:p-7"><div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-sm text-white/55">Cliente seleccionado</p><h2 className="mt-1 text-xl font-bold">{selected.nombre_cliente}</h2><p className="mt-1 font-mono text-sm text-white/60">{selected.codigo_credito}</p></div><span className="w-fit rounded-[var(--hugella-radius-sm)] bg-[var(--hugella-gold)] px-3 py-1.5 text-sm font-bold text-[var(--hugella-navy-deep)] ring-1 ring-[var(--hugella-gold-light)]">{selected.estado}</span></div><div className="mt-6 grid grid-cols-2 gap-x-5 gap-y-5 border-t border-white/10 pt-5 sm:grid-cols-5"><div><p className="text-xs text-white/50">Producto</p><p className="mt-1 text-sm font-semibold">{selected.producto}</p></div><div><p className="text-xs text-white/50">Cuota diaria</p><p className="mt-1 font-semibold text-[var(--hugella-gold-light)]">{money.format(Number(selected.importe_cuota))}</p></div><div><p className="text-xs text-white/50">Plan</p><p className="mt-1 font-semibold">{selected.cantidad_cuotas} cuotas</p></div><div><p className="text-xs text-white/50">Pagadas</p><p className="mt-1 font-semibold text-[var(--hugella-gold-light)]">{selected.cuotas_pagadas}</p></div><div><p className="text-xs text-white/50">Pendientes</p><p className="mt-1 font-semibold">{selected.cuotas_pendientes}</p></div></div></section>}

          {message && <div role="status" className={`mt-5 rounded-[var(--hugella-radius-sm)] border px-4 py-3 text-sm font-semibold ${message.type === "success" ? "border-[var(--hugella-gold)]/50 bg-[var(--hugella-gold)]/10 text-[var(--hugella-navy)]" : "border-red-200 bg-red-50 text-red-700"}`}>{message.type === "success" ? "✓ " : ""}{message.text}</div>}

          <section className={`mt-6 max-w-xl rounded-[var(--hugella-radius-card)] border border-[var(--hugella-border)] bg-white p-5 shadow-[0_1px_4px_rgb(6_31_53/0.04)] sm:p-7 ${selected ? "" : "opacity-60"}`}><div className="mb-6"><p className="section-kicker">Nuevo movimiento</p><h2 className="text-xl font-bold">Datos del pago</h2></div>{selected ? <form onSubmit={handlePayment} className="space-y-5"><div><label className="field-label" htmlFor="amount">Importe recibido</label><div className="relative"><span className="pointer-events-none absolute left-4 top-1/2 z-10 -translate-y-1/2 font-bold text-[var(--muted)]">$</span><input className="field-control field-control--currency text-lg font-bold" id="amount" name="amount" type="number" min="0.01" step="0.01" required /></div><p className="mt-2 text-sm text-[var(--muted)]">Supabase calculará las cuotas aplicadas y el remanente acumulado.</p></div><div><label className="field-label" htmlFor="date">Fecha</label><input className="field-control" id="date" name="date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required /></div><div><label className="field-label" htmlFor="method">Medio de pago</label><select className="field-control" id="method" name="method" defaultValue="Transferencia"><option>Transferencia</option><option>Efectivo</option><option>Tarjeta de débito</option><option>Mercado Pago</option></select></div><div><label className="field-label" htmlFor="notes">Observaciones <span className="font-normal text-[var(--muted)]">(opcional)</span></label><textarea className="field-control min-h-24 resize-y" id="notes" name="notes" maxLength={500} /></div><button disabled={submitting} type="submit" className="min-h-13 w-full rounded-[var(--hugella-radius-sm)] bg-[linear-gradient(135deg,var(--hugella-gold-light),var(--hugella-gold))] px-5 py-3.5 font-bold text-[var(--hugella-navy-deep)] shadow-[inset_0_1px_rgb(255_255_255/0.25)] transition hover:bg-[var(--hugella-gold-light)] disabled:cursor-wait disabled:opacity-60">{submitting ? "Registrando…" : "Registrar pago"}</button></form> : <p className="text-[var(--muted)]">Buscá y seleccioná un crédito para registrar un pago.</p>}</section>
        </div>
      </div>
    </main>
  );
}
