import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, hmac, pkcePair, safeEqual, sha256 } from "../../src/lib/crypto";
import { createHash } from "node:crypto";

describe("AES-256-GCM token şifreleme", () => {
  it("şifreler ve çözer; düz metin çıktıda görünmez", () => {
    const enc = encryptSecret("gizli-token-123", "oauth:acc1");
    expect(enc).not.toContain("gizli-token-123");
    expect(enc).toMatch(/^v\d+:[^:]+:[^:]+:[^:]+$/);
    expect(decryptSecret(enc, "oauth:acc1")).toBe("gizli-token-123");
  });
  it("aynı metin her seferinde farklı IV ile şifrelenir", () => {
    expect(encryptSecret("x")).not.toBe(encryptSecret("x"));
  });
  it("farklı AAD (başka hesap) ile çözülemez", () => {
    const enc = encryptSecret("tok", "oauth:acc1");
    expect(() => decryptSecret(enc, "oauth:acc2")).toThrow();
  });
  it("değiştirilmiş şifreli metin reddedilir", () => {
    const enc = encryptSecret("tok");
    const parts = enc.split(":");
    const ct = Buffer.from(parts[3], "base64");
    ct[0] ^= 0xff;
    parts[3] = ct.toString("base64");
    expect(() => decryptSecret(parts.join(":"))).toThrow();
  });
});

describe("yardımcı kripto", () => {
  it("sha256 / hmac / safeEqual", () => {
    expect(sha256("a")).toHaveLength(64);
    expect(hmac("k", "d")).toBe(hmac("k", "d"));
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
  it("PKCE challenge = base64url(sha256(verifier))", () => {
    const p = pkcePair() as any;
    const verifier = p.verifier ?? p.codeVerifier;
    const challenge = p.challenge ?? p.codeChallenge;
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
  });
});
