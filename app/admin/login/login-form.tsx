"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";

export default function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    const form = new FormData(event.currentTarget);
    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: String(form.get("email") ?? "").trim(),
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

  return (
    <form onSubmit={handleSubmit} className="mt-7 space-y-5">
      <div><label className="field-label" htmlFor="email">Email</label><input className="field-control" id="email" name="email" type="email" autoComplete="email" required /></div>
      <div><label className="field-label" htmlFor="password">Contraseña</label><input className="field-control" id="password" name="password" type="password" autoComplete="current-password" required /></div>
      {error && <p role="alert" className="rounded-[var(--hugella-radius-sm)] border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p>}
      <button disabled={loading} className="min-h-13 w-full rounded-[var(--hugella-radius-sm)] bg-[linear-gradient(135deg,var(--hugella-gold-light),var(--hugella-gold))] px-5 py-3.5 font-bold text-[var(--hugella-navy-deep)] shadow-[inset_0_1px_rgb(255_255_255/0.25)] transition hover:bg-[var(--hugella-gold-light)] disabled:cursor-wait disabled:opacity-60" type="submit">{loading ? "Ingresando…" : "Ingresar"}</button>
    </form>
  );
}
