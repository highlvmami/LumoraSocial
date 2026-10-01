import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// .env dosyasını yükle (yoksa sessizce devam et)
try {
  process.loadEnvFile(path.join(rootDir, '.env'));
} catch {
  // .env yok: ortam değişkenleri veya varsayılanlar kullanılır
}

export const config = {
  rootDir,
  port: Number(process.env.PORT) || 3000,
  dbPath: path.resolve(rootDir, process.env.DB_PATH || 'data/lumora.db'),
  uploadsDir: path.resolve(rootDir, process.env.UPLOADS_DIR || 'data/uploads'),

  // Bulut veritabanı (Turso). Boşsa DB_PATH'teki yerel dosya kullanılır.
  turso: {
    url: process.env.TURSO_DATABASE_URL || '',
    authToken: process.env.TURSO_AUTH_TOKEN || '',
    mode: process.env.TURSO_MODE || 'remote',
    replicaPath: path.resolve(rootDir, process.env.TURSO_REPLICA_PATH || 'data/turso-replica.db'),
  },
  sessionSecret: process.env.SESSION_SECRET || '',
  adminSetupKey: process.env.ADMIN_SETUP_KEY || '',
  isProduction: process.env.NODE_ENV === 'production',

  // E-postalardaki bağlantılar ve sosyal giriş dönüş adresleri bu adresle kurulur
  appUrl: (process.env.APP_URL || `http://localhost:${Number(process.env.PORT) || 3000}`).replace(/\/+$/, ''),

  // E-posta (SMTP). Ayarlanmazsa e-postalar sunucu konsoluna yazılır.
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.MAIL_FROM || 'LumoraSocial <no-reply@lumora.local>',
  },

  // SMS (Twilio). Ayarlanmazsa SMS kodları sunucu konsoluna yazılır.
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID || '',
    authToken: process.env.TWILIO_AUTH_TOKEN || '',
    from: process.env.TWILIO_FROM || '',
  },

  // Sosyal giriş. Kimlik bilgileri girilmeyen sağlayıcının butonu gösterilmez.
  oauth: {
    google: { clientId: process.env.GOOGLE_CLIENT_ID || '', clientSecret: process.env.GOOGLE_CLIENT_SECRET || '' },
    github: {
      clientId: process.env.GITHUB_CLIENT_ID || '',
      clientSecret: process.env.GITHUB_CLIENT_SECRET || '',
      // GitHub Enterprise için değiştirilebilir
      webBase: process.env.GITHUB_WEB_BASE || 'https://github.com',
      apiBase: process.env.GITHUB_API_BASE || 'https://api.github.com',
    },
  },
};

if (!config.sessionSecret) {
  console.warn('[uyarı] SESSION_SECRET ayarlı değil; .env dosyasına uzun rastgele bir değer yazın.');
  config.sessionSecret = 'dev-only-insecure-secret';
}
