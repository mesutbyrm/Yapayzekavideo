import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { WordTiming } from "../tts/google";
import { assColor, groupWords, type Cue } from "./subtitles";

/**
 * "Shorts 3D" şablonu: referans videolardaki (Yapay Zekâ Komedisi, Bölüm 1-5) görsel dil.
 * Ölçüler 720x1280 referans karelerden ölçülüp 1080x1920'ye (x1.5) taşındı:
 *  - üstte seri adı hapı (y≈218) + koyu "BÖLÜM N" hapı (y≈302)
 *  - ilk ~3 sn iki satırlık büyük kanca başlığı (2. satır kırmızı)
 *  - ortada sahneye uygun karakter/nesne (AI 3D görsel veya ücretsiz vektör maskot)
 *  - y≈1340'ta 1-3 kelimelik, kalın siyah konturlu BÜYÜK HARF altyazı; anahtar kelimeler sarı/kırmızı
 *  - sahne etiketi (ör. "2017 · MIT") eğik hap olarak
 *  - en altta ilerleme çubuğu (y≈1778), arka planda yumuşak bokeh ışıkları
 *  - kapanışta "TAKİP ET!" + sonraki bölüm hapı
 */

export const SHORTS_TEMPLATE = "shorts3d";
export const SHORTS_FONT = "Montserrat Black";
export const SHORTS_FONT_BOLD = "Montserrat ExtraBold";

const W = 1080;
const H = 1920;
/** libass yazı boyutu → em (px); render edilen karelerden ölçüldü (Montserrat) */
const EM = 0.646;

export const COLORS = { yellow: "#FFE135", red: "#FF2E55", white: "#FFFFFF", ink: "#15122B" } as const;

/** Paketle gelen fontlar (SIL OFL). FONTS_DIR ile değiştirilebilir. */
export function shortsFontsDir(): string | undefined {
  if (process.env.FONTS_DIR) return process.env.FONTS_DIR;
  try {
    const dir = fileURLToPath(new URL("../../assets/fonts", import.meta.url));
    if (existsSync(path.join(dir, "Montserrat-Black.ttf"))) return dir;
  } catch {
    /* paketlenmiş ortamda import.meta.url dosya yolu olmayabilir */
  }
  const fallback = path.resolve(process.cwd(), "packages/core/assets/fonts");
  return existsSync(fallback) ? fallback : undefined;
}

// ---------- renk yardımcıları ----------
function rgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "").padEnd(6, "0");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
export function mix(a: string, b: string, t: number) {
  const x = rgb(a), y = rgb(b);
  return "#" + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("").toUpperCase();
}
const c = (hex: string) => assColor(hex).replace(/^&H00/, "&H") + "&";
const a = (alpha: number) => `&H${Math.max(0, Math.min(255, Math.round(alpha))).toString(16).padStart(2, "0").toUpperCase()}&`;

export interface ShortsTheme {
  pill: string;
  pillShadow: string;
  bgLight: string;
  bgDark: string;
  outline: string;
  bar: string;
}

/** Marka ana renginden referanstaki gibi parlak bir tema türetir */
export function shortsTheme(primary: string): ShortsTheme {
  return {
    pill: mix(primary, "#FFFFFF", 0.12),
    pillShadow: mix(primary, "#000000", 0.5),
    bgLight: mix(primary, "#FFFFFF", 0.12),
    bgDark: mix(primary, "#000000", 0.55),
    outline: mix(primary, "#000000", 0.78),
    bar: mix(primary, "#FFFFFF", 0.3),
  };
}

