import { createClient } from '@/utils/supabase/server';

export async function POST(request: Request) {
  if (process.env.HUGELLA_IMPORTACION_COMPRAS_HISTORICAS !== 'habilitada'
    || process.env.HUGELLA_EJECUTAR_LOTE_HG !== 'habilitada') {
    return Response.json({ error: 'No disponible' }, { status: 404 });
  }
  // Cookies de sesión: rechazar solicitudes de otro origen antes de cualquier RPC.
  if (request.headers.get('origin') !== new URL(request.url).origin) {
    return Response.json({ error: 'Origen no autorizado' }, { status: 403 });
  }
  if ((await request.text()).length !== 0) {
    return Response.json({ error: 'Esta operación no acepta datos' }, { status: 400 });
  }
  const client = await createClient();
  const { data, error } = await client.auth.getClaims();
  if (error || !data?.claims?.sub) {
    return Response.json({ error: 'Sesión requerida' }, { status: 401 });
  }
  const admin = await client.rpc('es_admin_hugella');
  if (admin.error || admin.data !== true) {
    return Response.json({ error: 'No autorizado' }, { status: 403 });
  }
  // Una única llamada de carga, con la sesión real; sin actor ni payload.
  const result = await client.rpc('importar_lote_compras_historicas_admin');
  if (result.error) {
    return Response.json({ error: result.error.message }, { status: 409 });
  }
  return Response.json(result.data, { headers: { 'Cache-Control': 'no-store' } });
}
