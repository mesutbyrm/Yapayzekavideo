/** Sunucu açılışında üretim güvenlik kontrolü: eksik/varsayılan sır varsa uygulama başlamaz. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PHASE !== "phase-production-build") {
    const { assertProductionSecrets } = await import("@asf/core");
    assertProductionSecrets();
  }
}
