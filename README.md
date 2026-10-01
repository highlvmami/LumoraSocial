# LumoraSocial

Arkadaşlar için küçük bir sosyal medya sitesi: üyelik, akış, emoji tepkileri, yorumlar, profil düzenleme ve yönetim paneli.

**Teknoloji:** Node.js (22.5+) · Express 5 · SQLite (Node'un yerleşik `node:sqlite` modülü, ek kurulum yok) · sade HTML/CSS/JS · şifreler bcrypt ile hash'lenir.

## Çalıştırma

```bash
npm install
npm start
```

Tarayıcıda `http://localhost:3000` adresini açın. Geliştirirken `npm run dev` dosya değişince sunucuyu yeniden başlatır.

## Ayarlar (`.env`)

`.env.example` dosyasını `.env` olarak kopyalayıp düzenleyin:

| Değişken | Açıklama |
|---|---|
| `PORT` | Sunucu portu (varsayılan 3000) |
| `SESSION_SECRET` | Oturum çerezlerini imzalayan uzun rastgele değer |
| `ADMIN_SETUP_KEY` | İlk yönetici kaydında istenen gizli anahtar |
| `DB_PATH` | Veritabanı dosyası (varsayılan `data/lumora.db`) |
| `UPLOADS_DIR` | Yüklenen resimler (varsayılan `data/uploads`) |
| `NODE_ENV` | HTTPS arkasında canlıya alırken `production` |
| `APP_URL` | Sitenin dışarıdan açılan adresi; e-posta bağlantıları ve sosyal giriş dönüşleri bununla kurulur |
| `SMTP_*`, `MAIL_FROM` | E-posta gönderimi (boşsa e-postalar sunucu penceresine yazılır) |
| `TWILIO_*` | SMS gönderimi (boşsa SMS kodları sunucu penceresine yazılır) |
| `GOOGLE_*`, `GITHUB_*` | Sosyal giriş; anahtarı olmayan sağlayıcının butonu görünmez |

`.env` değişince sunucuyu yeniden başlatın.

## Dış servisleri bağlama

Bu servisler ayarlanmadan da site çalışır: e-posta doğrulama bağlantıları ve SMS kodları **sunucu penceresine** yazılır, oradan kopyalanabilir.

- **E-posta (SMTP):** Herhangi bir SMTP hesabı olur. Gmail için Google Hesabı > Güvenlik > *Uygulama şifreleri*'nden bir şifre oluşturup `SMTP_HOST=smtp.gmail.com`, `SMTP_USER`, `SMTP_PASS` girin.
- **SMS (Twilio):** twilio.com'da hesap açın; *Account SID*, *Auth Token* ve SMS gönderebilen bir numarayı (`TWILIO_FROM`) girin. Ücretlidir.
- **Google ile giriş:** console.cloud.google.com > API'ler ve Hizmetler > Kimlik bilgileri > *OAuth istemci kimliği* (Web uygulaması). Yetkili yönlendirme URI'si: `APP_URL/auth/google/callback`.
- **GitHub ile giriş:** github.com > Settings > Developer settings > *OAuth Apps* > New. Callback URL: `APP_URL/auth/github/callback`.

## İlk yönetici

1. Giriş ekranının sağ altındaki **Admin girişi** bağlantısına tıklayın.
2. **İlk yönetici kaydı** sekmesinde `.env` içindeki `ADMIN_SETUP_KEY` değerini ve hesap bilgilerini girin.
3. Bu kayıt **yalnızca bir kez** yapılabilir; sonrasında ekran kapanır. Diğer yöneticiler yönetim panelinden eklenir.

## Özellikler

- **Kayıt / giriş:** e-posta, telefon veya yalnızca kullanıcı adıyla kayıt; şifre tekrarı kontrolü; kullanıcı adı, e-posta ya da telefonla giriş; Google / GitHub ile giriş; e-posta doğrulama bağlantısı, SMS doğrulama kodu; şifremi unuttum (e-posta bağlantısı veya SMS kodu).
- **Güvenlik:** aktif oturumların ve tanınan cihazların listesi, tek oturumu veya tüm cihazları kapatma, yeni cihazdan ve şüpheli girişte (3+ hatalı denemeden sonra) bildirim + e-posta uyarısı. Şifre değişince diğer oturumlar kapanır.
- **Profil:** profil ve kapak fotoğrafı, kullanıcı adı, görünen ad, biyografi, doğum tarihi, konum, web sitesi, sosyal medya bağlantıları, meslek, eğitim, ilgi alanları, katılım tarihi, yöneticinin verdiği doğrulanmış hesap rozeti (✓).
- **Gizlilik:** gizli hesap (takip isteğiyle; paylaşımlar yalnızca onaylı takipçilere), doğum tarihi / konum / iletişim bilgisi için "Herkes · Takipçilerim · Sadece ben".
- **Tema:** varsayılan açık tema; Ayarlar > Görünüm'den veya her sayfadaki "🌙 Koyu tema / ☀️ Açık tema" düğmesiyle değiştirilir. Seçim cihazda saklanır.
- **Arama:** sol üstteki kutudan veya "🔍 Ara" sayfasından kişi (kullanıcı adı, isim, biyografi) ve paylaşım arama; paylaşımlardaki #etiketler tıklanınca o etiketin paylaşımları listelenir. Gizli hesap kuralları aramada da geçerli.
- **Kaydetme:** paylaşımdaki 📑 ile kaydedilir, "🔖 Kaydedilenler" sayfasında listelenir (yalnızca kendin görürsün).
- **Engelleme:** profil veya paylaşım menüsünden (⋯); iki taraf birbirinin paylaşım, yorum ve profilini görmez, takip ve mesajlaşma kapanır. Engellenenler Ayarlar > Gizlilik'te.
- **Şikâyet:** paylaşım, yorum ve kullanıcı şikâyet edilebilir (sebep + açıklama). Yönetim panelindeki "🚩 Şikâyetler" sekmesinde içerik silme, kullanıcıyı askıya alma, çözüldü / yok say işlemleri; aynı içerikteki tüm şikâyetler birlikte kapanır.
- **Mesajlaşma:** birebir özel mesaj; sohbet listesi, okunmamış sayacı, "Görüldü" bilgisi, kendi mesajını silme, birkaç saniyede bir canlı yenileme. Gizli hesaplara yalnızca takipçileri yeni mesaj atabilir.
- **Bildirimler:** paylaşımına tepki ve yorum (tıklayınca paylaşım açılır; tepki geri alınınca bildirim de silinir), yeni takipçi, takip isteği (onayla / sil), istek kabul edildi, yeni cihaz, şüpheli giriş.

- **Takip:** üyeler birbirini takip eder; akışta **Genel akış** (herkes) ve **Takip ettiklerim** (takip edilenler + kendi paylaşımların) sekmeleri, profillerde takipçi/takip sayıları, solda önerilen kişiler.
- **Profil fotoğrafı:** JPG/PNG/WEBP yüklenir, tarayıcıda kare kırpılıp küçültülür (konum bilgisi silinir), en fazla 2 MB; yöneticiler uygunsuz fotoğrafı kaldırabilir.
- **Üye:** paylaşım yapma ve silme (paylaşım başına en fazla 4 fotoğraf; tarayıcıda küçültülür, tıklayınca tam ekran açılır), 6 emoji tepkisi (aç/kapa), yorum yapma ve silme, diğer üyelerin profil sayfaları.
- **Yönetici kayıtları (log):** panelde "Kayıtlar" sekmesi; üye kayıtları, girişler/çıkışlar, başarısız girişler (sebebiyle), hesap değişiklikleri, yönetici işlemleri ve paylaşımlar zaman, kişi, IP ve cihazla listelenir; türe göre filtre ve arama, son 24 saat özeti. 180 günden eski kayıtlar silinir.
- **Yönetici:** istatistikler, kullanıcı arama (e-posta dahil), doğrulama rozeti verme, yönetici yap / üye yap, askıya al / etkinleştir, şifre sıfırla, kullanıcı silme, yeni üye veya yönetici oluşturma, her paylaşım ve yorumu silebilme. Son yönetici kaldırılamaz.
- **Teknik güvenlik:** bcrypt şifre hash'i, SQLite'ta kalıcı oturumlar, `SameSite=Strict` çerezler, yalnızca JSON kabul eden API, hatalı giriş/anahtar denemelerinde hız sınırı, CSP başlıkları, tüm kullanıcı metni `textContent` ile basılır.

## Proje yapısı

```
src/
  server.js          Express uygulaması, sayfa yönlendirmeleri
  config.js          .env okuma
  db.js              SQLite bağlantısı + sürümlü şema göçleri
  sessionStore.js    Oturumları SQLite'ta saklar
  validation.js      Girdi doğrulama yardımcıları
  middleware/        auth (giriş/rol kontrolü), rateLimit
  uploads.js         Resim kaydetme (profil, kapak)
  models/            users, posts, follows, notifications (SQL sorguları)
  routes/            auth, oauth, account, users, posts, notifications, admin
  services/          mailer (SMTP), sms (Twilio), tokens (tek kullanımlık kodlar),
                     verification, devices (yeni/şüpheli giriş), session, oauthProviders
public/
  index.html         Üye giriş/kayıt
  admin-login.html   Yönetici girişi + ilk yönetici kaydı
  app.html           Akış, profil, bildirimler, ayarlar (tek sayfa)
  forgot.html        Şifremi unuttum / şifre sıfırlama
  verified.html      E-posta doğrulama sonucu
  admin.html         Yönetim paneli
  css/style.css      Tüm stiller (açık/koyu tema)
  js/                app.js, settings.js, notifications.js, common.js, …
data/                Veritabanı ve yüklenen resimler (git'e eklenmez)
```

## Yeni özellik eklerken

- **Veritabanı:** `src/db.js` içindeki `migrations` dizisine yeni bir eleman ekleyin (mevcutları değiştirmeyin). Sunucu açılışta eksik göçleri otomatik uygular, veriler korunur.
- **API:** `src/routes/` altına yeni bir router ekleyip `server.js`'te `app.use('/api/...', ...)` ile bağlayın.
- **Emoji tepkileri:** `src/models/posts.js` içindeki `REACTIONS` listesini düzenleyin.
- **Yedek:** sunucu kapalıyken `data/` klasörünü (veritabanı + yüklenen resimler) kopyalayın.
