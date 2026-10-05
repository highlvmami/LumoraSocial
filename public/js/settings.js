import { api, avatar, bindPasswordConfirm, cropImage, h, handleForm, showAlert, SOCIALS, squareImage, timeAgo, toast } from './common.js';

/* Ayarlar sayfası: Profil · Hesap · Güvenlik · Gizlilik */

const TABS = [
  ['profil', 'Profil'],
  ['hesap', 'Hesap'],
  ['guvenlik', 'Güvenlik'],
  ['gizlilik', 'Gizlilik'],
  ['gorunum', 'Görünüm'],
];

const section = (title, desc, ...children) =>
  h('section', { class: 'card panel settings-section' }, h('h3', {}, title), desc ? h('p', { class: 'muted small' }, desc) : null, ...children);

const field = (label, input, hint) => h('div', { class: 'field' }, h('label', {}, label, input), hint ? h('div', { class: 'muted small' }, hint) : null);

const alertBox = () => h('div', { class: 'alert hidden' });

const pill = (ok, yes = 'Doğrulandı', no = 'Doğrulanmadı') => h('span', { class: `pill ${ok ? 'active' : 'banned'}` }, ok ? yes : no);

export async function showSettings(ctx, tab, params) {
  const { main } = ctx;
  if (!TABS.some(([k]) => k === tab)) tab = 'profil';
  const body = h('div', { class: 'settings-body' });
  main.replaceChildren(
    h('div', { class: 'feed-header' }, h('h2', {}, 'Ayarlar')),
    h('nav', { class: 'tabs feed-tabs settings-tabs' }, TABS.map(([k, label]) => h('a', { href: `#/ayarlar/${k}`, class: k === tab ? 'active' : '' }, label))),
    body
  );

  // Sosyal girişten dönüşte gelen mesaj (?bilgi=... / ?hata=...)
  if (params.get('bilgi') || params.get('hata')) {
    const a = alertBox();
    showAlert(a, params.get('bilgi') || params.get('hata'), params.get('bilgi') ? 'success' : 'error');
    body.append(a);
  }

  const renderers = { profil: profileTab, hesap: accountTab, guvenlik: securityTab, gizlilik: privacyTab, gorunum: appearanceTab };
  body.append(...(await renderers[tab](ctx)));
}

/* ---------------- Profil ---------------- */

function imagePicker({ label, accept = 'image/jpeg,image/png,image/webp', onPick }) {
  const input = h('input', { type: 'file', accept, class: 'visually-hidden' });
  const lbl = h('label', { class: 'btn sm' }, label, input);
  input.addEventListener('change', async () => {
    const file = input.files[0];
    input.value = '';
    if (file) await onPick(file);
  });
  return lbl;
}

