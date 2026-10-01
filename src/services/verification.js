import { config } from '../config.js';
import { issueToken } from './tokens.js';
import { sendMail } from './mailer.js';
import { sendSms } from './sms.js';

export async function sendEmailVerification(user) {
  if (!user.email) return;
  const token = issueToken({ userId: user.id, purpose: 'email_verify', target: user.email, kind: 'link', ttlMinutes: 24 * 60 });
  const link = `${config.appUrl}/eposta-dogrula?token=${token}`;
  await sendMail({
    to: user.email,
    subject: 'LumoraSocial: e-posta adresini doğrula',
    text: `Merhaba ${user.display_name},\n\nE-posta adresini doğrulamak için bu bağlantıyı aç (24 saat geçerli):\n${link}\n\nBu isteği sen yapmadıysan bu e-postayı yok sayabilirsin.`,
  });
}

export async function sendPhoneCode(user) {
  if (!user.phone) return;
  const code = issueToken({ userId: user.id, purpose: 'phone_verify', target: user.phone, kind: 'code', ttlMinutes: 10 });
  await sendSms(user.phone, `LumoraSocial doğrulama kodun: ${code} (10 dakika geçerli)`);
}

/** Şifre sıfırlama: e-postaya bağlantı ya da telefona kod gönderir. */
export async function sendPasswordReset(user, via) {
  if (via === 'email') {
    const token = issueToken({ userId: user.id, purpose: 'password_reset', target: user.email, kind: 'link', ttlMinutes: 60 });
    await sendMail({
      to: user.email,
      subject: 'LumoraSocial: şifre sıfırlama',
      text: `Merhaba ${user.display_name},\n\nŞifreni sıfırlamak için bu bağlantıyı aç (1 saat geçerli):\n${config.appUrl}/sifre-sifirla?token=${token}\n\nBu isteği sen yapmadıysan bu e-postayı yok say; şifren değişmez.`,
    });
  } else {
    const code = issueToken({ userId: user.id, purpose: 'password_reset', target: user.phone, kind: 'code', ttlMinutes: 10 });
    await sendSms(user.phone, `LumoraSocial şifre sıfırlama kodun: ${code} (10 dakika geçerli)`);
  }
}
