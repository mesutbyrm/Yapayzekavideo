import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const fmtNum = (n: number | null | undefined) => (n === null || n === undefined ? "—" : new Intl.NumberFormat("tr-TR").format(n));
export const fmtUsd = (n: number | null | undefined, digits = 2) => (n === null || n === undefined ? "—" : `$${Number(n).toFixed(digits)}`);
export const fmtDate = (d: Date | string | null | undefined, withTime = true) =>
  d ? new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", ...(withTime ? { timeStyle: "short" } : {}), timeZone: "Europe/Istanbul" }).format(new Date(d)) : "—";
export const fmtPct = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `%${(n * 100).toFixed(1)}`);
