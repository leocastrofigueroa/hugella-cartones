"use client";

import { useState } from "react";
import { createClient } from "@/utils/supabase/client";
import CreditResults from "../credit-results";
import { buttonStyle, cardStyle, inputStyle } from "./purchase-types";
import type { Credit } from "../admin-types";

export type PurchaseCreditMode = "NONE" | "EXISTING" | "NEW";

type Props = {
  mode: PurchaseCreditMode;
  selectedCredit: Credit | null;
  disabled?: boolean;
  onModeChange: (mode: PurchaseCreditMode) => void;
  onCreditChange: (credit: Credit | null) => void;
};

export default function PurchaseCreditAssociation({
  mode,
  selectedCredit,
  disabled = false,
  onModeChange,
  onCreditChange,
}: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Credit[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");

  async function searchCredits() {
    const normalized = query.trim();

    setError("");
    setResults([]);
    onCreditChange(null);

    if (!normalized) return;

    setSearching(true);

    try {
      const { data, error: searchError } = await createClient().rpc(
        "buscar_creditos_admin",
        {
          p_busqueda: normalized,
        }
      );

      if (searchError) {
        setError(
          searchError.code === "42501"
            ? "Tu cuenta no tiene permisos de administración."
            : "No se pudo buscar el crédito."
        );
        return;
      }

      if (data !== null && !Array.isArray(data)) {
        throw new Error();
      }

      setResults((data ?? []) as Credit[]);
    } catch {
      setError(
        "No se pudo realizar la búsqueda. Revisá tu conexión e intentá nuevamente."
      );
    } finally {
      setSearching(false);
    }
  }

  function changeMode(nextMode: PurchaseCreditMode) {
    setError("");
    setResults([]);
    setQuery("");
    onCreditChange(null);
    onModeChange(nextMode);
  }

  function optionClass(active: boolean) {
    return [
      "grid cursor-pointer grid-cols-[auto_1fr] items-start gap-3 rounded-xl border p-4 transition",
      active
        ? "border-[var(--hugella-navy)] bg-slate-50"
        : "border-[var(--hugella-border)] bg-white hover:bg-slate-50",
      disabled ? "cursor-not-allowed opacity-60" : "",
    ].join(" ");
  }

  const radioClass =
    "!mt-1 !h-5 !w-5 !min-h-0 !min-w-0 shrink-0 accent-[var(--hugella-navy)]";

  return (
    <section className={`${cardStyle} space-y-4`}>
      <div>
        <h2 className="text-xl font-semibold">Asociación con crédito</h2>

        <p className="mt-1 text-sm text-[var(--hugella-navy-secondary)]">
          Elegí qué querés hacer con esta compra de mercadería.
        </p>
      </div>

      <fieldset disabled={disabled} className="grid gap-3">
        <label className={optionClass(mode === "NONE")}>
          <input
            className={radioClass}
            type="radio"
            name="purchase-credit-mode"
            value="NONE"
            checked={mode === "NONE"}
            onChange={() => changeMode("NONE")}
          />

          <span className="min-w-0">
            <strong className="block">No asociar ahora</strong>
            <span className="mt-1 block text-sm text-[var(--hugella-navy-secondary)]">
              La compra se registra normalmente y puede asociarse después.
            </span>
          </span>
        </label>

        <label className={optionClass(mode === "EXISTING")}>
          <input
            className={radioClass}
            type="radio"
            name="purchase-credit-mode"
            value="EXISTING"
            checked={mode === "EXISTING"}
            onChange={() => changeMode("EXISTING")}
          />

          <span className="min-w-0">
            <strong className="block">Asociar a crédito existente</strong>
            <span className="mt-1 block text-sm text-[var(--hugella-navy-secondary)]">
              Buscá el crédito y vinculá esta compra al mismo.
            </span>
          </span>
        </label>

        <label className={optionClass(mode === "NEW")}>
          <input
            className={radioClass}
            type="radio"
            name="purchase-credit-mode"
            value="NEW"
            checked={mode === "NEW"}
            onChange={() => changeMode("NEW")}
          />

          <span className="min-w-0">
            <strong className="block">
              Crear crédito nuevo con esta compra
            </strong>
            <span className="mt-1 block text-sm text-[var(--hugella-navy-secondary)]">
              Después de registrar la compra iremos a Nuevo crédito con el
              producto y la inversión precargados.
            </span>
          </span>
        </label>
      </fieldset>

      {mode === "EXISTING" && (
        <div className="space-y-4 rounded-xl border border-[var(--hugella-border)] bg-slate-50 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="min-w-0 flex-1">
              <span className="field-label">Buscar crédito</span>

              <input
                className={inputStyle}
                value={query}
                disabled={disabled || searching}
                placeholder="Código, cliente o producto"
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void searchCredits();
                  }
                }}
              />
            </label>

            <button
              type="button"
              className={buttonStyle}
              disabled={disabled || searching || !query.trim()}
              onClick={() => void searchCredits()}
            >
              {searching ? "Buscando…" : "Buscar crédito"}
            </button>
          </div>

          {error && (
            <p
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-800"
            >
              {error}
            </p>
          )}

          {results.length > 0 && (
            <CreditResults
              credits={results}
              selectedId={selectedCredit?.credito_id}
              disabled={disabled || searching}
              onSelect={onCreditChange}
            />
          )}

          {selectedCredit && (
            <div className="rounded-lg border border-green-300 bg-green-50 p-4">
              <p className="font-bold">
                Crédito seleccionado: {selectedCredit.codigo_credito}
              </p>
              <p>{selectedCredit.nombre_cliente}</p>
              <p className="text-sm">{selectedCredit.producto}</p>
            </div>
          )}
        </div>
      )}

      {mode === "NEW" && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
          <p className="font-semibold">
            Primero se registrará la compra.
          </p>
          <p className="mt-1 text-sm">
            Luego continuaremos con el alta del crédito usando los datos reales
            de esta compra.
          </p>
        </div>
      )}
    </section>
  );
}
