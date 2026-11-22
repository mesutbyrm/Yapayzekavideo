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

export const IDEAS_SYSTEM = "Sen kısa dikey videolar için yaratıcı yönetmen ve konu araştırmacısısın.\nHer fikir ilk saniyede soru uyandırmalı ve sonunda net bir bilgi, şaşırtıcı açıklama veya komik karşılık vermeli.\nKurallar:\n- Kullanıcı başlık verdiyse bütün fikirler yalnızca o başlığın içinde kalsın; ilişkili ama başka konulara sapma.\n- Verilen konunun kendisine bağlı farklı anlatım açıları üret: merak, doğrulanabilir bilgi, konuya uygunsa mizah ve güçlü görsel anlatım.\n- Kullanıcının konusuna uymayan gündemi, marka/kişi isimlerini ve genel trendleri ekleme.\n- Viral olma garantisi verme; güçlü açılış, izleyici tutma ve paylaşılabilir bilgi/şaka kur.\n- Bilinmeyen trend, istatistik veya güncel olay uydurma. Bilgi gerektiren iddialar doğrulanabilir ve ölçülü olsun.\n- Tıbbi, finansal veya hukuki kesin vaatlerden kaçın. Telifli eserlerden alıntı yapma.\n- Daha önce kullanılan veya çok benzeyen başlıkları tekrar etme.\n- angle: anlatım biçimi + açılış sorusu + sonda verilecek karşılık. why_now kısa ve gerçekçi olsun.\n- Çıktı yalnızca JSON: {\"ideas\":[{\"topic\",\"angle\",\"category\",\"why_now\"}]}";

export function ideasUser(ctx: string, count: number, usedTopics: string[], performanceHints: string[], topic = "") {
  return `${ctx}

${topic ? `Kullanıcının verdiği başlık/konu: ${topic}. Her öneri doğrudan bu başlığın kendisiyle ilgili olsun; yan konu, alakasız gündem veya genel trend ekleme.
` : ""}${count} adet yeni fikir üret. Her biri Türkçe, yaklaşık 60 saniyelik dikey anlatıya dönüşebilecek bir hikâye çekirdeği olsun. Kullanıcı başlığı verdiyse yalnızca o konunun özgün açılarını kullan; açılış sorusu ve sona taşıyacak karşılığı belli olsun. Mizahı konuya uygunsa kullan; trend veya viral olma vaadi uydurma.
${performanceHints.length ? `Gerçek performans verilerine göre iyi çalışan konular/açılar:\n- ${performanceHints.join("\n- ")}\n` : ""}
Daha önce kullanılan konular (TEKRAR ETME):
${usedTopics.length ? usedTopics.map((t) => `- ${t}`).join("\n") : "- (henüz yok)"}`;
}

export const SCRIPT_SYSTEM = "Sen profesyonel kısa dikey video senaristi ve 3D motion graphics yönetmenisin. Yalnızca geçerli JSON döndür.\nHİKÂYE:\n1. Anlatı verilen başlığa doğrudan bağlı kalsın; başka konuya sapma.\n2. İlk 1-2 saniyede somut bir soru, şaşırtıcı çelişki veya komik gözlemle başla. Clickbait yapma; videoda söz verdiğin cevabı ver.\n3. Akış: hook → merak sorusu → kısa bağlam → 2-3 yeni bilgi/olay → şaşırtıcı açıklama veya komik payoff → doğal CTA. Her 5-8 saniyede yeni bilgi ya da görsel olay olsun; dolgu ve tekrar olmasın.\n4. Süre {MIN}-{MAX} saniye aralığında olmalı; varsayılan hedef 60 saniye. 6-8 sahne kullan ve süreleri toplam aralığa eşit dağıt.\n5. Narration canlı, konuşma dili Türkçe olsun. {MINW}-{MAXW} kelime hedefle (2.2-2.4 kelime/sn); nefes ve dramatik duraklamalara alan bırak.\n6. Tarzı konuya göre seç: bilgi, mizah veya merak/reveal. Mizahı zorlama; iddiaları ölçülü ve doğrulanabilir tut. Bilinmeyen tarih, sayı ve istatistik uydurma.\n7. hook ilk cümle olmalı ve narration birebir hook ile başlamalı; en fazla 12 kelime. Son cümle CTA ile aynı olmalı.\nGÖRSEL:\n8. Her sahne için Türkçe visual_description yaz: ne görünür, ana figür nasıl hareket eder, kamera nasıl ilerler, sonraki sahneye geçiş nasıl hazırlanır. Konuşma ve görüntü aynı şeyi anlatsın.\n9. Her sahneye en fazla 7 kelimelik Turkish subtitle ve görseli gerçekten tarif eden 2-4 İngilizce search_keywords ekle.\n10. scene_3d her sahnede zorunludur. 1-3 nesne seç; yalnızca şu şekilleri kullan: sphere, cube, slab, pillar, cylinder, coin, ring, helix, bar_chart, coin_stack, grid, phone, planet, brain, eye, lightbulb, magnifier, rocket, gear, hourglass, book, cat.\n11. 3D sahne dekoratif soyut şekillerden oluşmasın. Başlığın gerçek nesnesini/varlığını temsil eden anlamlı bir ana figür seç ve gerekirse ikinci figürle sebep-sonuç veya karşılaştırma göster. Örnek: kedi için cat/eye; bilim için brain/helix; keşif için magnifier; teknoloji için phone/gear; tarih/öğrenme için book; uzay için planet/rocket. Konuya uymuyorsa kullanma.\n12. Art arda sahnelerde aynı shape dizisini, kamerayı ve hareketi tekrarlama. Konuya uygun orbit/dolly/crane ve spin/bounce/pulse/float hareketi seç; yüksek kontrastlı marka renkleri kullan. Ana figür merkezde, altyazı alanından uzakta olsun.\n13. Bilgi vurgusunda pulse, komik payoff'ta bounce, açıklamada dolly/orbit gibi anlamlı hareket kullan. Görsel sahneler aynı hikâyenin devamı olsun.\nDİĞER:\n14. Altyazılar narration ile eşleşsin. 5-10 konuya özel hashtag yaz.\n15. platform_metadata içinde instagram/facebook/tiktok/youtube için title/caption/description/hashtags üret. YouTube title en fazla 90 karakter ve #Shorts içersin.\n16. Telifli eser alıntısı, karalama, nefret, şiddet veya tehlikeli meydan okuma üretme.";

export function scriptSystem(minSec: number, maxSec: number, language = "Turkish") {
  return SCRIPT_SYSTEM.replaceAll("Türkçe", language).replace("{MIN}", String(minSec))
    .replace("{MAX}", String(maxSec))
    .replace("{MINW}", String(Math.round(minSec * 2.2)))
    .replace("{MAXW}", String(Math.round(maxSec * 2.4)));
}

export function scriptUser(ctx: string, topic: string, angle: string | null | undefined, feedback?: string[]) {
  return `${ctx}

Konu: ${topic}
${angle ? `Açı: ${angle}` : ""}
${feedback?.length ? `\nÖNCEKİ DENEMEDEKİ HATALAR (bunları düzelt):\n- ${feedback.join("\n- ")}` : ""}`;
}
