import { DateTime } from "luxon";

export const DEFAULT_TZ = "Europe/Istanbul";

export function monthRange(tz = DEFAULT_TZ, at: Date = new Date()) {
  const d = DateTime.fromJSDate(at, { zone: tz });
  return { start: d.startOf("month").toJSDate(), end: d.endOf("month").toJSDate() };
}

export function dayRange(tz = DEFAULT_TZ, at: Date = new Date()) {
  const d = DateTime.fromJSDate(at, { zone: tz });
  return { start: d.startOf("day").toJSDate(), end: d.endOf("day").toJSDate() };
}

export function weekRange(tz = DEFAULT_TZ, at: Date = new Date()) {
  const d = DateTime.fromJSDate(at, { zone: tz });
  return { start: d.startOf("week").toJSDate(), end: d.endOf("week").toJSDate() };
}

/** "HH:mm" doğrulaması */
export function isValidHHmm(s: string) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

/** Verilen yerel gün + saat için UTC Date */
export function localSlot(dateISO: string, hhmm: string, tz = DEFAULT_TZ): Date {
  const [h, m] = hhmm.split(":").map(Number);
  return DateTime.fromISO(dateISO, { zone: tz }).set({ hour: h, minute: m, second: 0, millisecond: 0 }).toJSDate();
}

export function localDateISO(at: Date = new Date(), tz = DEFAULT_TZ) {
  return DateTime.fromJSDate(at, { zone: tz }).toISODate()!;
}

/** Luxon weekday: 1=Pazartesi … 7=Pazar */
export function localWeekday(dateISO: string, tz = DEFAULT_TZ) {
  return DateTime.fromISO(dateISO, { zone: tz }).weekday;
}
