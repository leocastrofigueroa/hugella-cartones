export type Credit = {
  credito_id: string;
  nombre_cliente: string;
  codigo_credito: string;
  producto: string;
  importe_cuota: number | string;
  cantidad_cuotas: number;
  cuotas_pagadas: number;
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
};

export const money = new Intl.NumberFormat("es-AR", {
  style: "currency", currency: "ARS", maximumFractionDigits: 2,
});

export function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export const focusStyle = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--hugella-gold)]";
