import nodemailer from 'nodemailer';
import { config } from '../config.js';

/*
 * Gönderim yolu (ilk ayarlı olan kullanılır):
 *   1. Gmail API (GMAIL_CLIENT_ID + GMAIL_CLIENT_SECRET + GMAIL_REFRESH_TOKEN) — HTTPS üzerinden,
 *      Render ücretsiz planı SMTP portlarını kapattığı için. İzin için: npm run gmail-izni
 *   2. Brevo (BREVO_API_KEY) — gönderen adresin kendi alan adın olması gerekir
 *   3. SMTP
 *   4. Hiçbiri yoksa konsol
 */
const gmail = {
  clientId: process.env.GMAIL_CLIENT_ID || '',
  clientSecret: process.env.GMAIL_CLIENT_SECRET || '',
  refreshToken: process.env.GMAIL_REFRESH_TOKEN || '',
};
const useGmail = Boolean(gmail.clientId && gmail.clientSecret && gmail.refreshToken);
const brevoKey = useGmail ? '' : process.env.BREVO_API_KEY || '';

const transport =
  !useGmail && !brevoKey && config.smtp.host
    ? nodemailer.createTransport({
        host: config.smtp.host,
        port: config.smtp.port,
        secure: config.smtp.secure,
        auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 15_000,
      })
    : null;

export const mailConfigured = Boolean(useGmail || brevoKey || transport);

/** "Ad <adres>" biçimini { name, email } nesnesine çevirir. */
function parseFrom(from) {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from);
  return m ? { name: m[1] || undefined, email: m[2] } : { email: from.trim() };
}

/* ---- Gmail API ---- */

let gmailToken = { value: '', expires: 0 };

async function gmailAccessToken() {
  if (gmailToken.value && Date.now() < gmailToken.expires - 60_000) return gmailToken.value;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: gmail.clientId,
      client_secret: gmail.clientSecret,
      refresh_token: gmail.refreshToken,
      grant_type: 'refresh_token',
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Gmail izni yenilenemedi: ${data.error || res.status} ${data.error_description || ''}`);
  gmailToken = { value: data.access_token, expires: Date.now() + data.expires_in * 1000 };
  return gmailToken.value;
}

// Başlıklardaki Türkçe karakterler için RFC 2047 kodlaması
const encodeHeader = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`);

async function sendWithGmail({ to, subject, text }) {
  const from = parseFrom(config.smtp.from);
  const message = [
    `From: ${from.name ? `${encodeHeader(from.name)} <${from.email}>` : from.email}`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(text, 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n'),
  ].join('\r\n');

  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { authorization: `Bearer ${await gmailAccessToken()}`, 'content-type': 'application/json' },
    body: JSON.stringify({ raw: Buffer.from(message).toString('base64url') }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Gmail ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

/* ---- Brevo ---- */

async function sendWithBrevo({ to, subject, text }) {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': brevoKey, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ sender: parseFrom(config.smtp.from), to: [{ email: to }], subject, textContent: text }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Brevo ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

/**
 * E-posta gönderir. Hiçbir yol ayarlı değilse (geliştirme) içeriği konsola yazar.
 * Gönderim hatası kullanıcı işlemini bozmasın diye yakalanıp loglanır.
 */
export async function sendMail({ to, subject, text }) {
  if (!mailConfigured) {
    console.log(`\n[e-posta · SMTP ayarlı değil]\nKime: ${to}\nKonu: ${subject}\n${text}\n`);
    return;
  }
  try {
    if (useGmail) await sendWithGmail({ to, subject, text });
    else if (brevoKey) await sendWithBrevo({ to, subject, text });
    else await transport.sendMail({ from: config.smtp.from, to, subject, text });
  } catch (err) {
    console.error('[e-posta] gönderilemedi:', err.message);
  }
}
