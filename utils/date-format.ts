export function formatDateAR(
  value: string | null | undefined,
  fallback = "—"
) {
  if (!value) return fallback;

  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);

  if (!match) return fallback;

  const [, year, month, day] = match;

  return `${day}/${month}/${year}`;
}

export function formatDateTimeAR(
  value: string | null | undefined,
  fallback = "—"
) {
  if (!value) return fallback;

  const date = new Date(value);

  if (!Number.isFinite(date.getTime())) {
    return fallback;
  }

  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(date);
}
