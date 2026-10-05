import nodemailer from 'nodemailer';
import { config } from '../config.js';

/*
 * Gönderim yolu: BREVO_API_KEY varsa Brevo'nun HTTPS API'si (Render ücretsiz planı SMTP
 * portlarını kapattığı için), yoksa SMTP, o da yoksa konsol.
 */
const brevoKey = process.env.BREVO_API_KEY || '';

const transport =
  !brevoKey && config.smtp.host
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

export const mailConfigured = Boolean(brevoKey || transport);

/** "Ad <adres>" biçimini Brevo'nun beklediği { name, email } nesnesine çevirir. */
function parseFrom(from) {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from);
  return m ? { name: m[1] || undefined, email: m[2] } : { email: from.trim() };
}

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
    if (brevoKey) await sendWithBrevo({ to, subject, text });
    else await transport.sendMail({ from: config.smtp.from, to, subject, text });
  } catch (err) {
    console.error('[e-posta] gönderilemedi:', err.message);
  }
}
