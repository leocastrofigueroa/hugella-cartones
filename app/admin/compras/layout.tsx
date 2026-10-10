import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import styles from '../admin.module.css';
export default async function PurchasesLayout({ children }: { children: React.ReactNode }) {
  const client = await createClient();
  const { data, error } = await client.auth.getClaims();
  if (error || !data?.claims?.sub) redirect('/admin/login');
  return <main className={`${styles.root} min-h-screen bg-[var(--hugella-bg)] text-[var(--hugella-navy)]`}>
    <header className="bg-[var(--hugella-navy)] px-5 py-5 text-white"><div className="mx-auto max-w-5xl"><Link href="/admin" className="underline">HUGELLA · Admin</Link></div></header>
    <div className="mx-auto max-w-5xl space-y-6 px-5 py-8">{children}</div>
  </main>;
}
