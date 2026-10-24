"use client";

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  focusStyle,
  money,
  type CreditFicha,
} from "./admin-types";
import styles from "./admin.module.css";
import { formatDateAR } from "@/utils/date-format";

type Phase =
  | "editing"
  | "review"
  | "sending"
  | "uncertain"
  | "success";

type Fields = {
  producto: string;
  fecha_inicio: string;
  cantidad_cuotas: string;
  importe_cuota: string;
  inversion: string;
  motivo: string;
};

type EditRequest = {
  p_operacion_id: string;
  p_credito_id: string;
  p_valor_anterior_esperado: {
    producto: string;
    fecha_inicio: string;
    cantidad_cuotas: number;
    importe_cuota: number;
    inversion: number | null;
  };
  p_producto: string;
  p_fecha_inicio: string;
  p_cantidad_cuotas: number;
  p_importe_cuota: string;
  p_inversion: string | null;
  p_motivo: string;
};

type Props = {
  ficha: CreditFicha;
  disabled?: boolean;
  onSaved: () => void | Promise<void>;
};

const buttonPrimary = `min-h-12 rounded-lg bg-[var(--hugella-navy)] px-5 py-3 font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50 ${focusStyle}`;

const buttonSecondary = `min-h-12 rounded-lg border border-[var(--hugella-border)] px-5 py-3 font-semibold transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 ${focusStyle}`;

function initialFields(ficha: CreditFicha): Fields {
  return {
    producto: ficha.producto,
    fecha_inicio: ficha.fecha_inicio,
    cantidad_cuotas: String(ficha.cantidad_cuotas),
    importe_cuota: String(ficha.importe_cuota),
    inversion:
      ficha.inversion === null ? "" : String(ficha.inversion),
    motivo: "",
  };
}

function normalizeDecimal(value: string) {
  return value.trim().replace(",", ".");
}