function profileTab(ctx) {
  const me = ctx.state.me;
  const refresh = (user) => {
    ctx.setMe(user);
    ctx.route();
  };

  /* Kapak ve profil fotoğrafı: seçilince hemen yüklenir */
  const photoAlert = alertBox();
  const upload = (endpoint, crop, msg) => async (file) => {
    photoAlert.classList.add('hidden');
    try {
      const blob = await crop(file);
      refresh((await api(endpoint, { method: 'PUT', blob })).user);
      toast(msg);
    } catch (err) {
      showAlert(photoAlert, err.message);
    }
  };
  const remove = (endpoint, msg) => async () => {
    if (!confirm(`${msg} kaldırılsın mı?`)) return;
    refresh((await api(endpoint, { method: 'DELETE' })).user);
  };

  const photos = section(
    'Fotoğraflar',
    'JPG, PNG veya WEBP. Kapak 3:1, profil fotoğrafı kare olarak kırpılır.',
    h('div', { class: 'cover edit', style: me.coverUrl ? { backgroundImage: `url("${me.coverUrl}")` } : {} }),
    h(
      'div',
      { class: 'photo-row' },
      avatar(me, 'lg'),
      h(
        'div',
        { class: 'photo-actions' },
        imagePicker({ label: 'Profil fotoğrafı seç', onPick: upload('/users/me/avatar', (f) => squareImage(f), 'Profil fotoğrafı güncellendi.') }),
        me.avatarUrl ? h('button', { class: 'btn sm ghost', type: 'button', onclick: remove('/users/me/avatar', 'Profil fotoğrafı') }, 'Kaldır') : null,
        imagePicker({ label: 'Kapak fotoğrafı seç', onPick: upload('/users/me/cover', (f) => cropImage(f, 1500, 500), 'Kapak fotoğrafı güncellendi.') }),
        me.coverUrl ? h('button', { class: 'btn sm ghost', type: 'button', onclick: remove('/users/me/cover', 'Kapak fotoğrafı') }, 'Kapağı kaldır') : null
      )
    ),
    h('label', {}, 'Profil rengi (fotoğraf yoksa)'),
    h(
      'div',
      { class: 'colors' },
      ctx.state.colors.map((c) =>
        h('button', {
          type: 'button',
          class: `color-dot ${c === me.avatarColor ? 'selected' : ''}`,
          style: { background: c },
          'aria-label': `Renk ${c}`,
          onclick: async () => refresh((await api('/users/me', { method: 'PATCH', body: { avatarColor: c } })).user),
        })
      )
    ),
    photoAlert
  );

  /* Bilgiler */
  const input = (name, value, attrs = {}) => h('input', { name, value: value ?? '', ...attrs });
  const socialInputs = ctx.state.socialKeys.map((k) =>
    field(`${SOCIALS[k]?.icon || ''} ${SOCIALS[k]?.label || k}`, input(`social_${k}`, me.socialLinks?.[k], { placeholder: 'kullanıcı adı veya adres', maxlength: 100 }))
  );
  const infoAlert = alertBox();
  const form = h(
    'form',
    { class: 'settings-form' },
    h('div', { class: 'grid-2' },
      field('Görünen ad', input('displayName', me.displayName, { maxlength: 50, required: true })),
      field('Doğum tarihi', input('birthDate', me.birthDate, { type: 'date', max: new Date().toISOString().slice(0, 10) }))
    ),
    field('Biyografi', h('textarea', { name: 'bio', maxlength: 300, placeholder: 'Kendinden biraz bahset…' }, me.bio)),
    h('div', { class: 'grid-2' },
      field('Konum', input('location', me.location, { maxlength: 60, placeholder: 'Şehir, ülke' })),
      field('Web sitesi', input('website', me.website, { maxlength: 200, placeholder: 'ornek.com' })),
      field('Meslek', input('occupation', me.occupation, { maxlength: 60 })),
      field('Eğitim', input('education', me.education, { maxlength: 100, placeholder: 'Okul / bölüm' }))
    ),
    field('İlgi alanları', input('interests', (me.interests || []).join(', '), { maxlength: 400, placeholder: 'kitap, müzik, futbol' }), 'Virgülle ayır (en fazla 15).'),
    h('h4', {}, 'Sosyal medya bağlantıları'),
    h('div', { class: 'grid-2' }, socialInputs),
    infoAlert,
    h('div', { class: 'modal-actions' }, h('button', { class: 'btn', type: 'submit' }, 'Kaydet'))
  );
  handleForm(form, infoAlert, async (data) => {
    const socialLinks = Object.fromEntries(ctx.state.socialKeys.map((k) => [k, data[`social_${k}`] || '']));
    const interests = String(data.interests || '').split(',').map((s) => s.trim()).filter(Boolean);
    const { user } = await api('/users/me', {
      method: 'PATCH',
      body: {
        displayName: data.displayName,
        bio: data.bio,
        birthDate: data.birthDate,
        location: data.location,
        website: data.website,
        occupation: data.occupation,
        education: data.education,
        interests,
        socialLinks,
      },
    });
    ctx.setMe(user);
    toast('Profil kaydedildi.');
  });

  return [photos, section('Profil bilgileri', 'Bu bilgiler profil sayfanda görünür. Doğum tarihi ve konumun kimlere görüneceğini Gizlilik sekmesinden seçebilirsin.', form)];
}

/* ---------------- Hesap ---------------- */

