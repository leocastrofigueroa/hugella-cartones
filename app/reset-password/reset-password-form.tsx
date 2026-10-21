"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/utils/supabase/client";

export default function ResetPasswordForm() {
  const [supabase] = useState(() => createClient());
  const [ready, setReady] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function prepareRecovery() {
      const url = new URL(window.location.href);

      const code = url.searchParams.get("code");

      if (code) {
        const { error: exchangeError } =
          await supabase.auth.exchangeCodeForSession(code);

        if (cancelled) return;

        if (exchangeError) {
          setInvalid(true);
          setReady(true);
          return;
        }

        window.history.replaceState(
          {},
          document.title,
          "/reset-password",
        );

        setReady(true);
        return;
      }

      const params = new URLSearchParams(window.location.hash.slice(1));

      const accessToken = params.get("access_token");
      const refreshToken = params.get("refresh_token");
      const type = params.get("type");

      if (
        type !== "recovery" ||
        !accessToken ||
        !refreshToken
      ) {
        if (!cancelled) {
          setInvalid(true);
          setReady(true);
        }
        return;
      }

      const { error: sessionError } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });

      if (cancelled) return;

      if (sessionError) {
        setInvalid(true);
        setReady(true);
        return;
      }

      window.history.replaceState(
        {},
        document.title,
        "/reset-password",
      );

      setReady(true);
    }

    void prepareRecovery();

    return () => {
      cancelled = true;
    };
  }, [supabase]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    const confirmPassword = String(
      form.get("confirmPassword") ?? "",
    );

    if (password.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Las contraseñas no coinciden.");
      return;
    }

    setLoading(true);

    const { error: updateError } = await supabase.auth.updateUser({
      password,
    });

    if (updateError) {
      setError(
        "No se pudo actualizar la contraseña. Solicitá un nuevo enlace e intentá nuevamente.",
      );
      setLoading(false);
      return;
    }

    await supabase.auth.signOut();

    setSuccess(true);
    setLoading(false);
  }

  if (!ready) {
    return (
      <p className="mt-7 text-sm text-[var(--muted)]">
        Verificando enlace…
      </p>
    );
  }

  if (invalid) {
    return (
      <div className="mt-7 space-y-5">
        <p
          role="alert"
          className="rounded-[var(--hugella-radius-sm)] border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700"
        >
          Este enlace de recuperación no es válido o ya venció.
        </p>

        <Link className="underline" href="/admin/login">
          Volver al inicio de sesión
        </Link>
      </div>
    );
  }

  if (success) {
    return (
      <div className="mt-7 space-y-5">
        <p className="rounded-[var(--hugella-radius-sm)] border border-green-200 bg-green-50 px-4 py-3 text-sm font-semibold text-green-800">
          Contraseña actualizada correctamente.
        </p>

        <Link
          className="block min-h-13 w-full rounded-[var(--hugella-radius-sm)] bg-[linear-gradient(135deg,var(--hugella-gold-light),var(--hugella-gold))] px-5 py-3.5 text-center font-bold text-[var(--hugella-navy-deep)]"
          href="/admin/login"
        >
          Iniciar sesión
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-7 space-y-5">
      <div>
        <label className="field-label" htmlFor="password">
          Nueva contraseña
        </label>
        <input
          className="field-control"
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
      </div>

      <div>
        <label className="field-label" htmlFor="confirmPassword">
          Repetir contraseña
        </label>
        <input
          className="field-control"
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
      </div>

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
        {loading ? "Guardando…" : "Guardar nueva contraseña"}
      </button>
    </form>
  );
}