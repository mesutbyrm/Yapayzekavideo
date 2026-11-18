import type { VideoScriptJson } from "../../src/content/schema";

export const narration = "Biliyor muydun? Ahtapotların üç kalbi var. İkisi solungaçlara kan pompalar, biri ise tüm vücuda. Üstelik kanları mavi renktedir çünkü bakır bazlı bir protein taşırlar. Doğa gerçekten şaşırtıcı, değil mi? Daha fazlası için takip et!";
export const validScript: VideoScriptJson = {
  title: "Ahtapotların üç kalbi var",
  hook: "Biliyor muydun?",
  narration,
  scenes: [6, 6, 6, 6].map((d, i) => ({ duration: d, visual_description: `Sahne ${i} ahtapot`, search_keywords: ["octopus"], subtitle: `Altyazı ${i}` })),
  cta: "Takip etmeyi unutma",
  hashtags: ["#bilgi", "#doğa", "#ahtapot"],
  platform_metadata: { instagram: {}, facebook: {}, tiktok: {}, youtube: { title: "Ahtapot" } },
};

