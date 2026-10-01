import { config } from '../config.js';

const { accountSid, authToken, from } = config.twilio;
export const smsConfigured = Boolean(accountSid && authToken && from);

/** SMS gönderir (Twilio). Ayarlı değilse (geliştirme) mesajı konsola yazar. */
export async function sendSms(to, body) {
  if (!smsConfigured) {
    console.log(`\n[SMS · sağlayıcı ayarlı değil]\nKime: ${to}\n${body}\n`);
    return;
  }
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, From: from, Body: body }),
    });
    if (!res.ok) console.error('[SMS] gönderilemedi:', res.status, await res.text());
  } catch (err) {
    console.error('[SMS] gönderilemedi:', err.message);
  }
}
