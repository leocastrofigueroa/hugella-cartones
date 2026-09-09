"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

type CreditOption = {
  access_token: string;
  codigo: string;
  producto: string;
  estado: string;
};

function isCreditOption(value: unknown): value is CreditOption {
  if (!value || typeof value !== "object") return false;
  const credit = value as Record<string, unknown>;
  return typeof credit.access_token === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(credit.access_token)
    && typeof credit.codigo === "string"
    && typeof credit.producto === "string"
    && typeof credit.estado === "string";
}

const focusStyle = "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--hugella-navy)]";

export default function ClientPage() {
  const router = useRouter();
  const [dni, setDni] = useState("");
  const [lastFour, setLastFour] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<{ dni?: string; phone?: string }>({});
  const [credits, setCredits] = useState<CreditOption[]>([]);
  const inFlight = useRef(false);
  const dniInput = useRef<HTMLInputElement>(null);
  const phoneInput = useRef<HTMLInputElement>(null);
  const resultsHeading = useRef<HTMLHeadingElement>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    setMessage("");
    setCredits([]);

    const normalizedDni = dni.replace(/[.\s-]/g, "");
    const nextErrors = {
      dni: /^\d+$/.test(normalizedDni) ? undefined : "Ingresá tu DNI con números; podés incluir puntos, espacios o guiones.",
      phone: /^\d{4}$/.test(lastFour) ? undefined : "Ingresá exactamente los últimos 4 dígitos de tu teléfono.",
    };
    setErrors(nextErrors);
    if (nextErrors.dni || nextErrors.phone) {
      (nextErrors.dni ? dniInput : phoneInput).current?.focus();
      return;
    }

    inFlight.current = true;
    setLoading(true);
    setDni("");
    setLastFour("");
    let navigating = false;

    try {
      // Same isolated anon pattern as /carton/[token]. Never use the admin
      // client, persisted auth, URL sessions, or cookies for this request.
      const supabase = createSupabaseClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
        {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
          },
          global: {
            fetch: (input, init) => fetch(input, { ...init, credentials: "omit" }),
          },
        },
      );
      const { data, error } = await supabase.rpc("acceder_creditos_cliente", {
        p_dni: normalizedDni,
        p_ultimos4: lastFour,
      }).abortSignal(AbortSignal.timeout(20_000));

      if (error || !Array.isArray(data) || !data.every(isCreditOption)) {
        setMessage("No pudimos realizar la consulta. Intentá nuevamente en unos minutos.");
      } else if (data.length === 0) {
        setMessage("No encontramos créditos con los datos ingresados.");
      } else if (data.length === 1) {
        router.push(`/carton/${data[0].access_token}`);
        navigating = true;
      } else {
        setCredits(data);
        requestAnimationFrame(() => resultsHeading.current?.focus());
      }
    } catch {
      setMessage("No pudimos realizar la consulta. Intentá nuevamente en unos minutos.");
    } finally {
      if (!navigating) {
        inFlight.current = false;
        setLoading(false);
      }
    }
  }

  return (
    <main className="min-h-screen bg-[var(--canvas)] text-[var(--ink)]">
      <header className="bg-[var(--navy)] text-white">
        <div className="mx-auto max-w-6xl px-5 py-5 sm:px-8">
          <Image src="/hugella-logo.png" alt="HUGELLA Equipamiento Comercial" width={2172} height={724} priority className="block h-auto w-[185px] max-w-full sm:w-[220px]" />
        </div>
      </header>

      <div className="mx-auto w-full max-w-xl px-5 py-8 sm:px-8 sm:py-14">
        <section aria-labelledby="access-title" className="rounded-[var(--hugella-radius-card)] border border-[var(--hugella-border)] border-t-4 border-t-[var(--hugella-gold)] bg-white p-5 shadow-[0_3px_10px_rgb(6_31_53/0.06)] sm:p-8">
          <p className="section-kicker">HUGELLA Cartones</p>
          <h1 id="access-title" className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Consultá tu crédito</h1>
          <p className="mt-3 text-base leading-relaxed text-[var(--hugella-navy-secondary)]">Ingresá tu DNI y los últimos 4 dígitos del teléfono que registraste con nosotros para acceder a tu cartón.</p>

          <form onSubmit={handleSubmit} noValidate className="mt-7 space-y-5" aria-busy={loading}>
            <div>
              <label htmlFor="dni" className="field-label">DNI</label>
              <input ref={dniInput} id="dni" name="dni" type="text" inputMode="numeric" autoComplete="off" required value={dni} onChange={(event) => setDni(event.target.value)} disabled={loading} aria-invalid={Boolean(errors.dni)} aria-describedby={errors.dni ? "dni-error" : undefined} className="field-control text-base disabled:opacity-60" />
              {errors.dni && <p id="dni-error" className="mt-2 text-sm text-red-800">{errors.dni}</p>}
            </div>
            <div>
              <label htmlFor="phone-last-four" className="field-label">Últimos 4 dígitos de tu teléfono</label>
              <input ref={phoneInput} id="phone-last-four" name="phone-last-four" type="text" inputMode="numeric" autoComplete="off" required pattern="[0-9]{4}" value={lastFour} onChange={(event) => setLastFour(event.target.value)} disabled={loading} aria-invalid={Boolean(errors.phone)} aria-describedby={errors.phone ? "phone-error" : "phone-hint"} className="field-control text-base disabled:opacity-60" />
              <p id="phone-hint" className="mt-2 text-sm text-[var(--hugella-navy-secondary)]">Solo los últimos 4 números, sin espacios.</p>
              {errors.phone && <p id="phone-error" className="mt-2 text-sm text-red-800">{errors.phone}</p>}
            </div>
            <button type="submit" disabled={loading} className={`min-h-12 w-full rounded-[var(--hugella-radius-sm)] bg-[var(--hugella-gold)] px-4 py-3 text-sm font-bold tracking-wide text-[var(--hugella-navy-deep)] transition hover:bg-[var(--hugella-gold-light)] disabled:cursor-wait disabled:opacity-70 ${focusStyle}`}>
              {loading ? "CONSULTANDO…" : "CONSULTAR CRÉDITO"}
            </button>
            <div role="status" aria-live="polite" aria-atomic="true">
              {loading && <p className="text-sm text-[var(--hugella-navy-secondary)]">Estamos consultando tus créditos…</p>}
              {message && <p className="rounded-[var(--hugella-radius-sm)] border border-[var(--hugella-border)] bg-[var(--canvas)] p-3 text-sm leading-relaxed">{message}</p>}
            </div>
          </form>
        </section>

        {credits.length > 1 && (
          <section aria-labelledby="credits-title" className="mt-8">
            <h2 ref={resultsHeading} tabIndex={-1} id="credits-title" className={`text-2xl font-bold tracking-tight ${focusStyle}`}>Elegí tu crédito</h2>
            <p className="mt-2 text-[var(--hugella-navy-secondary)]">Seleccioná el cartón que querés consultar.</p>
            <ul className="mt-4 space-y-3">
              {credits.map((credit) => (
                <li key={credit.access_token}>
                  <Link href={`/carton/${credit.access_token}`} prefetch={false} className={`block min-w-0 rounded-[var(--hugella-radius-card)] border border-[var(--hugella-border)] bg-white p-5 transition hover:border-[var(--hugella-gold)] ${focusStyle}`}>
                    <span className="block break-words text-sm font-bold">{credit.codigo}</span>
                    <span className="mt-1 block break-words text-lg font-semibold">{credit.producto}</span>
                    <span className="mt-3 inline-block max-w-full break-words rounded-[var(--hugella-radius-sm)] bg-[var(--hugella-navy)] px-3 py-1 text-sm font-semibold text-white">{credit.estado}</span>
                    <span className="mt-4 block text-sm font-bold text-[var(--hugella-navy)]">Abrir cartón <span aria-hidden="true">→</span></span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}
