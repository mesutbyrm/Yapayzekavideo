import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Gizlilik Politikası",
  description: "GirLive ve AI Social Factory hizmetlerinde kişisel verilerin nasıl işlendiği.",
  robots: { index: true, follow: true },
};

const sections = [
  {
    title: "Bu politika hakkında",
    body: "Bu politika, GirLive / AI Social Factory kısa video üretim ve sosyal medya yayınlama hizmetinin hangi bilgileri işlediğini, bunları neden kullandığını ve kullanıcıların hangi kontrolleri kullanabileceğini açıklar. Gizlilik soruları ve talepleri için: canlifal0@gmail.com.",
  },
  {
    title: "İşlediğimiz bilgiler",
    body: "Hesap oluştururken ad, e-posta adresi ve parola bilgisi işlenir; parolalar düz metin olarak değil, doğrulama için hash biçiminde saklanır. Oturum güvenliği için oturum ve CSRF çerezleri; güvenlik ve denetim kayıtları için IP adresi, tarayıcı bilgisi ve işlem zamanı işlenebilir. Video oluşturma ve yönetme sırasında başlıklar, konu ve istemler, senaryolar, altyazılar, ses, görsel, video, marka ayarları, planlama bilgileri ve yayın tercihleri saklanabilir.",
  },
  {
    title: "Bağlanan sosyal hesaplar",
    body: "Kullanıcı bir sosyal hesabı bağladığında, seçilen platformdan hesap ve sayfa kimlikleri, görünen ad/kullanıcı adı, profil görseli, verilen izin kapsamları ve bağlantı durumu alınabilir. Yayın, analiz ve bağlantı yönetimi için OAuth erişim belirteçleri saklanır; uygulamadaki token saklama alanları AES-256-GCM ile şifrelenir. Yayın işleri, sonuçlar, platform kimlikleri ve sağlanan analiz ölçümleri de hizmetin çalışması için tutulabilir.",
  },
  {
    title: "Bilgileri nasıl kullanıyoruz",
    body: "Bilgiler; hesabı doğrulamak ve korumak, kullanıcı tarafından istenen fikir/senaryo/video üretimini yürütmek, ses ve altyazı oluşturmak, içeriği planlamak veya bağlı platformlarda yayımlamak, yayın ve analiz sonuçlarını göstermek, maliyetleri ve kullanım sınırlarını hesaplamak, hataları gidermek ve kötüye kullanımı önlemek için kullanılır.",
  },
  {
    title: "Hizmet sağlayıcılarla paylaşım",
    body: "İçerik üretiminde yönetici tarafından yapılandırılmış metin modeli sağlayıcısına (OpenAI veya Anthropic) gerekli istem ve içerik gönderilebilir. Seslendirme için kullanıcı metni Google Cloud Text-to-Speech'e gönderilebilir. Kullanıcı tarafından seçilen medya sağlayıcıları ve depolama altyapısı (GirLive VPS'si veya yapılandırılmışsa Cloudflare R2) kullanılabilir. Sosyal hesaba bağlanma, yayınlama ve analiz istekleri ilgili platforma, örneğin Meta/Instagram, Facebook, TikTok veya YouTube'a iletilir. Bu sağlayıcılar verileri kendi gizlilik şartlarına göre işleyebilir ve farklı ülkelerde bulundurabilir.",
  },
  {
    title: "Saklama ve güvenlik",
    body: "Bilgiler, hizmeti sağlamak ve güvenliğini korumak için gerekli olduğu süre boyunca saklanır. Kullanıcı hesabı ve yalnızca o kullanıcıya ait markalar silindiğinde bunlara bağlı içerik ve bağlantı tokenları silinir; platform bağlantılarının iptali mümkün olduğunda denenir. Yedekler ve güvenlik/denetim kayıtları teknik olarak gereken sınırlı süre boyunca kalabilir. Sosyal platformlarda daha önce yayımlanmış gönderiler GirLive hesabını silmekle otomatik silinmez. Parolalar hash'lenir, sosyal OAuth tokenları şifrelenir ve erişimler yetkiye göre sınırlandırılır.",
  },
  {
    title: "Kullanıcı kontrolleri",
    body: "Kullanıcı, bağlı sosyal hesapları GirLive'den ayırabilir; Sistem Ayarları'ndan hesabına ve sahibi olduğu markalara ait verileri dışa aktarabilir veya hesabını silebilir. Hesap silme işlemi parola doğrulaması ve açık onay ister. Sosyal platformlarda yayımlanmış içerikleri kaldırmak için ilgili platformun araçlarını ayrıca kullanmak gerekir.",
  },
  {
    title: "Çerezler",
    body: "GirLive oturum açma ve CSRF güvenliği için gerekli oturum çerezlerini kullanır. Bu çerezler hesabın güvenli biçimde kullanılmasına hizmet eder.",
  },
  {
    title: "Güncellemeler ve iletişim",
    body: "Hizmet veya veri uygulamaları değişirse bu politika güncellenebilir. Gizlilik talepleri ve sorular için canlifal0@gmail.com adresinden bize ulaşabilirsiniz.",
  },
];

export default function PrivacyPage() {
  return (
    <main className="min-h-dvh bg-slate-950 px-5 py-12 text-slate-100 sm:px-8">
      <article className="mx-auto max-w-3xl rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl sm:p-10">
        <a href="/" className="text-sm text-sky-300 underline">GirLive</a>
        <h1 className="mt-6 text-3xl font-bold tracking-tight sm:text-4xl">Gizlilik Politikası</h1>
        <p className="mt-3 text-sm text-slate-400">Son güncelleme: 22 Kasım 2026</p>
        <p className="mt-6 leading-7 text-slate-300">Gizlilik Politikası, GirLive ve AI Social Factory hizmetlerinde işlenen kişisel verileri ve kullanıcıların bu veriler üzerindeki kontrollerini açıklar. Sorularınız için canlifal0@gmail.com adresinden bize ulaşabilirsiniz.</p>
        <div className="mt-10 space-y-8">
          {sections.map((section) => (
            <section key={section.title}>
              <h2 className="text-xl font-semibold">{section.title}</h2>
              <p className="mt-3 leading-7 text-slate-300">{section.body}</p>
            </section>
          ))}
        </div>
      </article>
    </main>
  );
}