async function accountTab(ctx) {
  const me = ctx.state.me;
  const rerender = (user) => {
    if (user) ctx.setMe(user);
    ctx.route();
  };
  const pwField = () => (me.hasPassword ? field('Mevcut şifren', h('input', { name: 'currentPassword', type: 'password', autocomplete: 'current-password', required: true })) : null);

  /* Kullanıcı adı */
  const unAlert = alertBox();
  const unForm = h(
    'form',
    { class: 'inline-form' },
    h('span', { class: 'prefix' }, '@'),
    h('input', { name: 'username', value: me.username, minlength: 3, maxlength: 24, pattern: '[a-zA-Z0-9_.]+', required: true }),
    h('button', { class: 'btn', type: 'submit' }, 'Kaydet')
  );
  handleForm(unForm, unAlert, async ({ username }) => {
    rerender((await api('/account/username', { method: 'PATCH', body: { username } })).user);
    toast('Kullanıcı adın güncellendi.');
  });

  /* E-posta */
  const emAlert = alertBox();
  const emForm = h(
    'form',
    { class: 'settings-form' },
    field(me.email ? 'Yeni e-posta' : 'E-posta ekle', h('input', { name: 'email', type: 'email', required: true, autocomplete: 'email' })),
    pwField(),
    h('button', { class: 'btn', type: 'submit' }, me.email ? 'E-postayı değiştir' : 'E-posta ekle')
  );
  handleForm(emForm, emAlert, async (data) => {
    rerender((await api('/account/email', { method: 'PUT', body: data })).user);
    toast('Doğrulama bağlantısı gönderildi.');
  });
  const emailSection = section(
    'E-posta',
    'Doğrulanmış e-posta ile şifreni sıfırlayabilir, güvenlik uyarılarını alabilirsin.',
    me.email
      ? h(
          'div',
          { class: 'status-row' },
          h('b', {}, me.email),
          pill(me.emailVerified),
          !me.emailVerified
            ? h('button', {
                class: 'btn sm ghost',
                type: 'button',
                onclick: async () => {
                  try {
                    await api('/account/email/resend', { method: 'POST', body: {} });
                    showAlert(emAlert, 'Doğrulama bağlantısı gönderildi. E-postanı kontrol et.', 'success');
                  } catch (err) {
                    showAlert(emAlert, err.message);
                  }
                },
              }, 'Bağlantıyı tekrar gönder')
            : null,
          h('button', { class: 'btn sm ghost', type: 'button', onclick: async () => confirm('E-posta adresi hesabından kaldırılsın mı?') && rerender((await api('/account/email', { method: 'DELETE' })).user) }, 'Kaldır')
        )
      : h('p', { class: 'muted' }, 'Hesabına bağlı e-posta yok.'),
    emForm,
    emAlert
  );

  /* Telefon */
  const phAlert = alertBox();
  const codeForm = h(
    'form',
    { class: 'inline-form' },
    h('input', { name: 'code', inputmode: 'numeric', pattern: '\\d{6}', maxlength: 6, placeholder: '6 haneli kod', autocomplete: 'one-time-code', required: true }),
    h('button', { class: 'btn', type: 'submit' }, 'Doğrula'),
    h('button', {
      class: 'btn ghost',
      type: 'button',
      onclick: async () => {
        try {
          await api('/account/phone/send-code', { method: 'POST', body: {} });
          showAlert(phAlert, 'Yeni kod gönderildi.', 'success');
        } catch (err) {
          showAlert(phAlert, err.message);
        }
      },
    }, 'Kodu tekrar gönder')
  );
  handleForm(codeForm, phAlert, async ({ code }) => {
    rerender((await api('/account/phone/verify', { method: 'POST', body: { code } })).user);
    toast('Telefon numaran doğrulandı.');
  });
  const phForm = h(
    'form',
    { class: 'settings-form' },
    field(me.phone ? 'Yeni telefon' : 'Telefon ekle', h('input', { name: 'phone', type: 'tel', placeholder: '0532 123 45 67', required: true, autocomplete: 'tel' })),
    pwField(),
    h('button', { class: 'btn', type: 'submit' }, me.phone ? 'Telefonu değiştir' : 'Telefon ekle')
  );
  handleForm(phForm, phAlert, async (data) => {
    rerender((await api('/account/phone', { method: 'PUT', body: data })).user);
    toast('Doğrulama kodu SMS ile gönderildi.');
  });
  const phoneSection = section(
    'Telefon',
    'Doğrulanmış telefonla giriş yapabilir ve şifreni SMS koduyla sıfırlayabilirsin.',
    me.phone
      ? h(
          'div',
          { class: 'status-row' },
          h('b', {}, me.phone),
          pill(me.phoneVerified),
          h('button', { class: 'btn sm ghost', type: 'button', onclick: async () => confirm('Telefon numarası hesabından kaldırılsın mı?') && rerender((await api('/account/phone', { method: 'DELETE' })).user) }, 'Kaldır')
        )
      : h('p', { class: 'muted' }, 'Hesabına bağlı telefon yok.'),
    me.phone && !me.phoneVerified ? codeForm : null,
    phForm,
    phAlert
  );

  /* Bağlı hesaplar */
  const [{ accounts }, { sms }] = await Promise.all([api('/account/linked'), api('/auth/providers')]);
  const linkAlert = alertBox();
  const linkedSection = section(
    'Bağlı hesaplar',
    'Google veya GitHub hesabınla tek tıkla giriş yap.',
    accounts.length
      ? h(
          'div',
          { class: 'list' },
          accounts.map((a) =>
            h(
              'div',
              { class: 'list-row' },
              h('div', { class: 'grow' }, h('b', {}, a.label), a.email ? h('div', { class: 'muted small' }, a.email) : null),
              a.linked ? pill(true, 'Bağlı') : null,
              a.linked
                ? h('button', {
                    class: 'btn sm ghost',
                    type: 'button',
                    onclick: async () => {
                      if (!confirm(`${a.label} bağlantısı kaldırılsın mı?`)) return;
                      try {
                        await api(`/account/linked/${a.key}`, { method: 'DELETE' });
                        rerender();
                      } catch (err) {
                        showAlert(linkAlert, err.message);
                      }
                    },
                  }, 'Bağlantıyı kaldır')
                : a.enabled
                  ? h('a', { class: 'btn sm', href: `/auth/${a.key}/start?link=1` }, 'Bağla')
                  : null
            )
          )
        )
      : h('p', { class: 'muted' }, 'Sosyal giriş henüz sunucuda ayarlanmadı (.env dosyasına Google/GitHub anahtarları girilince burada görünür).'),
    linkAlert
  );

  return [section('Kullanıcı adı', 'Profil adresin: /u/kullanici-adin', unForm, unAlert), emailSection, sms || me.phone ? phoneSection : null, linkedSection].filter(Boolean);
}

