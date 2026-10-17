"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

type Cliente = {
  id: string;
  nombre: string;
  dni: string | null;
  telefono: string | null;
  domicilio: string | null;
  ubicacion: string | null;
};

export default function ClienteEditForm({
  cliente,
}: {
  cliente: Cliente;
}) {
  const router = useRouter();

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [fields, setFields] = useState({
    nombre: cliente.nombre ?? "",
    dni: cliente.dni ?? "",
    telefono: cliente.telefono ?? "",
    domicilio: cliente.domicilio ?? "",
    ubicacion: cliente.ubicacion ?? "",
  });

  function cancel() {
    setFields({
      nombre: cliente.nombre ?? "",
      dni: cliente.dni ?? "",
      telefono: cliente.telefono ?? "",
      domicilio: cliente.domicilio ?? "",
      ubicacion: cliente.ubicacion ?? "",
    });

    setError("");
    setSuccess("");
    setEditing(false);
  }

  async function save(event: FormEvent) {
    event.preventDefault();

    if (saving) return;

    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const response = await fetch("/api/admin/clientes/actualizar", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        cache: "no-store",
        body: JSON.stringify({
          cliente_id: cliente.id,
          ...fields,
        }),
      });

      const body = await response.json();

      if (!response.ok) {
        setError(
          typeof body?.error === "string"
            ? body.error
            : "No se pudo actualizar el cliente."
        );
        return;
      }

      setSuccess("Datos actualizados correctamente.");
      setEditing(false);

      router.refresh();
    } catch {
      setError("No se pudo actualizar el cliente. Intentá nuevamente.");
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <div className="space-y-4">
        <dl className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="font-semibold">Nombre</dt>
            <dd>{fields.nombre || "Sin informar"}</dd>
          </div>

          <div>
            <dt className="font-semibold">DNI</dt>
            <dd>{fields.dni || "Sin informar"}</dd>
          </div>

          <div>
            <dt className="font-semibold">Teléfono</dt>
            <dd>{fields.telefono || "Sin informar"}</dd>
          </div>

          <div>
            <dt className="font-semibold">Domicilio</dt>
            <dd>{fields.domicilio || "Sin informar"}</dd>
          </div>

          <div className="sm:col-span-2">
            <dt className="font-semibold">Ubicación</dt>
            <dd className="[overflow-wrap:anywhere]">
              {fields.ubicacion || "Sin informar"}
            </dd>
          </div>
        </dl>

        {success && (
          <p className="rounded-lg border border-green-200 bg-green-50 p-3 text-green-800">
            {success}
          </p>
        )}

        <button
          type="button"
          onClick={() => {
            setError("");
            setSuccess("");
            setEditing(true);
          }}
          className="inline-flex min-h-11 items-center rounded-lg border border-[var(--hugella-navy)] px-4 py-2 font-semibold text-[var(--hugella-navy)]"
        >
          Editar datos
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={save} className="space-y-5">
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-red-300 bg-red-50 p-3 text-red-800"
        >
          {error}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="field-label">Nombre</span>
          <input
            className="field-control"
            value={fields.nombre}
            required
            onChange={(event) =>
              setFields((old) => ({
                ...old,
                nombre: event.target.value,
              }))
            }
          />
        </label>

        <label className="block">
          <span className="field-label">DNI</span>
          <input
            className="field-control"
            inputMode="numeric"
            value={fields.dni}
            required
            onChange={(event) =>
              setFields((old) => ({
                ...old,
                dni: event.target.value.replace(/\D/g, ""),
              }))
            }
          />
        </label>

        <label className="block">
          <span className="field-label">Teléfono</span>
          <input
            className="field-control"
            type="tel"
            value={fields.telefono}
            onChange={(event) =>
              setFields((old) => ({
                ...old,
                telefono: event.target.value,
              }))
            }
          />
        </label>

        <label className="block">
          <span className="field-label">Domicilio</span>
          <input
            className="field-control"
            value={fields.domicilio}
            onChange={(event) =>
              setFields((old) => ({
                ...old,
                domicilio: event.target.value,
              }))
            }
          />
        </label>

        <label className="block sm:col-span-2">
          <span className="field-label">
            Ubicación / enlace Maps
          </span>

          <textarea
            className="field-control min-h-24"
            maxLength={2000}
            value={fields.ubicacion}
            onChange={(event) =>
              setFields((old) => ({
                ...old,
                ubicacion: event.target.value,
              }))
            }
          />
        </label>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <button
          type="submit"
          disabled={saving}
          className="min-h-11 rounded-lg bg-[var(--hugella-navy)] px-5 py-3 font-semibold text-white disabled:opacity-50"
        >
          {saving ? "Guardando…" : "Guardar cambios"}
        </button>

        <button
          type="button"
          disabled={saving}
          onClick={cancel}
          className="min-h-11 rounded-lg border px-5 py-3 font-semibold"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
