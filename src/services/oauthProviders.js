import { config } from '../config.js';

/*
 * Sosyal giriş sağlayıcıları. Her sağlayıcı:
 *   authUrl(state, redirectUri)           → kullanıcının yönlendirileceği adres
 *   fetchProfile(code, redirectUri) → { id, email, emailVerified, name }
 * Yeni bir sağlayıcı eklemek için bu nesneye bir giriş eklemek yeterli.
 */

const { google, github } = config.oauth;

async function postForm(url, params, headers = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', ...headers },
    body: new URLSearchParams(params),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(`Belirteç alınamadı: ${data.error_description || data.error || res.status}`);
  return data;
}

async function getJson(url, token) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'User-Agent': 'LumoraSocial' },
  });
  if (!res.ok) throw new Error(`Profil alınamadı (${res.status})`);
  return res.json();
}

export const providers = {
  google: {
    label: 'Google',
    enabled: () => Boolean(google.clientId && google.clientSecret),
    authUrl: (state, redirectUri) =>
      `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
        client_id: google.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'openid email profile',
        state,
        prompt: 'select_account',
      })}`,
    async fetchProfile(code, redirectUri) {
      const tokens = await postForm('https://oauth2.googleapis.com/token', {
        code,
        client_id: google.clientId,
        client_secret: google.clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      });
      const p = await getJson('https://openidconnect.googleapis.com/v1/userinfo', tokens.access_token);
      return { id: String(p.sub), email: p.email || null, emailVerified: p.email_verified === true, name: p.name || '' };
    },
  },

  github: {
    label: 'GitHub',
    enabled: () => Boolean(github.clientId && github.clientSecret),
    authUrl: (state, redirectUri) =>
      `${github.webBase}/login/oauth/authorize?${new URLSearchParams({
        client_id: github.clientId,
        redirect_uri: redirectUri,
        scope: 'read:user user:email',
        state,
        allow_signup: 'true',
      })}`,
    async fetchProfile(code, redirectUri) {
      const tokens = await postForm(`${github.webBase}/login/oauth/access_token`, {
        code,
        client_id: github.clientId,
        client_secret: github.clientSecret,
        redirect_uri: redirectUri,
      });
      const p = await getJson(`${github.apiBase}/user`, tokens.access_token);
      const emails = await getJson(`${github.apiBase}/user/emails`, tokens.access_token).catch(() => []);
      const primary = Array.isArray(emails) ? emails.find((e) => e.primary && e.verified) : null;
      return { id: String(p.id), email: primary?.email || null, emailVerified: Boolean(primary), name: p.name || p.login || '' };
    },
  },

};

export function enabledProviders() {
  return Object.entries(providers)
    .filter(([, p]) => p.enabled())
    .map(([key, p]) => ({ key, label: p.label }));
}

export const redirectUriFor = (key) => `${config.appUrl}/auth/${key}/callback`;
