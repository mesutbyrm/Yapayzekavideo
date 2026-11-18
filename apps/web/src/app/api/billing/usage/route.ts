import { DateTime } from "luxon";
import { accessibleBrandIds, costReport, budgetStatus, DEFAULT_TZ } from "@asf/core";
import { api, ok } from "@/lib/api";

/** Maliyet raporu: ?range=day|week|month|90d &brandId= */
export const GET = api(async ({ user, req }) => {
  const sp = req.nextUrl.searchParams;
  const ids = await accessibleBrandIds(user);
  const brandId = sp.get("brandId");
  const range = sp.get("range") ?? "month";
  const now = DateTime.now().setZone(DEFAULT_TZ);
  const from = range === "day" ? now.startOf("day") : range === "week" ? now.startOf("week") : range === "90d" ? now.minus({ days: 90 }) : now.startOf("month");
  const granularity = range === "90d" ? "week" : "day";
  const scope = brandId && ids.includes(brandId) ? [brandId] : user.role === "ADMIN" ? null : ids;
  const report = await costReport(scope, from.toJSDate(), now.toJSDate(), granularity);
  const budget = await budgetStatus(brandId && ids.includes(brandId) ? brandId : null);
  return ok({ report, budget, range });
});