/* ---------------- Güvenlik ---------------- */

const methodLabel = { password: 'Şifre', google: 'Google', github: 'GitHub' };
const ipLabel = (ip) => (!ip ? '?' : ['::1', '127.0.0.1'].includes(ip) ? 'bu bilgisayar' : ip);

async function securityTab(ctx) {
  const me = ctx.state.me;

  /* Şifre */
  const pwAlert = alertBox();
  const newPw = h('input', { name: 'newPassword', type: 'password', minlength: 8, autocomplete: 'new-password', required: true, placeholder: 'En az 8 karakter' });
  const newPw2 = h('input', { name: 'newPasswordConfirm', type: 'password', minlength: 8, autocomplete: 'new-password', required: true });
  bindPasswordConfirm(newPw, newPw2);
  const pwForm = h(
    'form',
    { class: 'settings-form' },
    me.hasPassword ? field('Mevcut şifre', h('input', { name: 'currentPassword', type: 'password', autocomplete: 'current-password', required: true })) : null,
    h('div', { class: 'grid-2' }, field('Yeni şifre', newPw), field('Yeni şifre (tekrar)', newPw2)),
    h('button', { class: 'btn', type: 'submit' }, me.hasPassword ? 'Şifreyi değiştir' : 'Şifre belirle')
  );
  handleForm(pwForm, pwAlert, async (data) => {
    const { user } = await api('/account/password', { method: 'POST', body: data });
    ctx.setMe(user);
    pwForm.reset();
    showAlert(pwAlert, 'Şifren güncellendi. Diğer cihazlardaki oturumların kapatıldı.', 'success');
    renderSessions();
  });

  /* Oturumlar */
  const sessionsBox = h('div', { class: 'list' });
  const devicesBox = h('div', { class: 'list' });
  async function renderSessions() {
    const { sessions, devices } = await api('/account/sessions');
    sessionsBox.replaceChildren(
      ...sessions.map((s) =>
        h(
          'div',
          { class: 'list-row' },
          
          h(
            'div',
            { class: 'grow' },
            h('b', {}, s.device),
            s.current ? h('span', { class: 'pill active' }, 'Bu cihaz') : null,
            h('div', { class: 'muted small' }, `IP ${ipLabel(s.ip)} · ${methodLabel[s.method] || s.method} ile giriş · ${s.createdAt ? timeAgo(new Date(s.createdAt).toISOString().replace('T', ' ').slice(0, 19)) : ''} · son etkinlik ${s.lastSeen ? timeAgo(new Date(s.lastSeen).toISOString().replace('T', ' ').slice(0, 19)) : '-'}`)
          ),
          h('button', {
            class: 'btn sm ghost',
            type: 'button',
            onclick: async () => {
              const res = await api(`/account/sessions/${s.id}`, { method: 'DELETE' });
              if (res.current) location.href = '/';
              else renderSessions();
            },
          }, 'Çıkış yap')
        )
      )
    );
    devicesBox.replaceChildren(
      ...devices.map((d) =>
        h(
          'div',
          { class: 'list-row' },
          
          h('div', { class: 'grow' }, h('b', {}, d.label), h('div', { class: 'muted small' }, `İlk giriş: ${timeAgo(d.firstSeen)} · Son giriş: ${timeAgo(d.lastSeen)}`))
        )
      )
    );
  }
  await renderSessions();

  const logoutAll = (includeCurrent) => async () => {
    const msg = includeCurrent ? 'Bu cihaz dahil tüm cihazlardan çıkış yapılsın mı?' : 'Bu cihaz dışındaki tüm oturumlar kapatılsın mı?';
    if (!confirm(msg)) return;
    await api('/account/sessions/logout-all', { method: 'POST', body: { includeCurrent } });
    if (includeCurrent) location.href = '/';
    else {
      toast('Diğer tüm oturumlar kapatıldı.');
      renderSessions();
    }
  };

  return [
    section(me.hasPassword ? 'Şifre' : 'Şifre belirle', me.hasPassword ? 'Şifreni değiştirince diğer cihazlardaki oturumların kapanır.' : 'Hesabını sosyal girişle açtın. Bir şifre belirlersen kullanıcı adınla da giriş yapabilirsin.', pwForm, pwAlert),
    section(
      'Aktif oturumlar',
      'Şu an hesabına giriş yapmış tarayıcı ve cihazlar. Tanımadığın bir oturum görürsen çıkış yap ve şifreni değiştir.',
      sessionsBox,
      h(
        'div',
        { class: 'modal-actions' },
        h('button', { class: 'btn ghost', type: 'button', onclick: logoutAll(false) }, 'Diğer cihazlardan çıkış yap'),
        h('button', { class: 'btn danger', type: 'button', onclick: logoutAll(true) }, 'Tüm cihazlardan çıkış yap')
      )
    ),
    section('Tanınan cihazlar', 'Daha önce giriş yapılan cihazlar. Yeni bir cihazdan veya şüpheli şekilde giriş yapılırsa sana bildirim (ve doğrulanmış e-postana uyarı) gönderilir.', devicesBox),
  ];
}

