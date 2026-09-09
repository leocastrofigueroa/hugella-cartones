import Image from "next/image";

export default function CartonNotFound() {
  return (
    <main className="grid min-h-screen place-items-center bg-[var(--canvas)] px-5 text-center text-[var(--ink)]">
      <div className="w-full max-w-md rounded-[var(--hugella-radius-card)] border border-[var(--hugella-border)] bg-white shadow-[0_2px_8px_rgb(6_31_53/0.06)]">
        <div className="flex justify-center rounded-t-[var(--hugella-radius-card)] bg-[var(--hugella-navy)] px-8 py-6"><Image src="/hugella-logo.png" alt="HUGELLA Equipamiento Comercial" width={2172} height={724} className="hugella-logo w-[190px]" /></div>
        <div className="p-8">
        <h1 className="mt-6 text-2xl font-bold">Cartón no encontrado</h1>
        <p className="mt-3 text-[var(--muted)]">El enlace no es válido o el crédito ya no se encuentra disponible.</p>
        <div className="mx-auto mt-6 h-0.5 w-12 bg-[linear-gradient(90deg,var(--hugella-gold-dark),var(--hugella-gold-light))]" />
        </div>
      </div>
    </main>
  );
}
