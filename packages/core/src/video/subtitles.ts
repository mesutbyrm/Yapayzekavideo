import type { WordTiming } from "../tts/google";

export interface Cue {
  start: number;
  end: number;
  text: string;
}

/**
 * Kelime zamanlamalarını mobilde okunaklı kısa ifadelere böler:
 * en fazla 4 kelime / 22 karakter; noktalama işaretinde kesilir.
 */
export function groupWords(words: WordTiming[], maxWords = 4, maxChars = 22, offset = 0): Cue[] {
  const cues: Cue[] = [];
  let cur: WordTiming[] = [];
  const flush = () => {
    if (!cur.length) return;
    cues.push({ start: cur[0].start + offset, end: cur[cur.length - 1].end + offset, text: cur.map((w) => w.word).join(" ") });
    cur = [];
  };
  for (const w of words) {
    const len = cur.map((x) => x.word).join(" ").length + w.word.length + 1;
    if (cur.length >= maxWords || (cur.length && len > maxChars)) flush();
    cur.push(w);
    if (/[.!?…;:,]$/.test(w.word)) flush();
  }
  flush();
  // Boşlukları kapat, minimum gösterim süresi 0.35 sn
  for (let i = 0; i < cues.length; i++) {
    const next = cues[i + 1];
    if (next && next.start - cues[i].end < 0.25) cues[i].end = next.start;
    if (cues[i].end - cues[i].start < 0.35) cues[i].end = cues[i].start + 0.35;
    if (next && cues[i].end > next.start) cues[i].end = next.start;
  }
  return cues;
}

/** #RRGGBB → ASS &HAABBGGRR */
export function assColor(hex: string, alpha = 0) {
  const h = hex.replace("#", "").padEnd(6, "0");
  const r = h.slice(0, 2), g = h.slice(2, 4), b = h.slice(4, 6);
  return `&H${alpha.toString(16).padStart(2, "0").toUpperCase()}${b}${g}${r}`.toUpperCase();
}

function ts(sec: number) {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const cs = Math.round((s - Math.floor(s)) * 100);
  const ss = Math.floor(s % 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}.${String(cs === 100 ? 99 : cs).padStart(2, "0")}`;
}

const esc = (t: string) => t.replace(/\\/g, "＼").replace(/[{}]/g, "").replace(/\n/g, "\\N");

export interface AssOptions {
  font: string;
  primaryColor: string;
  accentColor: string;
  captions: Cue[];
  headlines: Cue[];
  intro?: { text: string; end: number };
  outro?: { text: string; start: number; end: number };
}

export function buildAss(o: AssOptions) {
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,${o.font},86,&H00FFFFFF,&H003DD8FF,&H64000000,&H96000000,-1,0,0,0,100,100,0,0,1,7,2,2,80,80,520,1
Style: Headline,${o.font},56,&H00FFFFFF,&H00FFFFFF,${assColor(o.primaryColor, 0x20)},&H00000000,-1,0,0,0,100,100,0,0,3,18,0,8,110,110,250,1
Style: Intro,${o.font},92,&H00FFFFFF,&H00FFFFFF,${assColor(o.primaryColor, 0x10)},&H00000000,-1,0,0,0,100,100,0,0,3,26,0,5,90,90,0,1
Style: Outro,${o.font},84,&H00FFFFFF,&H00FFFFFF,${assColor(o.accentColor, 0x00)},&H80000000,-1,0,0,0,100,100,0,0,1,0,6,5,90,90,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const lines: string[] = [];
  if (o.intro) lines.push(`Dialogue: 3,${ts(0)},${ts(o.intro.end)},Intro,,0,0,0,,{\\fad(150,350)\\t(0,250,\\fscx106\\fscy106)\\t(250,500,\\fscx100\\fscy100)}${esc(o.intro.text)}`);
  for (const h of o.headlines) lines.push(`Dialogue: 1,${ts(h.start)},${ts(h.end)},Headline,,0,0,0,,{\\fad(200,200)}${esc(h.text)}`);
  for (const c of o.captions) {
    const words = c.text.toLocaleUpperCase("tr").split(/\s+/).filter(Boolean);
    const totalCs = Math.max(words.length, Math.round((c.end - c.start) * 100));
    const totalChars = words.reduce((n, word) => n + word.length, 0) || 1;
    let remaining = totalCs;
    const karaoke = words.map((word, i) => {
      const duration = i === words.length - 1 ? remaining : Math.max(1, Math.round(totalCs * word.length / totalChars));
      remaining -= duration;
      return "{\\kf" + duration + "}" + esc(word);
    }).join(" ");
    lines.push("Dialogue: 2," + ts(c.start) + "," + ts(c.end) + ",Caption,0,0,0,,{\\fad(80,60)\\fscx108\\fscy108\\t(0,100,\\fscx100\\fscy100)}" + karaoke);
  }
  if (o.outro) lines.push(`Dialogue: 3,${ts(o.outro.start)},${ts(o.outro.end)},Outro,,0,0,0,,{\\fad(300,0)\\move(540,1060,540,1000,0,400)}${esc(o.outro.text)}`);
  return header + lines.join("\n") + "\n";
}
