import { api, bindPasswordConfirm, handleForm, showAlert } from './common.js';

const loginForm = document.getElementById('login-form');
const setupForm = document.getElementById('setup-form');
const setupClosed = document.getElementById('setup-closed');
bindPasswordConfirm(setupForm.password, setupForm.passwordConfirm);
let setupAvailable = false;

function showTab(tab) {
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  loginForm.classList.toggle('hidden', tab !== 'login');
  setupForm.classList.toggle('hidden', tab !== 'setup' || !setupAvailable);
  setupClosed.classList.toggle('hidden', tab !== 'setup' || setupAvailable);
}

document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

const status = await api('/auth/admin-setup');
setupAvailable = status.available;
showAlert(
  setupClosed,
  status.keyConfigured
    ? 'İlk yönetici kaydı daha önce yapıldı; bu ekran kapatıldı. Yeni yöneticiler yönetim panelinden eklenir.'
    : 'Sunucuda yönetici anahtarı (ADMIN_SETUP_KEY) ayarlanmamış. .env dosyasını düzenleyip sunucuyu yeniden başlatın.',
  'error'
);
showTab(setupAvailable && location.hash === '#kayit' ? 'setup' : 'login');

handleForm(loginForm, document.getElementById('login-alert'), async (data) => {
  await api('/auth/login', { method: 'POST', body: { ...data, adminOnly: true } });
  location.href = '/yonetim';
});

handleForm(setupForm, document.getElementById('setup-alert'), async (data) => {
  await api('/auth/admin-setup', { method: 'POST', body: data });
  location.href = '/yonetim';
});
