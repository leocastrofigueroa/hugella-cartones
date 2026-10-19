"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { formatDateAR, formatDateTimeAR } from "@/utils/date-format";

export type HonorarioRetiro = {
  id: string;
  fecha: string;
  persona: string;
  tipo: string;
  importe: number | string;
  medio: string;
  observaciones: string | null;
  estado: string;
  actor_id: string;
  actor_email: string | null;
  created_at: string;
  motivo_anulacion: string | null;
  anulado_por: string | null;
  anulado_por_email: string | null;
  anulado_at: string | null;
};

const money = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  minimumFractionDigits: 2,
});

function todayArgentina() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function tipoLabel(tipo: string) {
  switch (tipo) {
    case "HONORARIO":
      return "Honorario";
    case "ADELANTO":
      return "Adelanto";
    case "RETIRO_EXTRAORDINARIO":
      return "Retiro extraordinario";
    default:
      return tipo;
  }
}

function medioLabel(medio: string) {
  switch (medio) {
    case "EFECTIVO":
      return "Efectivo";
    case "TRANSFERENCIA":
      return "Transferencia";
    case "OTRO":
      return "Otro";
    default:
      return medio;
  }
}

export default function HonorariosClient({
  movimientos,
}: {
  movimientos: HonorarioRetiro[];
}) {
  const router = useRouter();
  const supabase = createClient();

  const [fecha, setFecha] = useState(todayArgentina());
  const [persona, setPersona] = useState("");
  const [tipo, setTipo] = useState("HONORARIO");
  const [importe, setImporte] = useState("");
  const [medio, setMedio] = useState("EFECTIVO");
  const [observaciones, setObservaciones] = useState("");

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [anulandoId, setAnulandoId] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");
  const [procesandoAnulacion, setProcesandoAnulacion] = useState(false);

  async function registrar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setError("");
    setSuccess("");

    const valor = Number(importe);

    if (!persona.trim()) {
      setError("Ingresá la persona que recibe el honorario o retiro.");
      return;
    }

    if (!Number.isFinite(valor) || valor <= 0) {
      setError("Ingresá un importe válido mayor a cero.");
      return;
    }

    setGuardando(true);

    const { error: rpcError } = await supabase.rpc(
      "registrar_honorario_retiro_admin",
      {
        p_operacion_id: crypto.randomUUID(),
        p_fecha: fecha,
        p_persona: persona.trim(),
        p_tipo: tipo,
        p_importe: valor,
        p_medio: medio,
        p_observaciones: observaciones.trim() || null,
      }
    );

    if (rpcError) {
      setError(rpcError.message);
      setGuardando(false);
      return;
    }

    setSuccess("Movimiento registrado correctamente.");
    setPersona("");
    setImporte("");
    setObservaciones("");
    setGuardando(false);

    router.refresh();
  }

  async function confirmarAnulacion(id: string) {
    const motivoLimpio = motivo.trim();

    if (!motivoLimpio) {
      setError("Ingresá el motivo de la anulación.");
      return;
    }

    setError("");
    setSuccess("");
    setProcesandoAnulacion(true);

    const { error: rpcError } = await supabase.rpc(
      "anular_honorario_retiro_admin",
      {
        p_honorario_retiro_id: id,
        p_operacion_id: crypto.randomUUID(),
        p_motivo: motivoLimpio,
      }
    );

    if (rpcError) {
      setError(rpcError.message);
      setProcesandoAnulacion(false);
      return;
    }

    setSuccess("Movimiento anulado correctamente.");
    setAnulandoId(null);
    setMotivo("");
    setProcesandoAnulacion(false);

    router.refresh();
  }

  return (
    <>
      <section className="rounded-xl border border-[var(--hugella-border)] bg-white p-5 sm:p-6">
        <div className="mb-5">
          <p className="section-kicker">Nuevo movimiento</p>
          <h2 className="mt-1 text-xl font-bold">
            Registrar honorario o retiro
          </h2>
        </div>

        <form onSubmit={registrar} className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="field-label">Fecha</label>
            <input
              type="date"
              className="field-control"
              value={fecha}
              onChange={(event) => setFecha(event.target.value)}
              required
            />
          </div>

          <div>
            <label className="field-label">Persona</label>
            <input
              type="text"
              className="field-control"
              value={persona}
              onChange={(event) => setPersona(event.target.value)}
              placeholder="Ej.: Leo"
              maxLength={120}
              required
            />
          </div>

          <div>
            <label className="field-label">Tipo</label>
            <select
              className="field-control"
              value={tipo}
              onChange={(event) => setTipo(event.target.value)}
            >
              <option value="HONORARIO">Honorario</option>
              <option value="ADELANTO">Adelanto</option>
              <option value="RETIRO_EXTRAORDINARIO">
                Retiro extraordinario
              </option>
            </select>
          </div>

          <div>
            <label className="field-label">Importe</label>
            <input
              type="number"
              className="field-control"
              value={importe}
              onChange={(event) => setImporte(event.target.value)}
              min="0.01"
              step="0.01"
              placeholder="0,00"
              required
            />
          </div>

          <div>
            <label className="field-label">Medio</label>
            <select
              className="field-control"
              value={medio}
              onChange={(event) => setMedio(event.target.value)}
            >
              <option value="EFECTIVO">Efectivo</option>
              <option value="TRANSFERENCIA">Transferencia</option>
              <option value="OTRO">Otro</option>
            </select>
          </div>

          <div>
            <label className="field-label">Observaciones</label>
            <input
              type="text"
              className="field-control"
              value={observaciones}
              onChange={(event) => setObservaciones(event.target.value)}
              placeholder="Opcional"
              maxLength={2000}
            />
          </div>

          <div className="md:col-span-2">
            <button
              type="submit"
              disabled={guardando}
              className="min-h-12 rounded-lg bg-[var(--hugella-navy)] px-5 py-3 font-semibold text-white disabled:opacity-60"
            >
              {guardando ? "Guardando…" : "Registrar movimiento"}
            </button>
          </div>
        </form>

        {error && (
          <p className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            {error}
          </p>
        )}

        {success && (
          <p className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">
            {success}
          </p>
        )}
      </section>

      <section className="rounded-xl border border-[var(--hugella-border)] bg-white p-5 sm:p-6">
        <div className="mb-5">
          <p className="section-kicker">Historial</p>
          <h2 className="mt-1 text-xl font-bold">
            Honorarios y retiros registrados
          </h2>

          <p className="mt-1 text-sm text-[var(--hugella-navy-secondary)]">
            Los movimientos anulados se conservan para mantener la auditoría.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1050px] text-left text-sm">
            <thead>
              <tr className="border-b">
                <th className="py-3 pr-4">Fecha</th>
                <th className="py-3 pr-4">Persona</th>
                <th className="py-3 pr-4">Tipo</th>
                <th className="py-3 pr-4 text-right">Importe</th>
                <th className="py-3 pr-4">Medio</th>
                <th className="py-3 pr-4">Observación</th>
                <th className="py-3 pr-4">Estado</th>
                <th className="py-3 text-right">Acción</th>
              </tr>
            </thead>

            <tbody>
              {movimientos.map((movimiento) => {
                const anulado = movimiento.estado === "ANULADO";

                return (
                  <tr
                    key={movimiento.id}
                    className={
                      anulado
                        ? "border-b border-red-100 bg-red-50"
                        : "border-b border-[var(--hugella-border)]"
                    }
                  >
                    <td className="whitespace-nowrap py-4 pr-4">
                      {formatDateAR(movimiento.fecha)}
                    </td>

                    <td className="py-4 pr-4 font-semibold">
                      {movimiento.persona}
                    </td>

                    <td className="py-4 pr-4">
                      {tipoLabel(movimiento.tipo)}
                    </td>

                    <td
                      className={`whitespace-nowrap py-4 pr-4 text-right font-bold ${
                        anulado ? "text-red-700 line-through" : ""
                      }`}
                    >
                      {money.format(Number(movimiento.importe))}
                    </td>

                    <td className="py-4 pr-4">
                      {medioLabel(movimiento.medio)}
                    </td>

                    <td className="py-4 pr-4">
                      {anulado
                        ? movimiento.motivo_anulacion || "Anulado"
                        : movimiento.observaciones || "—"}
                    </td>

                    <td className="py-4 pr-4">
                      <span
                        className={
                          anulado
                            ? "rounded-full bg-red-100 px-3 py-1 text-xs font-bold text-red-800"
                            : "rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800"
                        }
                      >
                        {anulado ? "ANULADO" : "VÁLIDO"}
                      </span>

                      {anulado && movimiento.anulado_at && (
                        <p className="mt-2 text-xs text-red-700">
                          {formatDateTimeAR(movimiento.anulado_at)}
                        </p>
                      )}
                    </td>

                    <td className="py-4 text-right">
                      {!anulado && (
                        <button
                          type="button"
                          onClick={() => {
                            setAnulandoId(movimiento.id);
                            setMotivo("");
                            setError("");
                            setSuccess("");
                          }}
                          className="rounded-lg border border-red-300 px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-50"
                        >
                          Anular
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}

              {movimientos.length === 0 && (
                <tr>
                  <td
                    colSpan={8}
                    className="py-10 text-center text-[var(--hugella-navy-secondary)]"
                  >
                    Todavía no hay honorarios ni retiros registrados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {anulandoId && (
        <section className="rounded-xl border border-red-200 bg-red-50 p-5">
          <h2 className="font-bold text-red-900">
            Anular movimiento
          </h2>

          <p className="mt-2 text-sm text-red-800">
            El movimiento no será eliminado. Quedará registrado como anulado.
          </p>

          <label className="mt-4 block text-sm font-semibold text-red-900">
            Motivo de la anulación
          </label>

          <textarea
            value={motivo}
            onChange={(event) => setMotivo(event.target.value)}
            rows={3}
            maxLength={1000}
            className="mt-2 w-full rounded-lg border border-red-300 bg-white px-3 py-2"
          />

          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              disabled={procesandoAnulacion}
              onClick={() => confirmarAnulacion(anulandoId)}
              className="rounded-lg bg-red-700 px-4 py-2 font-semibold text-white disabled:opacity-60"
            >
              {procesandoAnulacion
                ? "Anulando…"
                : "Confirmar anulación"}
            </button>

            <button
              type="button"
              disabled={procesandoAnulacion}
              onClick={() => {
                setAnulandoId(null);
                setMotivo("");
              }}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 font-semibold"
            >
              Cancelar
            </button>
          </div>
        </section>
      )}
    </>
  );
}
