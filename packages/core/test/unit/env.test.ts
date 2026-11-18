import { afterEach, describe, expect, it } from "vitest";
import { assertProductionSecrets, env, resetEnvCache } from "../../src/lib/env";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
  resetEnvCache();
});

describe("ortam değişkenleri", () => {
  it("boş değerleri tanımsız sayar (varsayılanlar uygulanır)", () => {
    process.env.PUBLIC_MEDIA_BASE_URL = "";
    process.env.OPENAI_MODEL = "";
    resetEnvCache();
    expect(env().PUBLIC_MEDIA_BASE_URL).toBeUndefined();
    expect(env().OPENAI_MODEL).toBe("gpt-5-mini");
  });
  it("üretimde eksik sırlar ve varsayılan veritabanı şifresiyle başlamaz", () => {
    process.env.NODE_ENV = "production";
    process.env.SESSION_SECRET = "";
    process.env.DATABASE_URL = "postgresql://asf:asf_dev_pw@db/asf";
    resetEnvCache();
    expect(() => assertProductionSecrets()).toThrow(/SESSION_SECRET.*DATABASE_URL/);
  });
});
