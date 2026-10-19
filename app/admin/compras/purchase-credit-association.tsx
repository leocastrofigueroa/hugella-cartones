"use client";

import { useState } from "react";
import { createClient } from "@/utils/supabase/client";
import CreditResults from "../credit-results";
import {
  buttonStyle,
  cardStyle,
  inputStyle,
} from "./purchase-types";
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

    if (!normalized) {
      return;
    }

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

  return (
    <section className={`${cardStyle} space-y-5`}>
      <div>
        <h2 className="text-xl font-semibold">
          Asociación con crédito
        </h2>

        <p className="mt-1 text-sm text-slate-600">
          Podés dejar la compra sin asociar, vincularla a un crédito existente
          o crear un crédito nuevo después de registrar la compra.
        </p>
      </div>

      <fieldset
        disabled={disabled}
        className="grid gap-3"
      >
        <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border p-4">
          <input
            type="radio"
            name="purchase-credit-mode"
            value="NONE"
            checked={mode === "NONE"}
            onChange={() => changeMode("NONE")}
          />

          <span>
            <strong className="block">No asociar ahora</strong>
            <span className="text-sm text-slate-600">
              La compra se registra normalmente y puede asociarse después.
            </span>
          </span>
        </label>

        <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border p-4">
          <input
            type="radio"
            name="purchase-credit-mode"
            value="EXISTING"
            checked={mode === "EXISTING"}
            onChange={() => changeMode("EXISTING")}
          />

          <span>
            <strong className="block">
              Asociar a crédito existente
            </strong>
            <span className="text-sm text-slate-600">
              Buscá el crédito y vinculá esta compra al mismo.
            </span>
          </span>
        </label>

        <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border p-4">
          <input
            type="radio"
            name="purchase-credit-mode"
            value="NEW"
            checked={mode === "NEW"}
            onChange={() => changeMode("NEW")}
          />

          <span>
            <strong className="block">
              Crear crédito nuevo con esta compra
            </strong>
            <span className="text-sm text-slate-600">
              Después de registrar la compra iremos a Nuevo crédito con el
              producto y la inversión precargados.
            </span>
          </span>
        </label>
      </fieldset>

      {mode === "EXISTING" && (
        <div className="space-y-4 rounded-lg border bg-slate-50 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="min-w-0 flex-1">
              <span className="font-semibold">
                Buscar crédito
              </span>

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
              <p className="text-sm">
                {selectedCredit.producto}
              </p>
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
            Luego te llevaremos al alta de crédito usando los datos reales de
            esta compra.
          </p>
        </div>
      )}
    </section>
  );
}
