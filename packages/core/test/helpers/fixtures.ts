import type { VideoScriptJson } from "../../src/content/schema";

export const narration = "Biliyor muydun? Ahtapotların üç kalbi var. İkisi solungaçlara kan pompalar, biri ise tüm vücuda. Üstelik kanları mavi renktedir çünkü bakır bazlı bir protein taşırlar. Doğa gerçekten şaşırtıcı, değil mi? Daha fazlası için takip et!";
export const validScript: VideoScriptJson = {
  title: "Ahtapotların üç kalbi var",
  hook: "Biliyor muydun?",
  narration,
  scenes: [5, 5, 5, 5, 4].map((d, i) => ({ duration: d, visual_description: `Sahne ${i} ahtapot`, search_keywords: ["octopus"], subtitle: `Altyazı ${i}`, scene_3d: { camera: "orbit", objects: [{ shape: (["cat", "sphere", "brain", "coin", "eye"] as const)[i], color: (["#ff6633", "#33aaff", "#bb66ff", "#ffd633", "#33dd99"] as const)[i], x: 0, y: 0, z: 0, size: 0.55, motion: "spin" }] } })),
  cta: "Takip etmeyi unutma",
  hashtags: ["#bilgi", "#doğa", "#ahtapot"],
  platform_metadata: { instagram: {}, facebook: {}, tiktok: {}, youtube: { title: "Ahtapot" } },
};

