import type { FormEvent } from "react";
import { focusStyle } from "./admin-types";

type Props = {
  query: string;
  disabled: boolean;
  searching: boolean;
  onChange: (value: string) => void;
  onSearch: () => void;
};

export default function CreditSearch({ query, disabled, searching, onChange, onSearch }: Props) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSearch();
  }

  return (
    <form onSubmit={submit} aria-busy={searching}>
      <label className="field-label" htmlFor="search">Buscar cliente o crédito</label>
      <div className="flex flex-col gap-3 sm:flex-row">
        <input id="search" type="search" value={query} onChange={(event) => onChange(event.target.value)} disabled={disabled} autoComplete="off" aria-describedby="search-hint" className="field-control min-w-0 flex-1 disabled:opacity-60" placeholder="Nombre del cliente o código" />
        <button type="submit" disabled={disabled || !query.trim()} className={`min-h-12 rounded-[var(--hugella-radius-sm)] bg-[var(--hugella-navy)] px-6 py-3 font-bold text-white transition hover:bg-[var(--hugella-navy-secondary)] disabled:cursor-not-allowed disabled:opacity-60 ${focusStyle}`}>
          {searching ? "Buscando…" : "Buscar"}
        </button>
      </div>
      <p id="search-hint" className="mt-2 text-sm text-[var(--hugella-navy-secondary)]">Ingresá el nombre del cliente o el código del crédito.</p>
    </form>
  );
}
