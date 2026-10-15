import { createClient } from '@/utils/supabase/server';

export async function GET(request: Request) {
  const mode = process.env.HUGELLA_IMPORTACION_COMPRAS_HISTORICAS;
  if (mode !== 'verificar' && mode !== 'habilitada') {
    return Response.json({ error: 'No disponible' }, { status: 404 });
  }
  if (new URL(request.url).search) {
    return Response.json({ error: 'La verificación no acepta parámetros' }, { status: 400 });
  }
  const client = await createClient();
  const { data, error } = await client.auth.getClaims();
  if (error || !data?.claims?.sub) {
    return Response.json({ error: 'Sesión requerida' }, { status: 401 });
  }
  // GET PostgREST: RPC STABLE en transacción READ ONLY, sin invocar importador.
  const result = await client.rpc('verificar_lote_hg_admin', undefined, { get: true });
  if (result.error) {
    return Response.json({ error: result.error.code === '42501' ? 'No autorizado' : 'No se pudo completar el preflight' },
      { status: result.error.code === '42501' ? 403 : 502, headers: { 'Cache-Control': 'no-store' } });
  }
  return Response.json(result.data, { headers: { 'Cache-Control': 'private, no-store' } });
}
