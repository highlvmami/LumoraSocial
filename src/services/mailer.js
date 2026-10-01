import nodemailer from 'nodemailer';
import { config } from '../config.js';

const transport = config.smtp.host
  ? nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    })
  : null;

export const mailConfigured = Boolean(transport);

/**
 * E-posta gönderir. SMTP ayarlı değilse (geliştirme) içeriği konsola yazar.
 * Gönderim hatası kullanıcı işlemini bozmasın diye yakalanıp loglanır.
 */
export async function sendMail({ to, subject, text }) {
  if (!transport) {
    console.log(`\n[e-posta · SMTP ayarlı değil]\nKime: ${to}\nKonu: ${subject}\n${text}\n`);
    return;
  }
  try {
    await transport.sendMail({ from: config.smtp.from, to, subject, text });
  } catch (err) {
    console.error('[e-posta] gönderilemedi:', err.message);
  }
}
