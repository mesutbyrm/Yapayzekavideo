import { sha256 } from "../lib/crypto";

const STOP = new Set(
  "ve veya ile için bir bu şu o da de mi mı mu mü ne nasıl neden niçin en çok daha gibi kadar her hiç ama fakat ki ya the a an of to in on for and or is are".split(" "),
);

export function normalizeText(s: string) {
  return s
    .toLocaleLowerCase("tr")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ı/g, "i")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokens(s: string) {
  return normalizeText(s)
    .split(" ")
    .filter((t) => t.length > 2 && !STOP.has(t));
}

/** Konu parmak izi: sıralı, benzersiz anlamlı kelimeler */
export function topicFingerprint(topic: string) {
  return sha256([...new Set(tokens(topic))].sort().join(" ")).slice(0, 32);
}

export function narrationHash(narration: string) {
  return sha256(normalizeText(narration));
}

/** Jaccard benzerliği (0-1) – yakın tekrarları yakalamak için */
export function similarity(a: string, b: string) {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

export function isNearDuplicate(candidate: string, existing: string[], threshold = 0.6) {
  return existing.some((e) => similarity(candidate, e) >= threshold);
}
