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
  // La RPC pública verifica auth.uid()/es_admin_hugella internamente con su
  // SECURITY DEFINER. No llamar externamente al helper privado sin EXECUTE.
  // Una única llamada de carga, con la sesión real; sin actor ni payload.
  const result = await client.rpc('importar_lote_compras_historicas_admin');
  if (result.error) {
    const denied = result.error.code === '42501' && result.error.message === 'No autorizado';
    const conflict = ['22023', '23514', '25000', 'P0001'].includes(result.error.code);
    return Response.json({ error: denied ? 'Acceso rechazado: se requiere administrador.'
      : conflict ? result.error.message : 'Error técnico: no se pudo confirmar el resultado del lote.' },
    { status: denied ? 403 : conflict ? 409 : 502 });
  }
  return Response.json(result.data, { headers: { 'Cache-Control': 'no-store' } });
}
