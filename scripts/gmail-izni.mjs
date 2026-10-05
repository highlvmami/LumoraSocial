/*
 * Gmail ile e-posta gönderme izni alır ve GMAIL_REFRESH_TOKEN'ı .env dosyasına yazar.
 * Önce .env'e GMAIL_CLIENT_ID ve GMAIL_CLIENT_SECRET girilmiş olmalı (Google Cloud > Kimlik bilgileri >
 * OAuth istemci kimliği, tür: Masaüstü uygulaması). Çalıştırma: npm run gmail-izni
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.env');
process.loadEnvFile(envPath);
const clientId = process.env.GMAIL_CLIENT_ID;
const clientSecret = process.env.GMAIL_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error('.env dosyasında GMAIL_CLIENT_ID ve GMAIL_CLIENT_SECRET olmalı.');
  process.exit(1);
}

const PORT = 53682;
const redirectUri = `http://127.0.0.1:${PORT}`;
const authUrl =
  'https://accounts.google.com/o/oauth2/v2/auth?' +
  new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/gmail.send',
    access_type: 'offline',
    prompt: 'consent',
  });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, redirectUri);
  const code = url.searchParams.get('code');
  if (!code) {
    res.end(url.searchParams.get('error') || 'Kod bekleniyor.');
    return;
  }
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
  });
  const data = await tokenRes.json();
  if (!data.refresh_token) {
    res.end('İzin alınamadı: ' + (data.error_description || data.error || 'refresh_token yok'));
    console.error('İzin alınamadı:', data.error, data.error_description || '');
    process.exit(1);
  }
  let env = fs.readFileSync(envPath, 'utf8');
  const line = `GMAIL_REFRESH_TOKEN=${data.refresh_token}`;
  env = /^GMAIL_REFRESH_TOKEN=.*$/m.test(env) ? env.replace(/^GMAIL_REFRESH_TOKEN=.*$/m, line) : env.replace(/\s*$/, '\n') + line + '\n';
  fs.writeFileSync(envPath, env);
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end('<h2>Tamam! Gmail izni alındı, bu sekmeyi kapatabilirsin.</h2>');
  console.log('GMAIL_REFRESH_TOKEN .env dosyasına yazıldı.');
  server.close();
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('Tarayıcıda bu adresi aç ve lumorasocial.destek hesabıyla izin ver:\n' + authUrl);
  if (process.platform === 'win32') exec(`start "" "${authUrl}"`);
});
