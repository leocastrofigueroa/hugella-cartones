"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import styles from "../admin.module.css";
import { formatDateAR } from "@/utils/date-format";
import {
  creationMoney,
  creditEconomics,
  focusStyle,
  isAdminClient,
  isCreditCreationResult,
  localDate,
  normalizeDni,
  validateCreditCreation,
  type AdminClient,
  type NewCreditCreationInput,
  type CreditCreationResult,
} from "../admin-types";

type Phase = "editing" | "review" | "sending" | "uncertain" | "success";

type Review = {
  payload: NewCreditCreationInput;
  name: string;
};

type ClientMatch = AdminClient & {
  cantidad_creditos: number;
};

const placeholderId = "00000000-0000-4000-8000-000000000000";

const button = `min-h-12 rounded-lg bg-[var(--hugella-navy)] px-5 py-3 font-semibold text-white disabled:opacity-50 ${focusStyle}`;

const card =
  "space-y-5 rounded-[var(--hugella-radius-card)] border border-[var(--hugella-border)] bg-white p-5 sm:p-7";

export default function NewCreditForm({
  initialClient = null,
  initialPurchase = null,
}: {
  initialClient?: AdminClient | null;
  initialPurchase?: {
    id: string;
    producto: string;
    inversion: string;
  } | null;
}) {
  const [dni, setDni] = useState(
    initialClient ? normalizeDni(initialClient.dni) : ""
  );

  const [lookup, setLookup] = useState<
    "idle" | "loading" | "existing" | "new" | "error"
  >(initialClient ? "existing" : "idle");

  const [client, setClient] = useState<AdminClient | null>(initialClient);

  const [clientMode, setClientMode] = useState<"existing" | "new">(
    "existing"
  );

  const [clientQuery, setClientQuery] = useState(
    initialClient ? initialClient.nombre : ""
  );

  const [clientMatches, setClientMatches] = useState<ClientMatch[]>([]);
  const [clientSearchLoading, setClientSearchLoading] = useState(false);
  const [clientSearchDone, setClientSearchDone] = useState(false);

  const [fields, setFields] = useState({
    nombre: "",
    telefono: "",
    domicilio: "",
    ubicacion: "",
    inversion: initialPurchase?.inversion ?? "",
    producto: initialPurchase?.producto ?? "",
    fecha: localDate(),
    cuotas: "",
    importe: "",
  });

  const [phase, setPhase] = useState<Phase>("editing");
  const [review, setReview] = useState<Review | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<CreditCreationResult | null>(null);

  const searchVersion = useRef(0);
  const clientSearchVersion = useRef(0);
  const busy = useRef(false);
  const intention = useRef<Readonly<NewCreditCreationInput> | null>(null);
  const wasUncertain = useRef(false);

  useEffect(() => {
    if (phase !== "sending" && phase !== "uncertain") return;

    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", warn);

    return () => window.removeEventListener("beforeunload", warn);
  }, [phase]);

  useEffect(() => {
    if (
      initialClient ||
      clientMode !== "existing" ||
      phase !== "editing"
    ) {
      return;
    }

    const query = clientQuery.trim();

    if (query.length < 2) {
      clientSearchVersion.current++;
      setClientMatches([]);
      setClientSearchLoading(false);
      setClientSearchDone(false);
      return;
    }

    const version = ++clientSearchVersion.current;

    const timer = window.setTimeout(async () => {
      setClientSearchLoading(true);
      setClientSearchDone(false);

      try {
        const response = await fetch(
          `/api/admin/clientes/buscar-listado?q=${encodeURIComponent(query)}`,
          {
            method: "GET",
            cache: "no-store",
          }
        );

        const body = await response.json();

        if (version !== clientSearchVersion.current) return;

        if (!response.ok || !body || !Array.isArray(body.clients)) {
          throw new Error();
        }

        const matches = body.clients
          .filter(
            (item: unknown) =>
              isAdminClient(item) &&
              typeof (item as Record<string, unknown>).cantidad_creditos ===
                "number"
          )
          .map(
            (item: unknown) =>
              item as ClientMatch
          );

        setClientMatches(matches);
        setClientSearchDone(true);
      } catch {
        if (version !== clientSearchVersion.current) return;

        setClientMatches([]);
        setClientSearchDone(true);
        setError(
          "No pudimos buscar clientes. Revisá tu sesión y reintentá."
        );
      } finally {
        if (version === clientSearchVersion.current) {
          setClientSearchLoading(false);
        }
      }
    }, 250);

    return () => {
      window.clearTimeout(timer);
    };
  }, [
    clientQuery,
    clientMode,
    initialClient,
    phase,
  ]);

  function changeDni(value: string) {
    searchVersion.current++;
    setDni(normalizeDni(value));
    setLookup("idle");
    setClient(null);
    setError("");
  }

  function changeExistingClientQuery(value: string) {
    clientSearchVersion.current++;
    setClientQuery(value);
    setClient(null);
    setDni("");
    setLookup("idle");
    setClientMatches([]);
    setClientSearchDone(false);
    setError("");
  }

  function selectExistingClient(selected: ClientMatch) {
    clientSearchVersion.current++;

    setClient(selected);
    setDni(normalizeDni(selected.dni));
    setLookup("existing");
    setClientQuery(selected.nombre);
    setClientMatches([]);
    setClientSearchLoading(false);
    setClientSearchDone(false);
    setError("");
  }

  async function searchNewClientDni(event: FormEvent) {
    event.preventDefault();

    if (!/^[0-9]{7,9}$/.test(dni)) {
      setError("El DNI debe contener entre 7 y 9 dígitos.");
      return;
    }

    const version = ++searchVersion.current;

    setLookup("loading");
    setClient(null);
    setError("");

    try {
      const response = await fetch("/api/admin/clientes/buscar", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        cache: "no-store",
        body: JSON.stringify({ dni }),
      });

      const body = await response.json();

      if (version !== searchVersion.current) return;

      if (!response.ok || !body || !("client" in body)) {
        throw new Error();
      }

      if (body.client === null) {
        setLookup("new");

        setFields((old) => ({
          ...old,
          nombre: "",
          telefono: "",
          domicilio: "",
          ubicacion: "",
        }));

        return;
      }

      if (
        isAdminClient(body.client) &&
        normalizeDni(body.client.dni) === dni
      ) {
        setLookup("idle");

        setError(
          `Ese DNI ya pertenece a ${body.client.nombre}. Elegí «Cliente existente» para crearle otro crédito.`
        );

        return;
      }

      throw new Error();
    } catch {
      if (version === searchVersion.current) {
        setLookup("error");

        setError(
          "No pudimos verificar el DNI. Revisá tu sesión y reintentá."
        );
      }
    }
  }

  function prepare(event: FormEvent) {
    event.preventDefault();

    if (lookup !== "new" && lookup !== "existing") return;

    const payload: NewCreditCreationInput = {
      p_operacion_id: placeholderId,
      p_dni: dni,
      p_cliente_nuevo: lookup === "new",
      p_cliente_id_esperado: client?.id ?? null,

      p_nombre: client ? null : fields.nombre.trim(),
      p_telefono: client ? null : fields.telefono.trim() || null,
      p_domicilio: client ? null : fields.domicilio.trim() || null,
      p_ubicacion: client ? null : fields.ubicacion.trim() || null,

      p_inversion: fields.inversion.trim().replace(",", "."),
      p_producto: fields.producto.trim(),
      p_fecha_inicio: fields.fecha,
      p_cantidad_cuotas: Number(fields.cuotas),
      p_importe_cuota: fields.importe.trim().replace(",", "."),
    };

    const invalid = validateCreditCreation(payload);

    if (invalid) {
      setError(invalid);
      return;
    }

    setReview({
      payload,
      name: client?.nombre ?? fields.nombre.trim(),
    });

    setConfirmed(false);
    setError("");
    setPhase("review");
  }

  async function create(event: FormEvent) {
    event.preventDefault();

    if (busy.current || !review || !confirmed) return;

    busy.current = true;

    if (!intention.current) {
      intention.current = Object.freeze({
        ...review.payload,
        p_operacion_id: crypto.randomUUID(),
      });
    }

    const payload = intention.current;

    setPhase("sending");
    setError("");

    try {
      const endpoint = initialPurchase
        ? "/api/admin/creditos/desde-compra"
        : "/api/admin/creditos";

      const requestBody = initialPurchase
        ? {
            ...payload,
            p_compra_gasto_id: initialPurchase.id,
          }
        : payload;

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        cache: "no-store",
        body: JSON.stringify(requestBody),
      });

      const body = await response.json();

      if (
        response.ok &&
        isCreditCreationResult(body?.result, payload)
      ) {
        setResult(body.result);
        setPhase("success");
        return;
      }

      const safeCodes = [
        "VALIDATION",
        "DNI_CONFLICT",
        "IDENTITY",
        "CODE_LIMIT",
        "REJECTED",
        "PURCHASE_ALREADY_LINKED",
        "PURCHASE_ANNULLED",
      ];

      const preflight = [
        "SESSION",
        "PERMISSION",
        "ORIGIN",
      ];

      if (
        !response.ok &&
        body?.outcome === "rejected" &&
        (
          safeCodes.includes(body.code) ||
          (
            !wasUncertain.current &&
            preflight.includes(body.code)
          )
        )
      ) {
        intention.current = null;
        wasUncertain.current = false;

        setPhase("editing");
        setReview(null);

        if (
          ["DNI_CONFLICT", "IDENTITY"].includes(body.code)
        ) {
          setClient(null);
          setLookup("idle");
        }

        setError(
          typeof body.error === "string"
            ? body.error
            : "Revisá los datos y volvé a confirmar."
        );

        return;
      }

      throw new Error();
    } catch {
      wasUncertain.current = true;
      setPhase("uncertain");

      setError(
        "No pudimos confirmar el resultado. Reintentá la misma solicitud. Si tu sesión venció, iniciá sesión en otra pestaña antes de reintentar."
      );
    } finally {
      busy.current = false;
    }
  }

  function reset() {
    intention.current = null;
    wasUncertain.current = false;
    searchVersion.current++;
    clientSearchVersion.current++;

    setClientMode("existing");

    setDni(
      initialClient
        ? normalizeDni(initialClient.dni)
        : ""
    );

    setLookup(
      initialClient
        ? "existing"
        : "idle"
    );

    setClient(initialClient);

    setClientQuery(
      initialClient
        ? initialClient.nombre
        : ""
    );

    setClientMatches([]);
    setClientSearchLoading(false);
    setClientSearchDone(false);

    setReview(null);
    setResult(null);
    setConfirmed(false);
    setError("");

    setFields({
      nombre: "",
      telefono: "",
      domicilio: "",
      ubicacion: "",
      inversion: initialPurchase?.inversion ?? "",
      producto: initialPurchase?.producto ?? "",
      fecha: localDate(),
      cuotas: "",
      importe: "",
    });

    setPhase("editing");
  }

  const field = (
    key: keyof typeof fields,
    label: string,
    type = "text",
    required = true
  ) => (
    <label className="block">
      <span className="field-label">
        {label}
      </span>

      <input
        className="field-control"
        name={key}
        type={type}
        required={required}
        value={fields[key]}
        inputMode={
          key === "importe" ||
          key === "inversion"
            ? "decimal"
            : key === "cuotas"
              ? "numeric"
              : undefined
        }
        onChange={(e) =>
          setFields((old) => ({
            ...old,
            [key]: e.target.value,
          }))
        }
      />
    </label>
  );

  return (
    <div className="space-y-6">
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-red-300 bg-red-50 p-4 text-red-800"
        >
          {error}
        </p>
      )}

      {phase === "editing" && (
        <>
          {!initialClient && (
            <div className={card}>
              <div>
                <h2 className="text-xl font-bold">
                  ¿Qué querés hacer?
                </h2>

                <p className="mt-1 text-sm text-[var(--hugella-navy-secondary)]">
                  Elegí si vas a usar un cliente ya registrado o cargar uno nuevo.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  className={`min-h-12 rounded-lg border px-5 py-3 font-semibold ${
                    clientMode === "existing"
                      ? "border-[var(--hugella-navy)] bg-[var(--hugella-navy)] text-white"
                      : "border-[var(--hugella-border)] bg-white text-[var(--hugella-navy)]"
                  }`}
                  onClick={() => {
                    searchVersion.current++;
                    clientSearchVersion.current++;

                    setClientMode("existing");
                    setLookup("idle");
                    setClient(null);
                    setDni("");
                    setClientQuery("");
                    setClientMatches([]);
                    setClientSearchDone(false);
                    setError("");
                  }}
                >
                  Cliente existente
                </button>

                <button
                  type="button"
                  className={`min-h-12 rounded-lg border px-5 py-3 font-semibold ${
                    clientMode === "new"
                      ? "border-[var(--hugella-navy)] bg-[var(--hugella-navy)] text-white"
                      : "border-[var(--hugella-border)] bg-white text-[var(--hugella-navy)]"
                  }`}
                  onClick={() => {
                    searchVersion.current++;
                    clientSearchVersion.current++;

                    setClientMode("new");
                    setLookup("idle");
                    setClient(null);
                    setDni("");
                    setClientQuery("");
                    setClientMatches([]);
                    setClientSearchDone(false);
                    setError("");
                  }}
                >
                  Cliente nuevo
                </button>
              </div>
            </div>
          )}

          {!initialClient &&
            clientMode === "existing" && (
              <div className={card}>
                <div>
                  <h2 className="text-xl font-bold">
                    Buscar cliente existente
                  </h2>

                  <p className="mt-1 text-sm text-[var(--hugella-navy-secondary)]">
                    Escribí parte del nombre, apellido o DNI.
                  </p>
                </div>

                <label className="block">
                  <span className="field-label">
                    Nombre, apellido o DNI
                  </span>

                  <input
                    className="field-control"
                    type="text"
                    autoComplete="off"
                    value={clientQuery}
                    placeholder="Ej.: Alonso, Mela o 26123456"
                    onChange={(e) =>
                      changeExistingClientQuery(
                        e.target.value
                      )
                    }
                  />
                </label>

                {clientSearchLoading && (
                  <p
                    role="status"
                    className="text-sm text-[var(--hugella-navy-secondary)]"
                  >
                    Buscando clientes…
                  </p>
                )}

                {!clientSearchLoading &&
                  clientQuery.trim().length < 2 &&
                  !client && (
                    <p className="text-sm text-[var(--hugella-navy-secondary)]">
                      Escribí al menos 2 caracteres.
                    </p>
                  )}

                {!clientSearchLoading &&
                  clientSearchDone &&
                  clientQuery.trim().length >= 2 &&
                  clientMatches.length === 0 &&
                  !client && (
                    <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                      No encontramos clientes con esa búsqueda.
                    </p>
                  )}

                {clientMatches.length > 0 && (
                  <div className="overflow-hidden rounded-lg border border-[var(--hugella-border)]">
                    {clientMatches.map((match) => (
                      <button
                        key={match.id}
                        type="button"
                        className="flex w-full items-center justify-between gap-4 border-b border-[var(--hugella-border)] px-4 py-4 text-left last:border-b-0 hover:bg-[var(--hugella-bg)]"
                        onClick={() =>
                          selectExistingClient(match)
                        }
                      >
                        <div className="min-w-0">
                          <p className="font-semibold">
                            {match.nombre}
                          </p>

                          <p className="mt-1 text-sm text-[var(--hugella-navy-secondary)]">
                            DNI {match.dni}
                          </p>
                        </div>

                        <div className="shrink-0 text-right">
                          <p className="text-sm font-semibold">
                            {match.cantidad_creditos === 1
                              ? "1 crédito"
                              : `${match.cantidad_creditos} créditos`}
                          </p>

                          <p className="mt-1 text-xs text-[var(--hugella-navy-secondary)]">
                            Seleccionar
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {client &&
                  lookup === "existing" && (
                    <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-green-900">
                      <p className="font-semibold">
                        Cliente seleccionado
                      </p>

                      <p className="mt-1">
                        {client.nombre}
                      </p>

                      <p className="text-sm">
                        DNI {client.dni}
                      </p>

                      <button
                        type="button"
                        className="mt-3 text-sm font-semibold underline"
                        onClick={() => {
                          setClient(null);
                          setDni("");
                          setLookup("idle");
                          setClientQuery("");
                          setClientMatches([]);
                          setClientSearchDone(false);
                        }}
                      >
                        Cambiar cliente
                      </button>
                    </div>
                  )}
              </div>
            )}

          {!initialClient &&
            clientMode === "new" && (
              <form
                id="client-search-form"
                onSubmit={searchNewClientDni}
                className={card}
              >
                <div>
                  <h2 className="text-xl font-bold">
                    Cliente nuevo
                  </h2>

                  <p className="mt-1 text-sm text-[var(--hugella-navy-secondary)]">
                    Primero verificamos que el DNI no esté registrado.
                  </p>
                </div>

                <label className="block">
                  <span className="field-label">
                    DNI del cliente nuevo
                  </span>

                  <input
                    name="dni"
                    className="field-control"
                    inputMode="numeric"
                    autoComplete="off"
                    value={dni}
                    onChange={(e) =>
                      changeDni(e.target.value)
                    }
                    required
                  />
                </label>

                <button
                  className={button}
                  disabled={lookup === "loading"}
                >
                  {lookup === "loading"
                    ? "Verificando…"
                    : "Verificar DNI"}
                </button>

                {lookup === "new" && (
                  <p
                    role="status"
                    className="text-sm text-green-800"
                  >
                    El DNI está disponible. Completá los datos del cliente nuevo.
                  </p>
                )}
              </form>
            )}

          {(lookup === "existing" ||
            lookup === "new") && (
              <form
                id="credit-data-form"
                className={card}
                onSubmit={prepare}
              >
                <h2 className="text-xl font-bold">
                  Cliente
                </h2>

                {client ? (
                  <dl className="grid gap-3 sm:grid-cols-2">
                    {[
                      ["Nombre", client.nombre],
                      ["DNI", client.dni],
                      ["Teléfono", client.telefono],
                      ["Domicilio", client.domicilio],
                      ["Ubicación", client.ubicacion],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <dt className="font-semibold">
                          {label}
                        </dt>

                        <dd className="[overflow-wrap:anywhere]">
                          {value || "Sin informar"}
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2">
                    {field("nombre", "Nombre")}

                    {field(
                      "telefono",
                      "Teléfono (opcional)",
                      "tel",
                      false
                    )}

                    {field(
                      "domicilio",
                      "Domicilio (opcional)",
                      "text",
                      false
                    )}

                    {field(
                      "ubicacion",
                      "Ubicación / enlace Maps (opcional)",
                      "text",
                      false
                    )}
                  </div>
                )}

                <h2 className="text-xl font-bold">
                  Datos del crédito
                </h2>

                <div className="grid gap-4 sm:grid-cols-2">
                  {field("producto", "Producto")}

                  {field(
                    "fecha",
                    "Fecha de entrega",
                    "date"
                  )}

                  {field(
                    "cuotas",
                    "Cantidad de cuotas"
                  )}

                  {field(
                    "importe",
                    "Importe por cuota"
                  )}

                  {field(
                    "inversion",
                    "Inversión / costo HUGELLA"
                  )}
                </div>

                <p>
                  No se permiten entregas los domingos. El código se asignará automáticamente.
                </p>

                <button className={button}>
                  Revisar crédito
                </button>
              </form>
            )}
        </>
      )}

      {review &&
        ["review", "sending", "uncertain"].includes(
          phase
        ) && (
          <form
            id="credit-confirm-form"
            onSubmit={create}
            className={card}
          >
            <h2 className="text-xl font-bold">
              Revisá antes de crear
            </h2>

            <dl className="grid gap-4 sm:grid-cols-2">
              {[
                ["Cliente", review.name],
                ["DNI", review.payload.p_dni],
                ["Producto", review.payload.p_producto],
                [
                  "Fecha de entrega",
                  formatDateAR(
                    review.payload.p_fecha_inicio
                  ),
                ],
                [
                  "Cuotas",
                  String(
                    review.payload.p_cantidad_cuotas
                  ),
                ],
                [
                  "Importe por cuota",
                  creationMoney(
                    review.payload.p_importe_cuota
                  ),
                ],
                [
                  "Total contractual",
                  creationMoney(
                    review.payload.p_importe_cuota,
                    review.payload.p_cantidad_cuotas
                  ),
                ],
                [
                  "Inversión",
                  creationMoney(
                    review.payload.p_inversion
                  ),
                ],
                [
                  "Ganancia prevista",
                  creditEconomics(
                    review.payload.p_importe_cuota,
                    review.payload.p_cantidad_cuotas,
                    review.payload.p_inversion
                  ).ganancia,
                ],
                [
                  "Cuota de recuperación estimada",
                  creditEconomics(
                    review.payload.p_importe_cuota,
                    review.payload.p_cantidad_cuotas,
                    review.payload.p_inversion
                  ).recuperacion,
                ],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="font-semibold">
                    {label}
                  </dt>

                  <dd>
                    {value}
                  </dd>
                </div>
              ))}
            </dl>

            <p>
              La recuperación es un umbral por cuotas: si supera la cantidad del plan, la inversión no se recupera dentro del crédito. El código se asignará automáticamente al crear el crédito.
            </p>

            <label
              className={`${styles.creditConfirmation} flex items-start gap-3`}
            >
              <input
                type="checkbox"
                className="mt-1 h-5 w-5 shrink-0"
                checked={confirmed}
                disabled={phase !== "review"}
                onChange={(e) =>
                  setConfirmed(e.target.checked)
                }
              />

              <span className="min-w-0 flex-1">
                Confirmo que los datos son correctos y quiero crear este crédito.
              </span>
            </label>

            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                className={button}
                disabled={
                  !confirmed ||
                  phase === "sending"
                }
              >
                {phase === "sending"
                  ? "Creando crédito…"
                  : phase === "uncertain"
                    ? "Reintentar misma solicitud"
                    : "Crear crédito"}
              </button>

              {phase === "review" && (
                <button
                  type="button"
                  className="min-h-12 rounded-lg border px-5"
                  onClick={() => {
                    setPhase("editing");
                    setReview(null);
                  }}
                >
                  Volver a editar
                </button>
              )}
            </div>

            {(phase === "uncertain" ||
              phase === "sending") && (
              <p
                role="status"
                aria-live="polite"
              >
                La intención se conserva solo mientras esta página permanezca abierta. No recargues ni cierres la página: no hay recuperación automática después de hacerlo.
              </p>
            )}
          </form>
        )}

      {phase === "success" &&
        result &&
        review && (
          <section
            className={card}
            aria-live="polite"
          >
            <h2 className="text-xl font-bold">
              Crédito creado correctamente.
            </h2>

            <p className="text-2xl font-bold">
              {result.codigo}
            </p>

            <p>
              Cliente: {review.name}
            </p>

            <p>
              Producto: {review.payload.p_producto}
            </p>

            {initialPurchase && (
              <p>
                Este crédito quedó asociado a la compra registrada.
              </p>
            )}

            {result.ya_procesada && (
              <p>
                Esta solicitud ya estaba procesada.
              </p>
            )}

            <div className="flex flex-col gap-3 sm:flex-row">
              <Link
                href="/admin"
                className={button}
              >
                Volver al Admin
              </Link>

              {!initialPurchase && (
                <button
                  className={button}
                  type="button"
                  onClick={reset}
                >
                  Crear otro crédito
                </button>
              )}
            </div>
          </section>
        )}
    </div>
  );
}