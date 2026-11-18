import { moderate } from "../ai/openai";
import type { VideoScriptJson } from "./schema";
import { normalizeText } from "./fingerprint";

/**
 * İçerik güvenlik kontrolleri.
 * 1) OpenAI Moderation (zararlı içerik)
 * 2) Telif riski sezgileri (şarkı sözü, uzun alıntı, marka/karakter isimleri)
 * 3) Yanıltıcı iddia sezgileri (kesin sağlık/finans vaatleri)
 */
const RISKY_CLAIMS = [
  /kesin(likle)? (tedavi|iyileş|kazan)/i,
  /garanti(li)? (kazanç|getiri|zayıfla)/i,
  /%\s?100 (etkili|garanti)/i,
  /doktor(lar)? (bunu )?bilmenizi istemiyor/i,
  /mucize (tedavi|ilaç|kür)/i,
  /zengin ol(manın)? (kesin|garanti)/i,
];

const COPYRIGHT_PATTERNS = [
  /şarkı sözleri?/i,
  /\blyrics?\b/i,
  /(film|dizi) replikleri/i,
  /"[^"]{120,}"/, // çok uzun alıntı
];

export interface SafetyReport {
  ok: boolean;
  flags: string[];
  blocking: string[];
}

export function heuristicSafety(script: VideoScriptJson, bannedTerms: string[] = []): SafetyReport {
  const text = [script.title, script.hook, script.narration, script.cta, ...script.scenes.map((s) => s.subtitle)].join("\n");
  const flags: string[] = [];
  const blocking: string[] = [];
  for (const re of RISKY_CLAIMS) if (re.test(text)) blocking.push(`yanıltıcı_iddia:${re.source}`);
  for (const re of COPYRIGHT_PATTERNS) if (re.test(text)) blocking.push(`telif_riski:${re.source}`);
  const norm = normalizeText(text);
  for (const t of bannedTerms) if (t && norm.includes(normalizeText(t))) blocking.push(`yasakli_ifade:${t}`);
  if (/\b(19|20)\d{2}\b/.test(text) || /\d+([.,]\d+)?\s?(%|milyon|milyar)/.test(text)) {
    flags.push("doğrulanması_gereken_sayısal_veri");
  }
  return { ok: blocking.length === 0, flags, blocking };
}

export async function fullSafety(script: VideoScriptJson, bannedTerms: string[] = []): Promise<SafetyReport> {
  const h = heuristicSafety(script, bannedTerms);
  const text = [script.title, script.narration, script.platform_metadata.youtube.description ?? ""].join("\n");
  const m = await moderate(text);
  if (m.flagged) h.blocking.push(...m.categories.map((c) => `moderasyon:${c}`));
  h.ok = h.blocking.length === 0;
  return h;
}
