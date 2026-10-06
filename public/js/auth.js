import { api, bindPasswordConfirm, h, handleForm, showAlert } from './common.js';

// Geri tuşuyla önbellekten açılırsa sunucuya yeniden sor (oturum açıksa doğrudan akışa gider)
window.addEventListener('pageshow', (e) => e.persisted && location.reload());

const forms = { login: document.getElementById('login-form'), register: document.getElementById('register-form') };

function showTab(tab) {
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  for (const [name, form] of Object.entries(forms)) form.classList.toggle('hidden', name !== tab);
}
document.querySelectorAll('.tabs button').forEach((btn) => btn.addEventListener('click', () => showTab(btn.dataset.tab)));

/* Sosyal girişten dönen hata mesajı (?hata=...) */
const params = new URLSearchParams(location.search);
if (params.get('hata')) showAlert(document.getElementById('page-alert'), params.get('hata'));
if (params.get('kayit') !== null) showTab('register');

/* Kayıt yöntemi: e-posta / telefon / kullanıcı adı */
const reg = forms.register;
const notes = {
  email: 'E-postana bir doğrulama bağlantısı göndereceğiz.',
  phone: 'Telefonuna SMS ile bir doğrulama kodu göndereceğiz.',
  username: 'Yalnızca kullanıcı adı ve şifreyle kayıt olursun. Şifreni unutursan bir yönetici sıfırlayabilir; sonradan e-posta veya telefon ekleyebilirsin.',
};
function setMethod(method) {
  reg.method.value = method;
  document.querySelectorAll('#register-method button').forEach((b) => b.classList.toggle('active', b.dataset.method === method));
  reg.querySelectorAll('[data-for]').forEach((el) => {
    const on = el.dataset.for === method;
    el.classList.toggle('hidden', !on);
    el.querySelector('input').required = on;
  });
  document.getElementById('method-note').textContent = notes[method];
}
document.querySelectorAll('#register-method button').forEach((b) => b.addEventListener('click', () => setMethod(b.dataset.method)));
setMethod('email');
bindPasswordConfirm(reg.password, reg.passwordConfirm);

handleForm(forms.login, document.getElementById('login-alert'), async (data) => {
  await api('/auth/login', { method: 'POST', body: data });
  location.replace('/akis' + location.search);
});

handleForm(reg, document.getElementById('register-alert'), async (data) => {
  await api('/auth/register', { method: 'POST', body: data });
  location.replace('/akis' + location.search);
});

/* Sosyal giriş butonları (yalnızca .env'de ayarlı olanlar) */
const icons = { google: 'G', github: 'GH' };
api('/auth/providers').then(({ providers, sms }) => {
  if (!sms) document.querySelector('#register-method [data-method="phone"]')?.remove();
  if (!providers.length) return;
  document.getElementById('social').classList.remove('hidden');
  document.getElementById('social-buttons').replaceChildren(
    ...providers.map((p) =>
      h('a', { class: `btn ghost social-btn ${p.key}`, href: `/auth/${p.key}/start` }, h('span', { class: 'social-icon' }, icons[p.key] || '•'), `${p.label} ile devam et`)
    )
  );
});