/* ---------------- Gizlilik ---------------- */

function privacyTab(ctx) {
  const p = ctx.state.me.privacy;
  const options = [
    ['public', 'Herkes'],
    ['followers', 'Takipçilerim'],
    ['private', 'Sadece ben'],
  ];
  const select = (name) => h('select', { name }, options.map(([v, l]) => h('option', { value: v, selected: p[name] === v }, l)));
  const alert = alertBox();
  const toggle = h('input', { type: 'checkbox', name: 'privateAccount', checked: p.privateAccount, class: 'switch' });
  const form = h(
    'form',
    { class: 'settings-form' },
    h(
      'label',
      { class: 'switch-row' },
      toggle,
      h('div', {}, h('b', {}, 'Gizli hesap'), h('div', { class: 'muted small' }, 'Açıksa paylaşımlarını yalnızca onayladığın takipçiler görür; yeni takipçiler istek gönderir. Kapatınca bekleyen istekler otomatik onaylanır.'))
    ),
    h('h4', {}, 'Profil bilgilerini kimler görebilir?'),
    h('div', { class: 'grid-2' },
      field('Doğum tarihi', select('birthDate')),
      field('Konum', select('location')),
      field('E-posta ve telefon', select('contact'), 'Yalnızca doğrulanmış olanlar gösterilir.')
    ),
    alert,
    h('div', { class: 'modal-actions' }, h('button', { class: 'btn', type: 'submit' }, 'Kaydet'))
  );
  handleForm(form, alert, async (data) => {
    const { user } = await api('/account/privacy', {
      method: 'PUT',
      body: { privateAccount: toggle.checked, birthDate: data.birthDate, location: data.location, contact: data.contact },
    });
    ctx.setMe(user);
    showAlert(alert, 'Gizlilik ayarların kaydedildi.', 'success');
  });
  // Engellenen kişiler
  const blockedBox = h('div', { class: 'list' });
  const renderBlocked = async () => {
    const { users } = await api('/account/blocked');
    blockedBox.replaceChildren(
      ...(users.length
        ? users.map((u) =>
            h(
              'div',
              { class: 'list-row' },
              avatar(u, 'sm'),
              h('div', { class: 'grow' }, h('b', {}, u.displayName), h('div', { class: 'muted small' }, `@${u.username}`)),
              h('button', {
                class: 'btn sm ghost',
                type: 'button',
                onclick: async () => {
                  await api(`/users/${encodeURIComponent(u.username)}/block`, { method: 'DELETE' });
                  toast(`@${u.username} kullanıcısının engeli kaldırıldı.`);
                  renderBlocked();
                },
              }, 'Engeli kaldır')
            )
          )
        : [h('p', { class: 'muted' }, 'Engellediğin kimse yok.')])
    );
  };
  renderBlocked();

  return [
    section('Gizlilik', null, form),
    section('Engellenen kişiler', 'Engellediğin kişilerle birbirinizin paylaşımlarını, yorumlarını ve profilini görmezsiniz; takip ve mesajlaşma kapanır.', blockedBox),
  ];
}

