import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import ImportHistoricalBatch from './import-historical-batch';

export default async function Page() {
  const mode = process.env.HUGELLA_IMPORTACION_COMPRAS_HISTORICAS;
  if (mode !== 'verificar' && mode !== 'habilitada') notFound();
  const client = await createClient();
  const { data, error } = await client.auth.getClaims();
  if (error || !data?.claims?.sub) redirect('/admin/login');
  // Sólo pantalla de acceso pendiente. VERIFICAR acredita admin mediante la
  // RPC pública read-only; no invocar el helper privado ni preflight al abrir.
  return <section className="space-y-4">
    <h1 className="text-2xl font-bold">Carga histórica aprobada de Compras</h1>
    <p>Sesión autenticada. Acceso administrativo pendiente: VERIFICAR comprobará tu autorización y el estado del lote sin modificar datos.</p>
    <ImportHistoricalBatch importEnabled={mode === 'habilitada' && process.env.HUGELLA_EJECUTAR_LOTE_HG === 'habilitada'} />
  </section>;
}
