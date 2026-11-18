import { renderVideo } from "./src/video/render";
import { proportionalTimings, splitWords } from "./src/tts/google";
const text = "Biliyor muydun? Ahtapotların üç kalbi var. İkisi solungaçlara kan pompalar, biri ise vücuda. Üstelik kanları mavi renktedir çünkü bakır bazlı bir protein taşırlar. Doğa gerçekten şaşırtıcı. Daha fazlası için takip etmeyi unutma!";
const t0 = Date.now();
const r = await renderVideo({
  workDir: "/tmp/asf-work/t1",
  scenes: [0,1,2,3].map(i => ({ index: i, kind: "GENERATED", durationSec: 5, provider: "generated", license: "x", commercialUse: true, subtitle: ["Üç kalp", "Mavi kan", "Bakır protein", "Şaşırtıcı doğa"][i] })) as any,
  voicePath: "/tmp/asf-work/t1/voice.mp3", voiceDurationSec: 21,
  words: proportionalTimings(splitWords(text), 21),
  musicPath: null, musicVolume: 0.12, logoPath: null,
  brand: { primaryColor: "#7C3AED", secondaryColor: "#0EA5E9", accentColor: "#F59E0B", font: "DejaVu Sans" },
  title: "Ahtapotların 3 kalbi var!", cta: "Takip etmeyi unutma", minDurationSec: 20, maxDurationSec: 30,
});
console.log(JSON.stringify({ d: r.durationSec, ms: Date.now() - t0, caps: r.captions.length }));
