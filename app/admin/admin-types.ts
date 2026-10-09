export type Credit = {
  credito_id: string;
  nombre_cliente: string;
  codigo_credito: string;
  producto: string;
  importe_cuota: number | string;
  cantidad_cuotas: number;
  cuotas_pagadas: number;
  diferencia_cuotas: number;
  cuotas_pendientes: number;
  estado: string;
};

export type PaymentResult = {
  pago_id: string;
  cuotas_aplicadas: number;
  remanente: number | string;
  cuotas_pagadas: number;
  cuotas_pendientes: number;
};

export type PaymentInput = {
  p_fecha_pago: string;
  p_importe: number;
  p_medio_pago: string;
  p_observaciones: string | null;
};

export type PaymentCorrectionInput = PaymentInput & { p_motivo: string };

export type PaymentCorrectionResult = {
  operacion_id: string;
  pago_original_id: string;
  pago_nuevo_id: string;
  credito_id: string;
  ya_procesada: boolean;
};

export type PaymentHistoryItem = {
  pago_id: string;
  fecha_pago: string;
  importe: number | string;
  medio_pago: string;
  cuotas_aplicadas: number;
  remanente: number | string;
  observaciones: string | null;
  origen: string | null;
  created_at: string;
  estado: "VALIDO" | "ANULADO";
  motivo_anulacion: string | null;
  anulado_at: string | null;
  reemplaza_pago_id: string | null;
};

export type PaymentAnnulmentResult = {
  operacion_id: string;
  pago_id: string;
  credito_id: string;
  estado_pago: "ANULADO";
  anulado_at: string;
  anulado_por: string;
  motivo_anulacion: string;
  estado_credito: string;
  ya_procesada: boolean;
};

export const money = new Intl.NumberFormat("es-AR", {
  style: "currency", currency: "ARS", maximumFractionDigits: 2,
});

export function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export const focusStyle = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--hugella-gold)]";

export type CreditClosureInput = {
  p_tipo: "DEVUELTO" | "RETIRADO";
  p_fecha: string;
  p_motivo: string;
  p_observaciones: string | null;
};

export type CreditClosure = {
  credito_id: string;
  operacion_id: string;
  tipo: CreditClosureInput["p_tipo"];
  fecha: string;
  motivo: string;
  observaciones: string | null;
  actor_id: string;
  created_at: string;
};

export function isClosedCredit(credit: Credit) {
  return credit.estado === "DEVUELTO" || credit.estado === "RETIRADO";
}

export type AdminClient = {
  id: string;
  nombre: string;
  dni: string;
  telefono: string | null;
  domicilio: string | null;
};

export type CreditCreationInput = {
  p_operacion_id: string;
  p_dni: string;
  p_cliente_nuevo: boolean;
  p_cliente_id_esperado: string | null;
  p_nombre: string | null;
  p_telefono: string | null;
  p_domicilio: string | null;
  p_producto: string;
  p_fecha_inicio: string;
  p_cantidad_cuotas: number;
  p_importe_cuota: string;
};

export type CreditCreationResult = {
  operacion_id: string;
  cliente_id: string;
  credito_id: string;
  codigo: string;
  cliente_creado: boolean;
  ya_procesada: boolean;
};

export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const normalizeDni = (value: string) => value.replace(/[^0-9]/g, "");

export function isAdminClient(value: unknown): value is AdminClient {
  if (!value || typeof value !== "object") return false;
  const c = value as Record<string, unknown>;
  return typeof c.id === "string" && uuidPattern.test(c.id)
    && typeof c.nombre === "string" && typeof c.dni === "string"
    && (c.telefono === null || typeof c.telefono === "string")
    && (c.domicilio === null || typeof c.domicilio === "string");
}

export function validateCreditCreation(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Solicitud inválida.";
  const p = value as Record<string, unknown>;
  const keys = ["p_operacion_id", "p_dni", "p_cliente_nuevo", "p_cliente_id_esperado", "p_nombre", "p_telefono", "p_domicilio", "p_producto", "p_fecha_inicio", "p_cantidad_cuotas", "p_importe_cuota"];
  if (Object.keys(p).length !== keys.length || keys.some(key => !Object.hasOwn(p, key))) return "Solicitud inválida.";
  if (typeof p.p_operacion_id !== "string" || !uuidPattern.test(p.p_operacion_id)) return "Identificador de operación inválido.";
  if (typeof p.p_dni !== "string" || !/^[0-9]{7,9}$/.test(p.p_dni)) return "El DNI debe contener entre 7 y 9 dígitos.";
  if (typeof p.p_cliente_nuevo !== "boolean") return "Volvé a buscar al cliente.";
  if (p.p_cliente_nuevo) {
    if (p.p_cliente_id_esperado !== null || typeof p.p_nombre !== "string" || !p.p_nombre.trim()) return "Ingresá el nombre del cliente nuevo.";
    if (![p.p_telefono, p.p_domicilio].every(v => v === null || typeof v === "string")) return "Datos del cliente inválidos.";
  } else if (typeof p.p_cliente_id_esperado !== "string" || !uuidPattern.test(p.p_cliente_id_esperado)
    || p.p_nombre !== null || p.p_telefono !== null || p.p_domicilio !== null) return "El cliente existente debe conservar sus datos. Volvé a buscarlo.";
  if (typeof p.p_producto !== "string" || !p.p_producto.trim()) return "Ingresá el producto.";
  if (typeof p.p_fecha_inicio !== "string" || (!/^\d{4}-\d{2}-\d{2}$/.test(p.p_fecha_inicio) || p.p_fecha_inicio.startsWith("0000"))) return "Ingresá una fecha de entrega válida.";
  const date = new Date(`${p.p_fecha_inicio}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== p.p_fecha_inicio) return "Ingresá una fecha de entrega válida.";
  if (date.getUTCDay() === 0) return "La fecha de entrega no puede ser domingo.";
  if (typeof p.p_cantidad_cuotas !== "number" || !Number.isInteger(p.p_cantidad_cuotas)
    || p.p_cantidad_cuotas < 1 || p.p_cantidad_cuotas > 2147483647) return "Ingresá una cantidad entera de cuotas mayor a cero.";
  if (typeof p.p_importe_cuota !== "string" || !/^\d{1,10}(\.\d{1,2})?$/.test(p.p_importe_cuota)
    || Number(p.p_importe_cuota) <= 0 || Number(p.p_importe_cuota) > 9999999999.99) return "Ingresá un importe positivo con hasta dos decimales (máximo 9.999.999.999,99).";
  return null;
}

export function isCreditCreationResult(value: unknown, input: CreditCreationInput): value is CreditCreationResult {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  return r.operacion_id === input.p_operacion_id
    && typeof r.cliente_id === "string" && uuidPattern.test(r.cliente_id)
    && typeof r.credito_id === "string" && uuidPattern.test(r.credito_id)
    && typeof r.codigo === "string" && /^CR-[0-9]{4,}$/.test(r.codigo)
    && r.cliente_creado === input.p_cliente_nuevo && typeof r.ya_procesada === "boolean"
    && (input.p_cliente_nuevo || r.cliente_id === input.p_cliente_id_esperado);
}

// Integer cents keep the visual total exact even beyond Number's safe integer range.
export function creationMoney(amount: string, installments = 1) {
  const [whole, decimal = ""] = amount.split(".");
  const cents = (BigInt(whole) * BigInt(100) + BigInt(decimal.padEnd(2, "0"))) * BigInt(installments);
  return `$ ${(cents / BigInt(100)).toLocaleString("es-AR")},${String(cents % BigInt(100)).padStart(2, "0")}`;
}
