'use client';

import { useState } from 'react';

type Result = {
  estado_lote: 'IMPORTADO_CORRECTAMENTE' | 'YA_APLICADO_CORRECTAMENTE';
  compras_historicas: number;
  obligaciones_monetarias: number;
  cortes_historicos: number;
  saldo_pendiente: number;
};
type Preflight = {
  estado_lote: 'LISTO_PARA_IMPORTAR' | 'YA_APLICADO_CORRECTAMENTE' | 'PARCIAL_O_INCONSISTENTE';
  actor_id: string;
  administrador: boolean;
  rol_jwt: string;
  solo_lectura: boolean;
  diagnostico: string | null;
  statement_timeout: string;
  transaction_read_only: string;
};

export default function ImportHistoricalBatch({ importEnabled = false }: { importEnabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [preflight, setPreflight] = useState<Preflight | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');
  async function verify() {
    setBusy(true);
    setError('');
    setPreflight(null);
    try {
      const response = await fetch('/admin/compras/importacion-historica/verificar', { method: 'GET', cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo verificar');
      if (!['LISTO_PARA_IMPORTAR', 'YA_APLICADO_CORRECTAMENTE', 'PARCIAL_O_INCONSISTENTE'].includes(data.estado_lote)
        || data.administrador !== true || data.solo_lectura !== true || data.rol_jwt !== 'authenticated'
        || data.transaction_read_only !== 'on' || typeof data.actor_id !== 'string') {
        throw new Error('No se pudo acreditar un preflight autenticado de sólo lectura');
      }
      setPreflight(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sin respuesta del preflight');
    } finally {
      setBusy(false);
    }
  }
  async function run() {
    if (!importEnabled || preflight?.estado_lote !== 'LISTO_PARA_IMPORTAR') return;
    setBusy(true);
    setError('');
    setResult(null);
    setPreflight(null);
    try {
      const response = await fetch('/admin/compras/importacion-historica/ejecutar', { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo verificar la operación');
      if (!['IMPORTADO_CORRECTAMENTE', 'YA_APLICADO_CORRECTAMENTE'].includes(data.estado_lote)) {
        throw new Error('Respuesta no reconocida');
      }
      setResult(data);
    } catch (cause) {
      setError(`${cause instanceof Error ? cause.message : 'Sin respuesta del servidor'}. Si se perdió la respuesta, usá VERIFICAR para reconocer el estado del lote. Un estado parcial requiere revisión manual.`);
    } finally {
      setBusy(false);
    }
  }
  return <div className="space-y-4">
    <button type="button" disabled={busy} onClick={verify}
      className="min-h-11 rounded border px-4 py-2 disabled:opacity-50">{busy ? 'Procesando…' : 'VERIFICAR sin importar'}</button>
    {preflight && <div role="status">
      <p>Usuario autenticado: {preflight.actor_id} · Admin reconocido · JWT: {preflight.rol_jwt}</p>
      <p>Estado del lote: {preflight.estado_lote}</p>
      <p>Verificación de sólo lectura: no se modificó ningún dato.</p>
      <p>statement_timeout efectivo: {preflight.statement_timeout} · Transacción read-only: {preflight.transaction_read_only}</p>
      {preflight.diagnostico && <p role="alert">{preflight.diagnostico}. Requiere revisión manual.</p>}
    </div>}
    <p>{importEnabled ? 'La importación requiere un preflight listo previo.' : 'IMPORTAR deshabilitado por configuración del servidor.'}</p>
    <button type="button" disabled={!importEnabled || busy || result !== null || preflight?.estado_lote !== 'LISTO_PARA_IMPORTAR'} onClick={run}
      className="min-h-11 rounded bg-[var(--hugella-navy)] px-4 py-2 text-white disabled:opacity-50">IMPORTAR lote aprobado</button>
    {error && <p role="alert">{error}</p>}
    {result && <div role="status">
      <p>{result.estado_lote}</p>
      <p>{result.compras_historicas} compras · {result.obligaciones_monetarias} obligaciones monetarias · {result.cortes_historicos} cortes</p>
      <p>Saldo: {new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(result.saldo_pendiente)}</p>
    </div>}
  </div>;
}
