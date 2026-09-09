import LoginForm from "./login-form";
import Image from "next/image";

export default function AdminLoginPage() {
  return (
    <main className="grid min-h-screen place-items-center bg-[var(--canvas)] px-5 py-10 text-[var(--ink)]">
      <section className="w-full max-w-md overflow-hidden rounded-[var(--hugella-radius-card)] border border-[var(--hugella-border)] bg-white shadow-[0_2px_10px_rgb(6_31_53/0.06)]">
        <div className="flex justify-center bg-[var(--hugella-navy)] px-8 py-7"><Image src="/hugella-logo.png" alt="HUGELLA Equipamiento Comercial" width={2172} height={724} priority className="hugella-logo w-[210px]" /></div>
        <div className="p-6 sm:p-9"><div><p className="section-kicker">Acceso privado</p><h1 className="text-3xl font-bold tracking-tight">Iniciar sesión</h1><p className="mt-2 text-[var(--muted)]">Ingresá con tu cuenta de administración.</p></div><LoginForm /></div>
      </section>
    </main>
  );
}
