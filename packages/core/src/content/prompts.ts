import type { Brand, ContentCategory } from "../lib/db";

export function brandContext(brand: Brand, categories: ContentCategory[]) {
  return [
    `Marka: ${brand.name}`,
    brand.description ? `Açıklama: ${brand.description}` : null,
    brand.website ? `Website: ${brand.website}` : null,
    `Dil: ${brand.language}`,
    brand.targetAudience ? `Hedef kitle: ${brand.targetAudience}` : null,
    categories.length ? `İçerik kategorileri: ${categories.map((c) => `${c.name}${c.keywords.length ? ` (${c.keywords.join(", ")})` : ""}`).join("; ")}` : null,
    brand.hashtags.length ? `Tercih edilen hashtagler: ${brand.hashtags.join(" ")}` : null,
    brand.contentRules ? `Marka içerik kuralları:\n${brand.contentRules}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export const IDEAS_SYSTEM = `Sen Türkçe kısa dikey video (Reels/Shorts/TikTok) için içerik stratejistisin.
Kurallar:
- Yalnızca doğrulanabilir, genel kabul görmüş bilgilere dayanan konular öner.
- Tıbbi, finansal veya hukuki kesin vaat içeren konu önerme.
- Telifli eserlerin (şarkı sözü, film sahnesi, kitap bölümü) aktarımına dayanan konu önerme.
- Siyasi propaganda, nefret, şiddet, yetişkin içerik, tehlikeli meydan okumalar yasak.
- Daha önce kullanılan konuları ve onlara çok benzeyenleri tekrar etme.
- Çıktı yalnızca JSON: {"ideas":[{"topic","angle","category","why_now"}]}`;

export function ideasUser(ctx: string, count: number, usedTopics: string[], performanceHints: string[]) {
  return `${ctx}

${count} adet yeni video fikri üret. Her fikir 20-30 saniyede anlatılabilecek kadar odaklı olsun.
${performanceHints.length ? `Gerçek performans verilerine göre iyi çalışan konular/açılar:\n- ${performanceHints.join("\n- ")}\n` : ""}
Daha önce kullanılan konular (TEKRAR ETME):
${usedTopics.length ? usedTopics.map((t) => `- ${t}`).join("\n") : "- (henüz yok)"}`;
}

export const SCRIPT_SYSTEM = `Sen Türkçe kısa dikey video senaristisin. Çıktı yalnızca geçerli JSON olmalı.
Zorunlu kurallar:
1. Toplam süre {MIN}-{MAX} saniye. Sahne süreleri (duration, saniye) toplamı bu aralıkta olmalı. 4-7 sahne kullan.
2. "hook": ilk 2 saniyede söylenecek, merak uyandıran kısa cümle (en fazla 10 kelime). "narration" metni birebir bu hook ile BAŞLAMALI.
3. "narration": seslendirilecek tam metin. Türkçe, akıcı, konuşma dili. Saniyede ~2.5 kelime hesapla ({MINW}-{MAXW} kelime).
4. Son cümle doğal bir etkileşim çağrısı olmalı ve "cta" alanında da yer almalı.
5. Her sahne için "visual_description" (Türkçe sahne tarifi), "search_keywords" (stok video araması için 2-4 İNGİLİZCE anahtar kelime, kişi/marka adı içermesin) ve "subtitle" (ekranda kısa metin, en fazla 8 kelime).
6. Yalnızca doğrulanabilir genel bilgiler kullan. Emin olmadığın sayı/tarih/istatistik verme. Kesin sağlık/finans vaadi verme.
7. Şarkı sözü, film repliği, telifli metin alıntısı KULLANMA. Gerçek kişileri karalama.
8. "hashtags": 5-10 adet, # ile başlayan, boşluksuz, Türkçe karakter kullanılabilir. #kesfet gibi genel etiketlerin yanında konuya özel etiketler.
9. "platform_metadata": instagram/facebook/tiktok/youtube için ayrı "title" (YouTube için en fazla 90 karakter, #Shorts ekle), "caption" (platform diline uygun, 1-3 cümle + hashtagler), "description", "hashtags".
10. "fact_check_notes": metindeki iddiaların neden güvenilir olduğunu kısaca açıkla.`;

export function scriptSystem(minSec: number, maxSec: number) {
  return SCRIPT_SYSTEM.replace("{MIN}", String(minSec))
    .replace("{MAX}", String(maxSec))
    .replace("{MINW}", String(Math.round(minSec * 2.2)))
    .replace("{MAXW}", String(Math.round(maxSec * 2.5)));
}

export function scriptUser(ctx: string, topic: string, angle: string | null | undefined, feedback?: string[]) {
  return `${ctx}

Konu: ${topic}
${angle ? `Açı: ${angle}` : ""}
${feedback?.length ? `\nÖNCEKİ DENEMEDEKİ HATALAR (bunları düzelt):\n- ${feedback.join("\n- ")}` : ""}`;
}
