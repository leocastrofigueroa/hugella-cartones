import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import NewCreditForm from "./new-credit-form";
import styles from "../admin.module.css";

export default async function NewCreditPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) redirect("/admin/login");
  return <main className={`${styles.root} min-h-screen bg-[var(--hugella-bg)] text-[var(--hugella-navy)]`}>
    <header className="bg-[var(--hugella-navy)] px-5 py-5 text-white"><div className="mx-auto max-w-3xl"><Link href="/admin" className="underline">HUGELLA · Admin</Link></div></header>
    <div className="mx-auto max-w-3xl space-y-6 px-5 py-8"><div><p className="section-kicker">Administración</p><h1 className="text-3xl font-bold">Nuevo crédito</h1><p className="mt-2">Buscá al cliente por DNI para comenzar.</p></div><NewCreditForm /></div>
  </main>;
}
