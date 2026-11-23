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

export function ideasUser(ctx: string, count: number, usedTopics: string[], performanceHints: string[], topic = "") {
  return `${ctx}

${topic ? `Kullanıcının özellikle istediği konu: ${topic}. Fikirlerin tamamı bu konuya odaklansın.
` : ""}${count} adet yeni video fikri üret. Her fikir 20-30 saniyede anlatılabilecek kadar odaklı olsun.
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
10. "fact_check_notes": metindeki iddiaların neden güvenilir olduğunu kısaca açıkla.
11. "scene_3d": her sahne kodla çizilen hareketli bir 3D sahneye dönüşür. O sahnede ANLATILAN şeyi temsil eden 1-5 nesne seç; her sahne farklı olsun, aynı kompozisyonu tekrar etme.
   - shape: sphere, cube, slab (kart/belge), pillar (kule/sütun), cylinder, coin (para), ring (halka/döngü), helix (DNA/bilim/gelişim), bar_chart (büyüme/istatistik), coin_stack (birikim/para), grid (veri/şehir/sistem), phone (uygulama/sosyal medya), planet (dünya/uzay/küresel).
   - motion: spin, bob, orbit, pulse (kalp atışı/vurgu), bounce (enerji/neşe), float, none. camera: orbit, dolly (yaklaşma/odak), crane (yukarıdan iniş/açılış), static.
   - color: #RRGGBB, konuya uygun (para=altın, doğa=yeşil, teknoloji=mavi/mor, tehlike=kırmızı).
   - Konum: x -1.5..1.5 (sol/sağ), y -0.8..1.5 (yukarı), z -1.5..1.2 (derinlik); size 0.3..1.2. Nesneler birbirinin içine girmesin, ana nesne ortada ve büyük olsun.`;

/** "shorts3d" şablonu: referans videolardaki (Yapay Zekâ Komedisi) anlatım ve görsel dil */
export const SHORTS3D_RULES = `
Şablon kuralları (shorts3d, eğlenceli "bunu biliyor muydunuz" dizisi):
11. Anlatım: esprili, merak uyandıran, samimi konuşma dili; kısa cümleler. Hook şaşırtıcı bir soru ya da iddia olsun (ör. "Bu kaplumbağa yapay zekâya göre bir tüfek.").
12. Gerçek olayı tarih, yer ve kim olduğuyla anlat (ör. "2017'de MIT'li araştırmacılar..."), sonra neden komik/ilginç olduğunu ve arkasındaki kavramı basitçe açıkla.
13. Kapanış: izleyiciye bir soru sor ve "Yorumlara yazın!" ile bitir. "cta" bu son cümle olsun.
14. Her sahne için "visual_description" İNGİLİZCE ve tek bir sevimli 3D karakter ya da nesne tarif etsin (ör. "a cute green toy turtle", "a friendly white robot with a screen face and glowing cyan eyes looking confused"). Gerçek kişi, marka logosu, yazı tarif etme.
15. "label": sahnede ekranda kısa etiket gerekiyorsa en fazla 3 kelime (ör. "2017 · MIT", "TUZAK", "RÖNTGEN"); gerekmiyorsa boş string. Etiketleri sahnelerin yarısından azında kullan.
16. "cover_title": açılış kapak başlığı, toplam en fazla 5 kelime, iki satır "|" ile ayrılır, ikinci satır vurucu olsun (ör. "BU BİR|TÜFEK Mİ?!").
17. "highlight_words": anlatımda geçen 6-15 anahtar kelime (yazıldığı gibi: sayılar, yıllar, kilit isimler); altyazıda sarı yanar. "alert_words": 1-4 şok/olumsuz kelime (ör. "tüfek", "sahte"); kırmızı yanar.`;

export function scriptSystem(minSec: number, maxSec: number, language = "Turkish", template?: string) {
  const base = template === "shorts3d" ? SCRIPT_SYSTEM + SHORTS3D_RULES : SCRIPT_SYSTEM + `\n11. "label", "cover_title" boş string; "highlight_words" ve "alert_words" boş dizi olabilir.`;
  return base.replaceAll("Türkçe", language).replace("{MIN}", String(minSec))
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
