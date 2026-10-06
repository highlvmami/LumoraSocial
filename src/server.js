import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import session from 'express-session';
import { config } from './config.js';
import './db.js';
import { cleanupPendingImages } from './models/posts.js';
import { cleanupLogs } from './models/audit.js';
import { SqliteSessionStore } from './sessionStore.js';
import { loadUser } from './middleware/auth.js';
import { HttpError } from './validation.js';
import { getUpload } from './uploads.js';
import authRoutes, { emailVerifyPage } from './routes/auth.js';
import accountRoutes from './routes/account.js';
import notificationRoutes from './routes/notifications.js';
import messageRoutes from './routes/messages.js';
import searchRoutes from './routes/search.js';
import reportRoutes from './routes/reports.js';
import oauthRoutes from './routes/oauth.js';
import { trackLastSeen } from './services/session.js';
import { mailConfigured } from './services/mailer.js';
import { smsConfigured } from './services/sms.js';
import { enabledProviders } from './services/oauthProviders.js';
import userRoutes from './routes/users.js';
import postRoutes from './routes/posts.js';
import storyRoutes from './routes/stories.js';
import pushRoutes from './routes/push.js';
import { cleanupExpiredStories } from './models/stories.js';
import adminRoutes from './routes/admin.js';

const app = express();
app.disable('x-powered-by');
if (config.isProduction) app.set('trust proxy', 1);

app.use((_req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'",
  });
  next();
});

app.use(express.json({ limit: '50kb' }));
app.use(
  session({
    name: 'lumora.sid',
    secret: config.sessionSecret,
    store: new SqliteSessionStore(),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'strict', // başka sitelerden gelen isteklerde çerez gönderilmez (CSRF koruması)
      secure: config.isProduction,
      maxAge: 30 * 24 * 60 * 60 * 1000,
    },
  })
);
app.use(loadUser);
app.use(trackLastSeen);

// API'ler yalnızca JSON (ve resim yüklemeleri) kabul eder; HTML formları bu türleri gönderemez (CSRF'ye karşı ek önlem)
app.use('/api', (req, res, next) => {
  const hasBody = Number(req.headers['content-length']) > 0 || req.headers['transfer-encoding'];
  if (hasBody && !req.is('application/json') && !req.is('image/*')) {
    return res.status(415).json({ error: 'İstek JSON olmalı.' });
  }
  next();
});

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/account', accountRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/stories', storyRoutes);
app.use('/api/push', pushRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Bulunamadı.' }));

/* ---- Sosyal giriş (tarayıcı yönlendirmeleri) ---- */
app.use('/auth', oauthRoutes);

/* ---- Sayfalar ---- */
const pub = path.join(config.rootDir, 'public');
const page = (file) => (_req, res) => res.sendFile(path.join(pub, file));

app.get('/', (req, res) => (req.user ? res.redirect('/akis') : page('index.html')(req, res)));
app.get('/akis', (req, res) => (req.user ? page('app.html')(req, res) : res.redirect('/')));
app.get('/admin-giris', page('admin-login.html'));
app.get('/sifremi-unuttum', page('forgot.html'));
app.get('/sifre-sifirla', page('forgot.html'));
app.get('/eposta-dogrula', emailVerifyPage);
app.get('/dogrulama-sonucu', page('verified.html'));
app.get(['/gizlilik', '/kosullar'], page('gizlilik.html'));
app.get('/indir', page('indir.html'));

// Android uygulaması: sürüm bilgisi (uygulama içi güncelleme uyarısı) ve alan adı doğrulaması (adres çubuğunu gizler)
const androidRelease = () => JSON.parse(fs.readFileSync(path.join(config.rootDir, 'android-release.json'), 'utf8'));
app.get('/api/app/android', (_req, res) => {
  const { versionCode, versionName, apkUrl, notes } = androidRelease();
  res.set('Cache-Control', 'no-cache').json({ versionCode, versionName, apkUrl, notes });
});
app.get('/.well-known/assetlinks.json', (_req, res) => {
  const { packageId, certSha256 } = androidRelease();
  res.json([{ relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: packageId, sha256_cert_fingerprints: certSha256 } }]);
});
app.get('/yonetim', (req, res) => {
  if (req.user?.role === 'admin') return page('admin.html')(req, res);
  res.redirect(req.user ? '/akis' : '/admin-giris');
});
// Uyanık tutma / sağlık kontrolü
app.get('/saglik', (_req, res) => res.type('text').send('ok'));
// JS/CSS her açılışta sunucuya sorulur (değişmediyse 304 döner), böylece güncellemeden sonra eski sürüm kalmaz
app.use(express.static(pub, { index: false, setHeaders: (res, file) => /\.(js|css|html)$/.test(file) && res.setHeader('Cache-Control', 'no-cache') }));
// Resimler veritabanından; bulunamazsa eski sürümlerden kalan disk dosyalarına bakılır
app.use('/uploads', (req, res, next) => {
  let key;
  try { key = decodeURIComponent(req.path.slice(1)); } catch { return next(); }
  const file = getUpload(key);
  if (!file) return next();
  res.set('Cache-Control', 'public, max-age=2592000, immutable').type(file.mime).send(Buffer.from(file.data));
});
app.use('/uploads', express.static(config.uploadsDir, { index: false, fallthrough: false, maxAge: '30d' }));

app.use((err, _req, res, _next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Gönderilen dosya çok büyük.' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Geçersiz JSON.' });
  if (err.status === 404) return res.status(404).json({ error: 'Bulunamadı.' });
  console.error(err);
  res.status(500).json({ error: 'Sunucu hatası.' });
});

// Paylaşılmadan bırakılan fotoğrafları temizle (açılışta ve saatte bir)
// ve 180 günden eski olay kayıtlarını sil
const housekeeping = () => {
  cleanupPendingImages();
  cleanupLogs();
  cleanupExpiredStories();
};
housekeeping();
setInterval(housekeeping, 60 * 60 * 1000).unref();

app.listen(config.port, () => {
  console.log(`LumoraSocial çalışıyor: http://localhost:${config.port}`);
  if (!config.adminSetupKey) console.warn('[uyarı] ADMIN_SETUP_KEY ayarlı değil; ilk yönetici kaydı kapalı.');
  if (!mailConfigured) console.log('[bilgi] SMTP ayarlı değil: e-postalar bu pencereye yazılacak.');
  if (!smsConfigured) console.log('[bilgi] SMS sağlayıcısı ayarlı değil: SMS kodları bu pencereye yazılacak.');
  const social = enabledProviders().map((p) => p.label);
  console.log(`[bilgi] Sosyal giriş: ${social.length ? social.join(', ') : 'kapalı (.env içinde anahtar yok)'}`);
});