/* ---------------- Görünüm ---------------- */

export const THEMES = [
  ['light', '', 'Açık', 'Varsayılan. Aydınlık ve ferah görünüm.'],
  ['dark', '', 'Koyu', 'Gece kullanımı için göz yormayan koyu renkler.'],
];

export const getTheme = () => window.LumoraTheme.get();
export const setTheme = (theme) => window.LumoraTheme.set(theme);

function appearanceTab(ctx) {
  const current = getTheme();
  const cards = h(
    'div',
    { class: 'theme-options', role: 'radiogroup', 'aria-label': 'Tema' },
    THEMES.map(([key, icon, label, desc]) =>
      h(
        'button',
        {
          type: 'button',
          role: 'radio',
          'aria-checked': String(key === current),
          class: `theme-option theme-${key} ${key === current ? 'selected' : ''}`,
          onclick: () => {
            setTheme(key);
            ctx.route();
          },
        },
        h('div', { class: 'theme-preview' }, h('span'), h('span'), h('span')),
        h('b', {}, `${icon} ${label}`),
        h('div', { class: 'muted small' }, desc)
      )
    )
  );
  return [section('Tema', 'Seçimin bu cihazda saklanır. Sol menüdeki düğmeyle de hızlıca değiştirebilirsin.', cards)];
}
