export const MALAYSIA_TIME_ZONE = "Asia/Kuala_Lumpur";
export const MALAYSIA_TIME_LABEL = "MYT";

const malaysiaDateTimeFormatter = new Intl.DateTimeFormat("en-MY", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: MALAYSIA_TIME_ZONE
});

export function formatMalaysiaDateTime(value: string | Date | null | undefined, fallback = "Not available") {
  if (!value) return fallback;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : `${malaysiaDateTimeFormatter.format(date)} ${MALAYSIA_TIME_LABEL}`;
}

export function malaysiaDateTimeLocalToIso(value: string) {
  const normalized = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ? `${value}:00` : value;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(normalized)) return null;
  const date = new Date(`${normalized}+08:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
