"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";

export default function LoginForm() {
  const router = useRouter();

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const [recovering, setRecovering] = useState(false);
  const [recoverySent, setRecoverySent] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();

    const supabase = createClient();

    if (recovering) {
      const { error: recoveryError } =
        await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });

      if (recoveryError) {
        setError(
          "No se pudo enviar el correo de recuperación. Intentá nuevamente.",
        );
        setLoading(false);
        return;
      }

      setRecoverySent(true);
      setLoading(false);
      return;
    }

    const { error: signInError } =
      await supabase.auth.signInWithPassword({
        email,
        password: String(form.get("password") ?? ""),
      });

    if (signInError) {
      setError("El email o la contraseña no son correctos.");
      setLoading(false);
      return;
    }

    router.replace("/admin");
    router.refresh();
  }

  if (recoverySent) {
    return (
      <div className="mt-7 space-y-5">
        <p className="rounded-[var(--hugella-radius-sm)] border border-green-200 bg-green-50 px-4 py-3 text-sm font-semibold text-green-800">
          Te enviamos un correo para recuperar tu contraseña.
        </p>

        <p className="text-sm text-[var(--muted)]">
          Abrí el último correo recibido y tocá el enlace para elegir una nueva
          contraseña.
        </p>

        <button
          type="button"
          className="min-h-12 w-full rounded-[var(--hugella-radius-sm)] border border-[var(--hugella-border)] px-4 py-3 font-semibold"
          onClick={() => {
            setRecoverySent(false);
            setRecovering(false);
            setError("");
          }}
        >
          Volver al inicio de sesión
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-7 space-y-5">
      <div>
        <label className="field-label" htmlFor="email">
          Email
        </label>

        <input
          className="field-control"
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
        />
      </div>

      {!recovering && (
        <div>
          <label className="field-label" htmlFor="password">
            Contraseña
          </label>

          <input
            className="field-control"
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </div>
      )}

      {error && (
        <p
          role="alert"
          className="rounded-[var(--hugella-radius-sm)] border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700"
        >
          {error}
        </p>
      )}

      <button
        disabled={loading}
        className="min-h-13 w-full rounded-[var(--hugella-radius-sm)] bg-[linear-gradient(135deg,var(--hugella-gold-light),var(--hugella-gold))] px-5 py-3.5 font-bold text-[var(--hugella-navy-deep)] shadow-[inset_0_1px_rgb(255_255_255/0.25)] transition hover:bg-[var(--hugella-gold-light)] disabled:cursor-wait disabled:opacity-60"
        type="submit"
      >
        {loading
          ? recovering
            ? "Enviando…"
            : "Ingresando…"
          : recovering
            ? "Enviar enlace de recuperación"
            : "Ingresar"}
      </button>

      <button
        type="button"
        className="min-h-10 w-full text-sm font-semibold underline"
        disabled={loading}
        onClick={() => {
          setRecovering((current) => !current);
          setError("");
        }}
      >
        {recovering
          ? "Volver al inicio de sesión"
          : "Olvidé mi contraseña"}
      </button>
    </form>
  );
}