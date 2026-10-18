"use client";

import { useMemo, useState } from "react";
import { formatDateAR } from "@/utils/date-format";

export type Cobro = {
  numero_registro: number | string;
  pago_id: string;
  fecha_pago: string;
  cliente: string;
  codigo_credito: string;
  producto: string;
  importe: number | string;
  medio_pago: string | null;
  estado: string;
  origen: string | null;
  observaciones: string | null;
  motivo_anulacion: string | null;
  created_at: string;
};

const money = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  minimumFractionDigits: 2,
});

function asNumber(value: number | string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalize(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export default function CobrosClient({ cobros }: { cobros: Cobro[] }) {
  const [busqueda, setBusqueda] = useState("");
  const [estado, setEstado] = useState("TODOS");
  const [medio, setMedio] = useState("TODOS");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");

  const medios = useMemo(
    () =>
      Array.from(
        new Set(
          cobros
            .map((cobro) => cobro.medio_pago)
            .filter((value): value is string => Boolean(value))
        )
      ).sort((a, b) => a.localeCompare(b, "es")),
    [cobros]
  );

  const filtrados = useMemo(() => {
    const texto = normalize(busqueda);

    return cobros.filter((cobro) => {
      const coincideTexto =
        !texto ||
        normalize(cobro.cliente).includes(texto) ||
        normalize(cobro.codigo_credito).includes(texto) ||
        normalize(cobro.producto).includes(texto) ||
        String(cobro.numero_registro).includes(texto);

      const coincideEstado =
        estado === "TODOS" || cobro.estado === estado;

      const coincideMedio =
        medio === "TODOS" || cobro.medio_pago === medio;

      const coincideDesde =
        !desde || cobro.fecha_pago >= desde;

      const coincideHasta =
        !hasta || cobro.fecha_pago <= hasta;

      return (
        coincideTexto &&
        coincideEstado &&
        coincideMedio &&
        coincideDesde &&
        coincideHasta
      );
    });
  }, [cobros, busqueda, estado, medio, desde, hasta]);

  const totalFiltrado = filtrados
    .filter((cobro) => cobro.estado === "VALIDO")
    .reduce((total, cobro) => total + asNumber(cobro.importe), 0);

  function limpiarFiltros() {
    setBusqueda("");
    setEstado("TODOS");
    setMedio("TODOS");
    setDesde("");
    setHasta("");
  }

  return (
    <section className="rounded-xl border border-[var(--hugella-border)] bg-white p-5 sm:p-6">
      <div className="mb-5">
        <h2 className="text-xl font-bold">Todos los cobros</h2>
        <p className="mt-1 text-sm text-[var(--hugella-navy-secondary)]">
          Del registro más reciente al más antiguo.
        </p>
      </div>

      <div className="mb-6 grid gap-4 rounded-xl border border-[var(--hugella-border)] bg-slate-50 p-4 lg:grid-cols-6">
        <div className="lg:col-span-2">
          <label className="mb-1 block text-xs font-bold uppercase tracking-wide">
            Buscar
          </label>
          <input
            type="text"
            value={busqueda}
            onChange={(event) => setBusqueda(event.target.value)}
            placeholder="Cliente, crédito, producto o registro"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-bold uppercase tracking-wide">
            Estado
          </label>
          <select
            value={estado}
            onChange={(event) => setEstado(event.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5"
          >
            <option value="TODOS">Todos</option>
            <option value="VALIDO">Válidos</option>
            <option value="ANULADO">Anulados</option>
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs font-bold uppercase tracking-wide">
            Medio
          </label>
          <select
            value={medio}
            onChange={(event) => setMedio(event.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5"
          >
            <option value="TODOS">Todos</option>
            {medios.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs font-bold uppercase tracking-wide">
            Desde
          </label>
          <input
            type="date"
            value={desde}
            onChange={(event) => setDesde(event.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-bold uppercase tracking-wide">
            Hasta
          </label>
          <input
            type="date"
            value={hasta}
            onChange={(event) => setHasta(event.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5"
          />
        </div>
      </div>

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-[var(--hugella-navy-secondary)]">
            Registros encontrados
          </p>
          <p className="text-xl font-bold">{filtrados.length}</p>
        </div>

        <div>
          <p className="text-sm text-[var(--hugella-navy-secondary)]">
            Total válido filtrado
          </p>
          <p className="text-xl font-bold">
            {money.format(totalFiltrado)}
          </p>
        </div>

        <button
          type="button"
          onClick={limpiarFiltros}
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 font-semibold hover:bg-slate-100"
        >
          Limpiar filtros
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-[1550px] w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b-2 border-[var(--hugella-border)] bg-slate-50">
              <th className="w-[90px] px-4 py-4">Registro</th>
              <th className="w-[110px] px-4 py-4">Fecha</th>
              <th className="w-[190px] px-4 py-4">Cliente</th>
              <th className="w-[100px] px-4 py-4">Crédito</th>
              <th className="w-[270px] px-4 py-4">Producto</th>
              <th className="w-[140px] px-4 py-4 text-right">Importe</th>
              <th className="w-[140px] px-4 py-4">Medio</th>
              <th className="w-[110px] px-4 py-4">Estado</th>
              <th className="w-[110px] px-4 py-4">Origen</th>
              <th className="min-w-[240px] px-4 py-4">Observaciones</th>
            </tr>
          </thead>

          <tbody>
            {filtrados.map((cobro) => (
              <tr
                key={cobro.pago_id}
                className={
                  cobro.estado === "ANULADO"
                    ? "border-b border-red-100 bg-red-50"
                    : "border-b border-[var(--hugella-border)] hover:bg-slate-50"
                }
              >
                <td className="px-4 py-4 font-bold">
                  #{cobro.numero_registro}
                </td>
                <td className="whitespace-nowrap px-4 py-4">
                  {formatDateAR(cobro.fecha_pago)}
                </td>
                <td className="px-4 py-4 font-semibold">
                  {cobro.cliente}
                </td>
                <td className="whitespace-nowrap px-4 py-4 font-medium">
                  {cobro.codigo_credito}
                </td>
                <td className="px-4 py-4">{cobro.producto}</td>
                <td className="whitespace-nowrap px-4 py-4 text-right font-semibold">
                  {money.format(asNumber(cobro.importe))}
                </td>
                <td className="whitespace-nowrap px-4 py-4">
                  {cobro.medio_pago || "—"}
                </td>
                <td className="px-4 py-4">
                  <span
                    className={
                      cobro.estado === "ANULADO"
                        ? "rounded-full bg-red-100 px-3 py-1 text-xs font-bold text-red-800"
                        : "rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800"
                    }
                  >
                    {cobro.estado}
                  </span>
                </td>
                <td className="px-4 py-4">
                  {cobro.origen || "—"}
                </td>
                <td className="px-4 py-4">
                  {cobro.estado === "ANULADO"
                    ? cobro.motivo_anulacion || "Anulado"
                    : cobro.observaciones || "—"}
                </td>
              </tr>
            ))}

            {filtrados.length === 0 && (
              <tr>
                <td
                  colSpan={10}
                  className="px-4 py-10 text-center text-[var(--hugella-navy-secondary)]"
                >
                  No hay cobros que coincidan con los filtros.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