function validPositiveDecimal(value: string) {
  const normalized = normalizeDecimal(value);

  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(normalized)) {
    return false;
  }

  const parsed = Number(normalized);

  return Number.isFinite(parsed) && parsed > 0;
}

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00Z`);

  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  );
}

function isSunday(value: string) {
  return new Date(`${value}T00:00:00Z`).getUTCDay() === 0;
}

function formatAmount(value: string) {
  const parsed = Number(normalizeDecimal(value));

  return Number.isFinite(parsed)
    ? money.format(parsed)
    : value;
}

export default function CreditEditForm({
  ficha,
  disabled = false,
  onSaved,
}: Props) {
  const [fields, setFields] = useState<Fields>(() =>
    initialFields(ficha)
  );

  const [phase, setPhase] =
    useState<Phase>("editing");

  const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  const busy = useRef(false);

  const intention = useRef<
    Readonly<EditRequest> | null
  >(null);

  const wasUncertain = useRef(false);

  useEffect(() => {
    setFields(initialFields(ficha));
    setPhase("editing");
    setError("");
    setConfirmed(false);
    intention.current = null;
    wasUncertain.current = false;
  }, [ficha]);

  useEffect(() => {
    if (
      phase !== "sending" &&
      phase !== "uncertain"
    ) {
      return;
    }

    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener(
      "beforeunload",
      warn
    );

    return () => {
      window.removeEventListener(
        "beforeunload",
        warn
      );
    };
  }, [phase]);

  function change(
    key: keyof Fields,
    value: string
  ) {
    if (
      phase === "sending" ||
      phase === "uncertain"
    ) {
      return;
    }

    intention.current = null;
    wasUncertain.current = false;
    setConfirmed(false);
    setError("");

    setFields((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function validate() {
    const producto = fields.producto.trim();
    const motivo = fields.motivo.trim();

    if (!producto) {
      return "Ingresá el producto.";
    }

    if (!validDate(fields.fecha_inicio)) {
      return "Ingresá una fecha de entrega válida.";
    }

    if (isSunday(fields.fecha_inicio)) {
      return "La fecha de entrega no puede ser domingo.";
    }

    const cuotas = Number(
      fields.cantidad_cuotas
    );

    if (
      !Number.isInteger(cuotas) ||
      cuotas <= 0
    ) {
      return "La cantidad de cuotas debe ser un número entero mayor que cero.";
    }

    if (
      !validPositiveDecimal(
        fields.importe_cuota
      )
    ) {
      return "El importe de cuota debe ser mayor que cero.";
    }

    if (
      fields.inversion.trim() &&
      !validPositiveDecimal(
        fields.inversion
      )
    ) {
      return "La inversión debe ser mayor que cero o quedar vacía.";
    }

    if (!motivo) {
      return "Ingresá el motivo de la modificación.";
    }

    if (motivo.length > 1000) {
      return "El motivo no puede superar los 1000 caracteres.";
    }

    const inversionNueva =
      fields.inversion.trim() === ""
        ? null
        : Number(
            normalizeDecimal(
              fields.inversion
            )
          );

    const cambio =
      producto !== ficha.producto ||
      fields.fecha_inicio !==
        ficha.fecha_inicio ||
      cuotas !== ficha.cantidad_cuotas ||
      Number(
        normalizeDecimal(
          fields.importe_cuota
        )
      ) !== ficha.importe_cuota ||
      inversionNueva !== ficha.inversion;

    if (!cambio) {
      return "No modificaste ningún dato del crédito.";
    }

    return null;
  }

  function review(event: FormEvent) {
    event.preventDefault();

    const validation = validate();

    if (validation) {
      setError(validation);
      return;
    }

    setError("");
    setConfirmed(false);
    setPhase("review");
  }

  async function save(
    event: FormEvent
  ) {
    event.preventDefault();

    if (
      busy.current ||
      !confirmed
    ) {
      return;
    }

    const validation = validate();

    if (validation) {
      setError(validation);
      setPhase("editing");
      setConfirmed(false);
      return;
    }

    if (!intention.current) {
      intention.current =
        Object.freeze({
          p_operacion_id:
            crypto.randomUUID(),

          p_credito_id:
            ficha.credito_id,

          p_valor_anterior_esperado: {
            producto:
              ficha.producto,

            fecha_inicio:
              ficha.fecha_inicio,

            cantidad_cuotas:
              ficha.cantidad_cuotas,

            importe_cuota:
              ficha.importe_cuota,

            inversion:
              ficha.inversion,
          },

          p_producto:
            fields.producto.trim(),

          p_fecha_inicio:
            fields.fecha_inicio,

          p_cantidad_cuotas:
            Number(
              fields.cantidad_cuotas
            ),

          p_importe_cuota:
            normalizeDecimal(
              fields.importe_cuota
            ),

          p_inversion:
            fields.inversion.trim() === ""
              ? null
              : normalizeDecimal(
                  fields.inversion
                ),

          p_motivo:
            fields.motivo.trim(),
        });
    }

    const payload =
      intention.current;

    busy.current = true;
    setPhase("sending");
    setError("");

    try {
      const response = await fetch(
        "/api/admin/creditos/editar",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          cache: "no-store",
          body: JSON.stringify(payload),
        }
      );

      const body = await response.json();

      if (
        response.ok &&
        body?.result &&
        body.result.operacion_id ===
          payload.p_operacion_id &&
        body.result.credito_id ===
          payload.p_credito_id &&
        typeof body.result
          .ya_procesada === "boolean"
      ) {
        wasUncertain.current = false;
        setPhase("success");
        setError("");

        await onSaved();

        return;
      }

      const safeCodes = [
        "VALIDATION",
        "PERMISSION",
        "NOT_FOUND",
        "STALE_DATA",
        "SUNDAY",
        "NO_CHANGES",
        "HAS_PAYMENTS",
        "ACTIVE_CONTRACT",
        "CLOSED",
        "REJECTED",
      ];

      const preflight = [
        "SESSION",
        "ORIGIN",
      ];

      if (
        !response.ok &&
        body?.outcome === "rejected" &&
        (
          safeCodes.includes(
            body.code
          ) ||
          (
            !wasUncertain.current &&
            preflight.includes(
              body.code
            )
          )
        )
      ) {
        intention.current = null;
        wasUncertain.current = false;
        setPhase("editing");
        setConfirmed(false);

        setError(
          typeof body.error ===
            "string"
            ? body.error
            : "No se pudo guardar la modificación."
        );

        return;
      }

      throw new Error();
    } catch {
      wasUncertain.current = true;
      setPhase("uncertain");

      setError(
        "No pudimos confirmar si la modificación se guardó. Reintentá la misma solicitud sin cerrar ni recargar esta página."
      );
    } finally {
      busy.current = false;
    }
  }

  function backToEditing() {
    if (
      phase === "sending" ||
      phase === "uncertain"
    ) {
      return;
    }

    intention.current = null;
    wasUncertain.current = false;
    setConfirmed(false);
    setError("");
    setPhase("editing");
  }

  function resetAfterSuccess() {
    intention.current = null;
    wasUncertain.current = false;
    setConfirmed(false);
    setError("");
    setPhase("editing");
  }

  const locked =
    disabled ||
    phase === "sending" ||
    phase === "uncertain";

  if (phase === "success") {
    return (
      <section
        className="space-y-4 rounded-lg border border-[var(--hugella-gold)] bg-[var(--hugella-gold)]/10 p-4"
        role="status"
      >
        <h3 className="text-lg font-bold">
          Crédito modificado correctamente
        </h3>

        <p>
          Los cambios fueron guardados y
          auditados.
        </p>

        <button
          type="button"
          onClick={resetAfterSuccess}
          className={buttonSecondary}
        >
          Cerrar edición
        </button>
      </section>
    );
  }

  if (
    phase === "review" ||
    phase === "sending" ||
    phase === "uncertain"
  ) {
    return (
      <form
        onSubmit={save}
        className="space-y-5 rounded-lg border border-[var(--hugella-border)] bg-slate-50 p-4 sm:p-5"
      >
        <div>
          <h3 className="text-lg font-bold">
            Revisá los cambios
          </h3>

          <p className="mt-1 text-sm text-[var(--hugella-navy-secondary)]">
            Crédito {ficha.codigo}
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-sm text-[var(--hugella-navy-secondary)]">
              Producto
            </p>
            <p className="font-semibold [overflow-wrap:anywhere]">
              {ficha.producto}
              {" → "}
              {fields.producto.trim()}
            </p>
          </div>

          <div>
            <p className="text-sm text-[var(--hugella-navy-secondary)]">
              Fecha de entrega
            </p>
            <p className="font-semibold">
              {formatDateAR(
                ficha.fecha_inicio
              )}
              {" → "}
              {formatDateAR(
                fields.fecha_inicio
              )}
            </p>
          </div>

          <div>
            <p className="text-sm text-[var(--hugella-navy-secondary)]">
              Cantidad de cuotas
            </p>
            <p className="font-semibold">
              {ficha.cantidad_cuotas}
              {" → "}
              {fields.cantidad_cuotas}
            </p>
          </div>

          <div>
            <p className="text-sm text-[var(--hugella-navy-secondary)]">
              Importe por cuota
            </p>
            <p className="font-semibold">
              {money.format(
                ficha.importe_cuota
              )}
              {" → "}
              {formatAmount(
                fields.importe_cuota
              )}
            </p>
          </div>

          <div>
            <p className="text-sm text-[var(--hugella-navy-secondary)]">
              Inversión
            </p>
            <p className="font-semibold">
              {ficha.inversion === null
                ? "Sin informar"
                : money.format(
                    ficha.inversion
                  )}
              {" → "}
              {fields.inversion.trim()
                ? formatAmount(
                    fields.inversion
                  )
                : "Sin informar"}
            </p>
          </div>

          <div>
            <p className="text-sm text-[var(--hugella-navy-secondary)]">
              Motivo
            </p>
            <p className="font-semibold [overflow-wrap:anywhere]">
              {fields.motivo.trim()}
            </p>
          </div>
        </div>

        <label className={`${styles.creditConfirmation} flex items-start gap-3 rounded-lg border border-[var(--hugella-border)] bg-white p-4`}>
          <input
            type="checkbox"
            checked={confirmed}
            disabled={locked}
            onChange={(event) =>
              setConfirmed(
                event.target.checked
              )
            }
            className="mt-1 h-5 w-5 shrink-0 accent-[var(--hugella-navy)]"
          />

          <span>
            Confirmo que revisé los datos y
            quiero modificar este crédito.
          </span>
        </label>

        {error && (
          <p
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
          >
            {error}
          </p>
        )}

        <div className="flex flex-col gap-3 sm:flex-row">
          <button
            type="submit"
            disabled={
              !confirmed ||
              phase === "sending"
            }
            className={buttonPrimary}
          >
            {phase === "sending"
              ? "Guardando cambios…"
              : phase === "uncertain"
                ? "Reintentar misma modificación"
                : "Confirmar modificación"}
          </button>

          {phase === "review" && (
            <button
              type="button"
              onClick={backToEditing}
              className={buttonSecondary}
            >
              Volver a editar
            </button>
          )}
        </div>

        {(phase === "sending" ||
          phase === "uncertain") && (
          <p className="text-sm text-[var(--hugella-navy-secondary)]">
            No cierres ni recargues esta página
            hasta confirmar el resultado. La
            misma operación se conserva para
            evitar duplicados.
          </p>
        )}
      </form>
    );
  }

  return (
    <form
      onSubmit={review}
      className="space-y-5 rounded-lg border border-[var(--hugella-border)] bg-slate-50 p-4 sm:p-5"
    >
      <div>
        <h3 className="text-lg font-bold">
          Editar crédito
        </h3>

        <p className="mt-1 text-sm text-[var(--hugella-navy-secondary)]">
          Solo se modificarán los campos que
          aparecen aquí. Código, cliente,
          origen y pagos no se modifican.
        </p>
      </div>

      {ficha.total_pagado_valido > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          Este crédito tiene pagos válidos.
          Podés corregir otros datos, pero el
          sistema bloqueará cambios en cantidad
          de cuotas o importe por cuota.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="field-label">
            Producto
          </span>

          <input
            type="text"
            value={fields.producto}
            disabled={locked}
            onChange={(event) =>
              change(
                "producto",
                event.target.value
              )
            }
            className="field-control"
            required
          />
        </label>

        <label className="block">
          <span className="field-label">
            Fecha de entrega
          </span>

          <input
            type="date"
            value={fields.fecha_inicio}
            disabled={locked}
            onChange={(event) =>
              change(
                "fecha_inicio",
                event.target.value
              )
            }
            className="field-control"
            required
          />
        </label>

        <label className="block">
          <span className="field-label">
            Cantidad de cuotas
          </span>

          <input
            type="number"
            min="1"
            step="1"
            inputMode="numeric"
            value={
              fields.cantidad_cuotas
            }
            disabled={locked}
            onChange={(event) =>
              change(
                "cantidad_cuotas",
                event.target.value
              )
            }
            className="field-control"
            required
          />
        </label>

        <label className="block">
          <span className="field-label">
            Importe por cuota
          </span>

          <input
            type="text"
            inputMode="decimal"
            value={
              fields.importe_cuota
            }
            disabled={locked}
            onChange={(event) =>
              change(
                "importe_cuota",
                event.target.value
              )
            }
            className="field-control"
            required
          />
        </label>

        <label className="block">
          <span className="field-label">
            Inversión / costo HUGELLA
          </span>

          <input
            type="text"
            inputMode="decimal"
            value={fields.inversion}
            disabled={locked}
            onChange={(event) =>
              change(
                "inversion",
                event.target.value
              )
            }
            className="field-control"
          />
        </label>

        <label className="block sm:col-span-2">
          <span className="field-label">
            Motivo de la modificación
          </span>

          <textarea
            value={fields.motivo}
            disabled={locked}
            maxLength={1000}
            rows={3}
            onChange={(event) =>
              change(
                "motivo",
                event.target.value
              )
            }
            className="field-control min-h-24"
            placeholder="Ej.: La mercadería se entregará el miércoles."
            required
          />
        </label>
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={locked}
        className={buttonPrimary}
      >
        Revisar cambios
      </button>
    </form>
  );
}