// ---------- ölçü ve çizim ----------
const NARROW = new Set([..."Iİ1.,!:;'’|"]);
/** Montserrat Black/ExtraBold için yaklaşık metin genişliği (px), size = ASS yazı boyutu */
export function textWidth(s: string, size: number) {
  let w = 0;
  for (const ch of s) {
    if (ch === " ") w += 0.3;
    else if (NARROW.has(ch)) w += 0.33;
    else if (ch === "M") w += 0.95;
    else if (ch === "W") w += 1.2;
    else if (/[0-9]/.test(ch) || "JLFTSZY?".includes(ch)) w += 0.64;
    else if (ch === "-" || ch === "·") w += 0.38;
    else if (/[a-zçğıöşüâî]/.test(ch)) w += 0.62;
    else w += 0.78;
  }
  return w * size * EM;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Sol üst köşesi (0,0) olan yuvarlatılmış dikdörtgen (ASS çizim komutları) */
export function roundedRect(w: number, h: number, r: number) {
  r = Math.min(r, w / 2, h / 2);
  const k = r * 0.4477; // r - r*0.5523
  const p = (n: number) => r1(n);
  return [
    `m ${p(r)} 0`, `l ${p(w - r)} 0`, `b ${p(w - k)} 0 ${p(w)} ${p(k)} ${p(w)} ${p(r)}`,
    `l ${p(w)} ${p(h - r)}`, `b ${p(w)} ${p(h - k)} ${p(w - k)} ${p(h)} ${p(w - r)} ${p(h)}`,
    `l ${p(r)} ${p(h)}`, `b ${p(k)} ${p(h)} 0 ${p(h - k)} 0 ${p(h - r)}`,
    `l 0 ${p(r)}`, `b 0 ${p(k)} ${p(k)} 0 ${p(r)} 0`,
  ].join(" ");
}
export const circle = (r: number) => roundedRect(r * 2, r * 2, r);

function ts(sec: number) {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  let cs = Math.round((s - Math.floor(s)) * 100);
  if (cs === 100) cs = 99;
  return `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}
const esc = (t: string) => t.replace(/\\/g, "＼").replace(/[{}]/g, "").replace(/\n/g, "\\N");
const upper = (t: string) => t.toLocaleUpperCase("tr");

function mulberry32(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Events {
  lines: string[] = [];
  add(layer: number, start: number, end: number, style: string, text: string) {
    if (end - start < 0.02) return;
    this.lines.push(`Dialogue: ${layer},${ts(start)},${ts(end)},${style},,0,0,0,,${text}`);
  }
  /** Ortası (x,y) olan şekil */
  shape(layer: number, start: number, end: number, x: number, y: number, draw: string, color: string, extra = "") {
    this.add(layer, start, end, "Shape", `{\\an5\\pos(${r1(x)},${r1(y)})\\bord0\\shad0\\1c${c(color)}${extra}\\p1}${draw}{\\p0}`);
  }
}

// ---------- vurgulu altyazı ----------
const norm = (w: string) => w.toLocaleLowerCase("tr").replace(/[^\p{L}\p{N}]/gu, "");

export interface Highlights {
  yellow?: string[];
  red?: string[];
}

function matcher(list: string[] | undefined) {
  const set = (list ?? []).flatMap((x) => x.split(/\s+/)).map(norm).filter((x) => x.length >= 2);
  return (w: string) => {
    const n = norm(w);
    if (!n) return false;
    return set.some((h) => n === h || (h.length >= 4 && n.startsWith(h)));
  };
}

/** Hangi kelimenin hangi renkte olacağı: önce senaryodaki listeler, yoksa sayı + en uzun içerik kelimesi */
export function colorWords(words: string[], hl: Highlights, auto: boolean): (string | null)[] {
  const isRed = matcher(hl.red);
  const isYellow = matcher(hl.yellow);
  const out: (string | null)[] = words.map((w) => (isRed(w) ? COLORS.red : isYellow(w) ? COLORS.yellow : null));
  if (auto && !out.some(Boolean)) {
    words.forEach((w, i) => {
      if (/\d/.test(w)) out[i] = COLORS.yellow;
    });
    if (!out.some(Boolean) && words.length >= 2) {
      let best = -1;
      words.forEach((w, i) => {
        if (norm(w).length >= 6 && (best < 0 || norm(w).length > norm(words[best]).length)) best = i;
      });
      if (best >= 0) out[best] = COLORS.yellow;
    }
  }
  return out;
}

const CAPTION_SIZE = 140;
const CAPTION_MAX_W = 940;

/** Kelimeleri 1-2 satıra böler; sığmazsa yazı boyutunu küçültür */
export function layoutCaption(words: string[], size = CAPTION_SIZE, maxW = CAPTION_MAX_W) {
  const U = words.map(upper);
  const width = (ws: string[]) => textWidth(ws.join(" "), size);
  let lines: number[][] = [U.map((_, i) => i)];
  if (U.length >= 2 && width(U) > maxW * 0.82) {
    let best = 1, bestW = Infinity;
    for (let k = 1; k < U.length; k++) {
      const m = Math.max(width(U.slice(0, k)), width(U.slice(k)));
      if (m < bestW) (bestW = m), (best = k);
    }
    lines = [U.slice(0, best).map((_, i) => i), U.slice(best).map((_, i) => i + best)];
  }
  const widest = Math.max(...lines.map((l) => width(l.map((i) => U[i]))));
  const fs = widest > maxW ? Math.floor((size * maxW) / widest) : size;
  return { upper: U, lines, fontSize: fs };
}

export interface ShortsCaption extends Cue {
  ass: string;
}

export function buildShortsCaptions(words: WordTiming[], offset: number, hl: Highlights): ShortsCaption[] {
  const cues = groupWords(words, 3, 16, offset);
  return cues.map((cue) => {
    const ws = cue.text.split(" ");
    const { upper: U, lines, fontSize } = layoutCaption(ws);
    const colors = colorWords(ws, hl, true);
    const body = lines
      .map((l) => l.map((i) => (colors[i] ? `{\\1c${c(colors[i]!)}}${esc(U[i])}{\\1c${c(COLORS.white)}}` : esc(U[i]))).join(" "))
      .join("\\N");
    const fsTag = fontSize !== CAPTION_SIZE ? `\\fs${fontSize}` : "";
    return { ...cue, ass: `{\\an5\\pos(540,1340)${fsTag}\\fscx82\\fscy82\\t(0,90,\\fscx108\\fscy108)\\t(90,170,\\fscx100\\fscy100)}${body}` };
  });
}

// ---------- ana ASS ----------
export interface ShortsAssOptions {
  primaryColor: string;
  durationSec: number;
  seriesName: string;
  episode?: number | null;
  /** "BU BİR|TÜFEK Mİ?!" biçiminde; | satır ayırır, 2. satır kırmızı */
  coverTitle: string;
  hookEndSec: number;
  words: WordTiming[];
  voiceOffset: number;
  highlights: Highlights;
  /** Sahne etiketleri (ör. "2017 · MIT") */
  chips: { start: number; end: number; text: string }[];
  /** Ücretsiz vektör maskotun görüneceği aralıklar (AI görsel/stok yoksa) */
  mascotRanges: { start: number; end: number }[];
  outro: { start: number; end: number; title: string; subtitle?: string | null };
  seed?: number;
}

export function buildShortsAss(o: ShortsAssOptions) {
  const th = shortsTheme(o.primaryColor);
  const T = o.durationSec;
  const ev = new Events();
  const rnd = mulberry32(o.seed ?? 7);

  // Katman 0: bokeh ışıkları ve parıltılar (tüm video)
  for (let i = 0; i < 24; i++) {
    const r = 10 + rnd() * 40;
    const x = rnd() * W, y = rnd() * H;
    const dx = (rnd() - 0.5) * 120, dy = -(80 + rnd() * 260);
    const col = rnd() < 0.5 ? "#FFFFFF" : mix(o.primaryColor, "#FFFFFF", 0.6);
    const alpha = 0xb4 + (r / 50) * 0x28;
    ev.add(0, 0, T, "Shape", `{\\an5\\move(${r1(x)},${r1(y)},${r1(x + dx)},${r1(y + dy)})\\bord0\\shad0\\blur${r1(r * 0.35 + 2)}\\1c${c(col)}\\1a${a(alpha)}\\p1}${circle(r)}{\\p0}`);
  }
  for (let i = 0; i < 14; i++) {
    const r = 3 + rnd() * 4;
    const x = rnd() * W, y = rnd() * H;
    const period = 1.6 + rnd() * 2.4;
    let tr = "";
    for (let t = rnd() * period, k = 0; t < T && k < 60; t += period / 2, k++) {
      const ms = Math.round(t * 1000);
      tr += `\\t(${ms},${ms + Math.round((period / 2) * 1000)},\\1a${a(k % 2 ? 0x30 : 0xd0)})`;
    }
    ev.add(0, 0, T, "Shape", `{\\an5\\move(${r1(x)},${r1(y)},${r1(x + (rnd() - 0.5) * 60)},${r1(y - 40 - rnd() * 120)})\\bord0\\shad0\\blur1.2\\1c&HFFFFFF&\\1a&H30&${tr}\\p1}${circle(r)}{\\p0}`);
  }

  // Katman 1: vektör maskot
  for (const rg of o.mascotRanges) mascot(ev, rg.start, rg.end, o.primaryColor, rnd);

  // Katman 2: ilerleme çubuğu
  const barW = 900, barH = 12, bx = 90, by = 1772;
  ev.shape(2, 0, T, 540, by + barH / 2, roundedRect(barW, barH, 6), "#FFFFFF", `\\1a&H9A&`);
  ev.shape(2, 0, T, 540, by + barH / 2, roundedRect(barW, barH, 6), th.bar, `\\clip(${bx},${by - 10},${bx + 1},${by + barH + 10})\\t(0,${Math.round(T * 1000)},\\clip(${bx},${by - 10},${bx + barW},${by + barH + 10}))`);

  // Katman 3: seri ve bölüm hapları (outro hariç hep görünür)
  pill(ev, 3, 0, T, { x: 540, y: 218, text: upper(o.seriesName), size: 62, font: SHORTS_FONT_BOLD, fg: "#FFFFFF", bg: th.pill, shadow: th.pillShadow, padX: 34 });
  if (o.episode) pill(ev, 3, 0, T, { x: 540, y: 302, text: `BÖLÜM ${o.episode}`, size: 47, font: SHORTS_FONT_BOLD, fg: "#FFFFFF", bg: "#141221", shadow: th.pillShadow, padX: 26, alpha: 0x10 });

  // Katman 3: sahne etiketleri (kanca başlığıyla çakışmasın)
  for (const ch of o.chips) {
    const start = Math.max(ch.start, o.hookEndSec + 0.1);
    if (!ch.text.trim() || ch.end - start < 0.8) continue;
    pill(ev, 3, start, ch.end, { x: 540, y: 560, text: upper(ch.text), size: 76, font: SHORTS_FONT, fg: "#FFFFFF", bg: th.pill, shadow: th.pillShadow, padX: 34, rotate: 4, pop: true });
  }

  // Katman 4: altyazılar (outro kartı başlayınca durur)
  for (const cap of buildShortsCaptions(o.words, o.voiceOffset, o.highlights)) {
    const end = Math.min(cap.end, o.outro.start + 0.05);
    ev.add(4, cap.start, end, "Cap", cap.ass);
  }

  // Katman 5: kanca başlığı
  const [l1, l2] = splitCover(o.coverTitle);
  const hookSize = (s: string, base: number) => Math.min(base, Math.floor((base * 980) / Math.max(1, textWidth(s, base))));
  const hookAnim = `\\fscx70\\fscy70\\t(0,140,\\fscx108\\fscy108)\\t(140,240,\\fscx100\\fscy100)\\fad(0,220)`;
  if (l1) ev.add(5, 0, o.hookEndSec, "Hook", `{\\an5\\pos(540,${l2 ? 462 : 540})\\fs${hookSize(l1, 190)}\\3c${c(th.outline)}${hookAnim}}${esc(l1)}`);
  if (l2) ev.add(5, 0.12, o.hookEndSec, "Hook", `{\\an5\\pos(540,612)\\fs${hookSize(l2, 190)}\\1c${c(COLORS.red)}\\3c${c(th.outline)}${hookAnim}}${esc(l2)}`);

  // Katman 5: kapanış kartı
  pill(ev, 5, o.outro.start, o.outro.end, { x: 540, y: 440, text: upper(o.outro.title), size: 107, font: SHORTS_FONT, fg: "#FFFFFF", bg: th.pill, shadow: th.pillShadow, padX: 44, pop: true });
  if (o.outro.subtitle) {
    pill(ev, 5, o.outro.start + 0.15, o.outro.end, { x: 540, y: 552, text: o.outro.subtitle, size: 58, font: SHORTS_FONT_BOLD, fg: COLORS.ink, bg: "#FFFFFF", shadow: "#000000", padX: 30, rotate: 2, pop: true, shadowAlpha: 0xa0 });
  }

  return header() + ev.lines.join("\n") + "\n";
}

/** "a|b" → [a, b]; | yoksa uzun başlıklar iki dengeli satıra bölünür */
export function splitCover(t: string): [string, string | null] {
  const s = upper(t.trim());
  if (s.includes("|")) {
    const [x, ...rest] = s.split("|");
    return [x.trim(), rest.join(" ").trim() || null];
  }
  const ws = s.split(/\s+/).filter(Boolean);
  if (ws.length < 3 && textWidth(s, 190) <= 980) return [s, null];
  let best = 1, bestW = Infinity;
  for (let k = 1; k < ws.length; k++) {
    const m = Math.max(textWidth(ws.slice(0, k).join(" "), 190), textWidth(ws.slice(k).join(" "), 190));
    if (m < bestW) (bestW = m), (best = k);
  }
  return [ws.slice(0, best).join(" "), ws.slice(best).join(" ")];
}

interface PillOpts {
  x: number;
  y: number;
  text: string;
  size: number;
  font: string;
  fg: string;
  bg: string;
  shadow: string;
  padX: number;
  rotate?: number;
  pop?: boolean;
  alpha?: number;
  shadowAlpha?: number;
}

function pill(ev: Events, layer: number, start: number, end: number, p: PillOpts) {
  const tw = textWidth(p.text, p.size);
  const w = Math.min(1000, tw + p.padX * 2);
  const h = Math.round(p.size * EM * 1.72);
  const fs = tw + p.padX * 2 > 1000 ? Math.floor((p.size * (1000 - p.padX * 2)) / tw) : p.size;
  const rot = p.rotate ? `\\org(${p.x},${p.y})\\frz${p.rotate}` : "";
  const pop = p.pop ? `\\fscx60\\fscy60\\t(0,120,\\fscx110\\fscy110)\\t(120,200,\\fscx100\\fscy100)` : "";
  const fade = p.pop ? `\\fad(0,150)` : "";
  ev.shape(layer, start, end, p.x, p.y + 6, roundedRect(w, h, h / 2), p.shadow, `${rot}${pop}${fade}\\1a${a(p.shadowAlpha ?? 0x40)}`);
  ev.shape(layer, start, end, p.x, p.y, roundedRect(w, h, h / 2), p.bg, `${rot}${pop}${fade}${p.alpha ? `\\1a${a(p.alpha)}` : ""}`);
  ev.add(layer, start, end, "Pill", `{\\an5\\pos(${p.x},${p.y + 1})\\fn${p.font}\\fs${fs}\\1c${c(p.fg)}${rot}${pop}${fade}}${esc(p.text)}`);
}

/** Ücretsiz sahneler için hafifçe süzülen, göz kırpan sevimli robot maskot (vektör) */
function mascot(ev: Events, start: number, end: number, primary: string, rnd: () => number) {
  const cx = 540, cy = 860;
  const bob = 0.9, amp = 14;
  const cyan = "#5CF2FF", white = "#F4F5FA", orange = "#FF9F2E", dark = "#141826";
  const glow = (blur: number, alpha: number) => `\\blur${blur}\\1a${a(alpha)}`;
  const blinks: number[] = [];
  for (let t = start + 0.8 + rnd(); t < end; t += 2.2 + rnd() * 1.8) blinks.push(t);

  // zemin gölgesi (sabit)
  ev.shape(1, start, end, cx, cy + 470, roundedRect(300, 44, 22), mix(primary, "#000000", 0.7), glow(14, 0x70) + "\\fad(200,200)");

  let k = 0;
  for (let t0 = start; t0 < end; t0 += bob, k++) {
    const t1 = Math.min(end, t0 + bob);
    const ya = k % 2 ? amp : -amp, yb = -ya;
    const dur = Math.round((t1 - t0) * 1000);
    const fade = t0 === start ? "\\fad(200,0)" : t1 >= end ? "\\fad(0,200)" : "";
    const part = (dx: number, dy: number, draw: string, color: string, extra = "") =>
      ev.add(1, t0, t1, "Shape", `{\\an5\\move(${r1(cx + dx)},${r1(cy + dy + ya)},${r1(cx + dx)},${r1(cy + dy + yb)},0,${dur})\\bord0\\shad0\\1c${c(color)}${extra}${fade}\\p1}${draw}{\\p0}`);
    const blinkTags = blinks
      .filter((b) => b >= t0 && b < t1 - 0.15)
      .map((b) => {
        const ms = Math.round((b - t0) * 1000);
        return `\\t(${ms},${ms + 70},\\fscy12)\\t(${ms + 70},${ms + 150},\\fscy100)`;
      })
      .join("");

    part(0, -215, circle(40), cyan, glow(18, 0x80));
    part(0, -170, roundedRect(12, 70, 6), "#DADCE8");
    part(0, -215, circle(20), cyan, "\\blur2");
    part(-172, 0, roundedRect(34, 90, 16), orange);
    part(172, 0, roundedRect(34, 90, 16), orange);
    part(0, 0, roundedRect(330, 255, 80), white);
    part(0, 6, roundedRect(256, 176, 48), dark);
    part(-58, -6, roundedRect(46, 66, 20), cyan, glow(12, 0x70) + blinkTags);
    part(58, -6, roundedRect(46, 66, 20), cyan, glow(12, 0x70) + blinkTags);
    part(-58, -6, roundedRect(40, 60, 18), cyan, "\\blur1" + blinkTags);
    part(58, -6, roundedRect(40, 60, 18), cyan, "\\blur1" + blinkTags);
    part(0, 58, roundedRect(74, 14, 7), cyan, "\\blur1");
    part(0, 145, roundedRect(80, 40, 10), "#C9CCDA");
    part(-168, 250, roundedRect(38, 150, 19), white, "\\frz-16");
    part(168, 250, roundedRect(38, 150, 19), white, "\\frz16");
    part(-188, 330, circle(26), orange);
    part(188, 330, circle(26), orange);
    part(0, 262, roundedRect(240, 210, 86), orange);
    part(0, 250, circle(46), cyan, glow(16, 0x80));
    part(0, 250, circle(28), cyan, "\\blur2");
    part(0, 380, roundedRect(120, 40, 14), "#2B2F45");
    part(0, 415, roundedRect(90, 30, 15), cyan, glow(14, 0x60));
  }
}

function header() {
  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 2
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,${SHORTS_FONT},${CAPTION_SIZE},&H00FFFFFF,&H00FFFFFF,&H00000000,&H70000000,0,0,0,0,100,100,0,0,1,8,5,5,0,0,0,1
Style: Hook,${SHORTS_FONT},190,&H00FFFFFF,&H00FFFFFF,&H00000000,&H60000000,0,0,0,0,100,100,0,0,1,10,7,5,0,0,0,1
Style: Pill,${SHORTS_FONT_BOLD},61,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1
Style: Shape,Arial,20,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
}
