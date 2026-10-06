import { api, avatar, badge, formatDate, h, handleForm, logout, showAlert, toast, confirmDialog, promptDialog } from './common.js';

const { user: me } = await api('/auth/me');
if (!me || me.role === 'member') {
  location.href = '/admin-giris';
  throw new Error('Yetki yok');
}
document.getElementById('whoami').textContent = `${me.displayName} (@${me.username}) olarak giriş yapıldı${me.role === 'moderator' ? ' · Denetimci' : ''}`;
// Denetimci yalnızca şikâyetleri görür
const isModerator = me.role === 'moderator';
if (isModerator) {
  document.querySelectorAll('.admin-tabs a[data-view="users"], .admin-tabs a[data-view="logs"]').forEach((a) => a.remove());
  document.title = 'Denetim Paneli · LumoraSocial';
}
document.getElementById('logout-btn').addEventListener('click', logout);

async function loadStats() {
  const s = await api('/admin/stats');
  paintReportCount(s.openReports);
  const items = [
    ['Kullanıcı', s.users],
    ['Yönetici', s.admins],
    ['Paylaşım', s.posts],
    ['Yorum', s.comments],
  ];
  document.getElementById('stats').replaceChildren(
    ...items.map(([label, n]) => h('div', { class: 'card stat' }, h('div', { class: 'num' }, n), h('div', { class: 'muted small' }, label)))
  );
}

async function action(fn, successMsg) {
  try {
    await fn();
    toast(successMsg);
    await Promise.all([loadUsers(), loadStats()]);
  } catch (err) {
    toast(err.message, 'error');
  }
}

function userRow(u) {
  const isMe = u.id === me.id;
  const btn = (label, onclick, cls = 'ghost') => h('button', { type: 'button', class: `btn sm ${cls}`, onclick }, label);

  const actions = [];
  if (!isMe) {
    const setRole = (role, msg) => () => action(() => api(`/admin/users/${u.id}/role`, { method: 'PATCH', body: { role } }), msg);
    actions.push(
      u.role === 'admin' ? btn('Üye yap', setRole('member', 'Yönetici yetkisi kaldırıldı.')) : btn('Yönetici yap', setRole('admin', 'Kullanıcı yönetici yapıldı.')),
      u.role === 'moderator'
        ? btn('Denetimciliği kaldır', setRole('member', 'Denetimci yetkisi kaldırıldı.'))
        : u.role === 'member'
          ? btn('Denetimci yap', setRole('moderator', 'Kullanıcı denetimci yapıldı.'))
          : null,
      u.status === 'active'
        ? btn('Askıya al', () => action(() => api(`/admin/users/${u.id}/status`, { method: 'PATCH', body: { status: 'banned' } }), 'Kullanıcı askıya alındı.'))
        : btn('Etkinleştir', () => action(() => api(`/admin/users/${u.id}/status`, { method: 'PATCH', body: { status: 'active' } }), 'Kullanıcı etkinleştirildi.'))
    );
  }
  actions.push(
    btn('Şifre sıfırla', async () => {
      const password = await promptDialog(`@${u.username} için yeni şifreyi yaz. Kullanıcı bu şifreyle giriş yapacak.`, { title: 'Şifre sıfırla', type: 'password', placeholder: 'En az 8 karakter', minLength: 8 });
      if (password) action(() => api(`/admin/users/${u.id}/password`, { method: 'POST', body: { password } }), 'Şifre güncellendi.');
    })
  );
  actions.push(
    u.isVerified
      ? btn('Rozeti kaldır', () => action(() => api(`/admin/users/${u.id}/verified`, { method: 'PATCH', body: { verified: false } }), 'Doğrulama rozeti kaldırıldı.'))
      : btn('✓ Doğrula', () => action(() => api(`/admin/users/${u.id}/verified`, { method: 'PATCH', body: { verified: true } }), 'Hesaba doğrulama rozeti verildi.'))
  );
  if (u.avatarUrl) {
    actions.push(
      btn('Fotoğrafı kaldır', async () => {
        if (await confirmDialog(`@${u.username} kullanıcısının profil fotoğrafı kaldırılsın mı?`)) {
          action(() => api(`/admin/users/${u.id}/avatar`, { method: 'DELETE' }), 'Profil fotoğrafı kaldırıldı.');
        }
      })
    );
  }
  if (!isMe) {
    actions.push(
      btn(
        'Sil',
        async () => {
          if (await confirmDialog(`@${u.username} ve tüm paylaşımları kalıcı olarak silinsin mi?`)) {
            action(() => api(`/admin/users/${u.id}`, { method: 'DELETE' }), 'Kullanıcı silindi.');
          }
        },
        'danger'
      )
    );
  }

  return h(
    'tr',
    {},
    h(
      'td',
      {},
      h(
        'div',
        { class: 'user-cell' },
        avatar(u, 'sm'),
        h(
          'div',
          {},
          h('div', {}, u.displayName, badge(u), isMe ? ' (sen)' : ''),
          h('div', { class: 'muted small' }, `@${u.username} · ${formatDate(u.createdAt)}`),
          u.email ? h('div', { class: 'muted small' }, `${u.email}${u.emailVerified ? ' ✓' : ' (doğrulanmadı)'}`) : null,
          u.phone ? h('div', { class: 'muted small' }, `${u.phone}${u.phoneVerified ? ' ✓' : ' (doğrulanmadı)'}`) : null
        )
      )
    ),
    h('td', {}, h('span', { class: `pill ${u.role}` }, { admin: 'Yönetici', moderator: 'Denetimci', member: 'Üye' }[u.role])),
    h('td', {}, h('span', { class: `pill ${u.status}` }, u.status === 'active' ? 'Aktif' : 'Askıda')),
    h('td', {}, u.postCount),
    h('td', {}, h('div', { class: 'actions' }, actions))
  );
}

const searchInput = document.getElementById('search');
async function loadUsers() {
  const { users } = await api(`/admin/users?search=${encodeURIComponent(searchInput.value.trim())}`);
  const tbody = document.getElementById('users');
  tbody.replaceChildren(...(users.length ? users.map(userRow) : [h('tr', {}, h('td', { colspan: 5, class: 'muted' }, 'Kullanıcı bulunamadı.'))]));
}

let searchTimer;
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadUsers, 250);
});

const createForm = document.getElementById('create-form');
const createAlert = document.getElementById('create-alert');
handleForm(createForm, createAlert, async (data) => {
  const { user } = await api('/admin/users', { method: 'POST', body: data });
  createForm.reset();
  showAlert(createAlert, `@${user.username} ${user.role === 'admin' ? 'yönetici' : 'üye'} olarak oluşturuldu.`, 'success');
  await Promise.all([loadUsers(), loadStats()]);
});


/* ================= Kayıtlar (log) ================= */

const REASONS = { wrong_password: 'şifre hatalı', unknown_user: 'böyle bir kullanıcı yok', banned: 'hesap askıda' };
const PROVIDERS = { google: 'Google', github: 'GitHub' };
const METHODS = { email: 'e-posta', phone: 'telefon', username: 'kullanıcı adı' };

/** Olay türü → [simge, başlık, ayrıntı metni]. Yeni olay türü eklerken buraya satır eklemek yeterli. */
const LABELS = {
  'user.register': ['', 'Üye kaydı', (d) => `${METHODS[d.method] || d.method} ile kayıt oldu`],
  'user.register_oauth': ['', 'Üye kaydı', (d) => `${PROVIDERS[d.provider] || d.provider} ile kayıt oldu`],
  'admin.setup': ['', 'İlk yönetici kaydı', () => 'KEY ile ilk yönetici oluşturuldu'],
  'admin.user_create': ['', 'Kullanıcı oluşturuldu', (d) => (d.role === 'admin' ? 'yönetici olarak' : 'üye olarak')],
  'auth.login': ['', 'Giriş', (d) => (d.admin ? 'yönetici girişi' : 'şifreyle')],
  'auth.login_oauth': ['', 'Giriş', (d) => `${PROVIDERS[d.provider] || d.provider} ile`],
  'auth.logout': ['', 'Çıkış', () => ''],
  'auth.login_failed': ['', 'Başarısız giriş', (d) => `"${d.identifier}" · ${REASONS[d.reason] || d.reason}`],
  'account.username': ['', 'Kullanıcı adı değişti', (d) => `@${d.from} → @${d.to}`],
  'account.email': ['', 'E-posta değişti', (d) => d.email],
  'account.email_verified': ['', 'E-posta doğrulandı', (d) => d.email],
  'account.phone': ['', 'Telefon değişti', (d) => d.phone],
  'account.phone_verified': ['', 'Telefon doğrulandı', (d) => d.phone],
  'account.password': ['', 'Şifre değişti', (d) => (d.firstTime ? 'ilk kez şifre belirlendi' : '')],
  'account.password_reset_request': ['', 'Şifre sıfırlama istendi', () => ''],
  'account.password_reset': ['', 'Şifre sıfırlandı', (d) => (d.via === 'email' ? 'e-posta bağlantısıyla' : 'SMS koduyla')],
  'account.logout_all': ['', 'Tüm cihazlardan çıkış', (d) => (d.includeCurrent ? 'bu cihaz dahil' : 'diğer cihazlar')],
  'account.privacy': ['', 'Gizlilik değişti', (d) => (d.privateAccount ? 'hesap gizli yapıldı' : 'hesap herkese açık yapıldı')],
  'account.oauth_link': ['', 'Hesap bağlandı', (d) => PROVIDERS[d.provider] || d.provider],
  'account.oauth_unlink': ['', 'Hesap bağlantısı kaldırıldı', (d) => PROVIDERS[d.provider] || d.provider],
  'admin.role': ['', 'Rol değişti', (d) => ({ admin: 'yönetici yapıldı', moderator: 'denetimci yapıldı' })[d.role] || 'üye yapıldı'],
  'admin.status': ['', 'Hesap durumu', (d) => (d.status === 'banned' ? 'askıya alındı' : 'etkinleştirildi')],
  'admin.delete_user': ['', 'Kullanıcı silindi', (d) => `${d.displayName} (@${d.username})`],
  'admin.password': ['', 'Şifre sıfırlandı (yönetici)', () => ''],
  'admin.badge': ['✓', 'Doğrulama rozeti', (d) => (d.verified ? 'verildi' : 'kaldırıldı')],
  'admin.remove_avatar': ['', 'Profil fotoğrafı kaldırıldı', () => ''],
  'admin.delete_post': ['', 'Paylaşım silindi (yönetici)', (d) => (d.preview ? `"${d.preview}"` : '')],
  'admin.delete_comment': ['', 'Yorum silindi (yönetici)', (d) => (d.preview ? `"${d.preview}"` : '')],
  'post.create': ['', 'Paylaşım', (d) => [d.preview ? `"${d.preview}"` : '', d.images ? `${d.images}` : ''].filter(Boolean).join(' · ')],
  'post.delete': ['', 'Paylaşımını sildi', (d) => (d.preview ? `"${d.preview}"` : '')],
  'account.block': ['', 'Engelledi', () => ''],
  'account.unblock': ['', 'Engeli kaldırdı', () => ''],
  'report.create': ['', 'Şikâyet', (d) => `${{ post: 'paylaşım', comment: 'yorum', user: 'kullanıcı' }[d.type]} · ${d.reason}`],
  'admin.report_resolve': ['', 'Şikâyet sonuçlandı', (d) => ({ resolve: 'çözüldü', delete_content: 'içerik silindi', ban_user: 'kullanıcı askıya alındı' })[d.action] || ''],
  'admin.report_dismiss': ['', 'Şikâyet yok sayıldı', () => ''],
};

const userTag = (u) => (u ? h('b', {}, `@${u.username || '(silinmiş)'}`) : null);
const localIp = (ip) => (['::1', '127.0.0.1'].includes(ip) ? 'bu bilgisayar' : ip);
const logTime = (s) =>
  new Date(s.replace(' ', 'T') + 'Z').toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });

function logRow(l) {
  const [icon, title, detail] = LABELS[l.action] || ['•', l.action, () => ''];
  const who = [userTag(l.actor)];
  // Hedef farklıysa: "@yonetici → @uye"
  if (l.target && l.target.id !== l.actor?.id) who.push(l.actor ? ' → ' : '', userTag(l.target));
  const danger = l.action === 'auth.login_failed' || l.action.startsWith('admin.delete');
  return h(
    'tr',
    { class: danger ? 'log-danger' : '' },
    h('td', { class: 'nowrap muted small' }, logTime(l.createdAt)),
    h('td', { class: 'nowrap' }, [icon, title].filter(Boolean).join(' ')),
    h('td', {}, who.filter((x) => x !== null)),
    h('td', { class: 'small' }, detail(l.data || {}) || h('span', { class: 'muted' }, '—')),
    h('td', { class: 'muted small nowrap' }, [localIp(l.ip), l.device].filter(Boolean).join(' · '))
  );
}

const logState = { before: null };
const logBody = document.getElementById('logs');
const logMore = document.getElementById('logs-more');
const logCategory = document.getElementById('log-category');
const logSearch = document.getElementById('log-search');

async function loadLogs(reset = false) {
  if (reset) {
    logState.before = null;
    logBody.replaceChildren();
  }
  const params = new URLSearchParams({ category: logCategory.value, search: logSearch.value.trim() });
  if (logState.before) params.set('before', logState.before);
  const { logs, hasMore } = await api(`/admin/logs?${params}`);
  if (reset && !logs.length) logBody.append(h('tr', {}, h('td', { colspan: 5, class: 'muted' }, 'Kayıt bulunamadı.')));
  logs.forEach((l) => logBody.append(logRow(l)));
  logState.before = logs.at(-1)?.id ?? logState.before;
  logMore.classList.toggle('hidden', !hasMore);
}

async function loadLogSummary() {
  const { last24h: s } = await api('/admin/stats');
  document.getElementById('log-summary').replaceChildren(
    ...[
      ['Yeni üye', s.registrations],
      ['Giriş', s.logins],
      ['Başarısız giriş', s.failedLogins],
    ].map(([label, n]) => h('div', { class: 'card stat' }, h('div', { class: 'num' }, n), h('div', { class: 'muted small' }, `${label} · son 24 saat`)))
  );
}

logMore.addEventListener('click', () => loadLogs());
logCategory.addEventListener('change', () => loadLogs(true));
let logTimer;
logSearch.addEventListener('input', () => {
  clearTimeout(logTimer);
  logTimer = setTimeout(() => loadLogs(true), 300);
});


/* ================= Şikâyetler ================= */

const TYPE_LABELS = { post: 'Paylaşım', comment: 'Yorum', user: 'Kullanıcı' };
const STATUS_LABELS = { open: 'Bekliyor', resolved: 'Çözüldü', dismissed: 'Yok sayıldı' };
const reportState = { before: null };
const reportsBox = document.getElementById('reports');
const reportsMore = document.getElementById('reports-more');
const reportStatus = document.getElementById('report-status');

function paintReportCount(n) {
  const el = document.getElementById('report-count');
  el.textContent = n;
  el.classList.toggle('hidden', !n);
}

function reportCard(r) {
  const act = (action, confirmText) => async () => {
    if (confirmText && !await confirmDialog(confirmText)) return;
    try {
      const res = await api(`/admin/reports/${r.id}`, { method: 'POST', body: { action } });
      paintReportCount(res.openCount);
      toast('Şikâyet sonuçlandırıldı.');
      loadReports(true);
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  const t = r.targetUser;
  const viewLink =
    r.targetExists && r.type !== 'user' && r.postId
      ? h('a', { class: 'btn sm ghost', href: `/akis#/p/${r.postId}`, target: '_blank' }, 'Paylaşımı aç ↗')
      : t
        ? h('a', { class: 'btn sm ghost', href: `/akis#/u/${encodeURIComponent(t.username)}`, target: '_blank' }, 'Profili aç ↗')
        : null;

  return h(
    'div',
    { class: 'report-card' },
    h(
      'div',
      { class: 'report-head' },
      h(
        'div',
        {},
        h('b', {}, `${TYPE_LABELS[r.type]} · ${r.reasonLabel}`),
        r.openCount > 1 && r.status === 'open' ? h('span', { class: 'pill open', title: 'Aynı içerik için açık şikâyet sayısı' }, ` ${r.openCount} şikâyet`) : null,
        h(
          'div',
          { class: 'muted small' },
          `${logTime(r.createdAt)} · şikâyet eden: ${r.reporter ? `@${r.reporter.username}` : '(silinmiş)'} · hakkında: `,
          t ? h('b', {}, `@${t.username}`) : '(silinmiş kullanıcı)',
          t?.status === 'banned' ? ' (askıda)' : ''
        )
      ),
      h('span', { class: `pill ${r.status}` }, STATUS_LABELS[r.status])
    ),
    h('div', { class: 'report-snapshot' }, r.snapshot || '(boş)', !r.targetExists && r.type !== 'user' ? h('div', { class: 'muted small' }, '— Bu içerik artık silinmiş.') : null),
    r.details ? h('div', { class: 'small' }, h('b', {}, 'Açıklama: '), r.details) : null,
    r.status === 'open'
      ? h(
          'div',
          { class: 'report-actions' },
          viewLink,
          r.type !== 'user' && r.targetExists
            ? h('button', { class: 'btn sm danger', type: 'button', onclick: act('delete_content', 'İçerik silinsin mi?') }, 'İçeriği sil')
            : null,
          !isModerator && t && t.status !== 'banned' && t.id !== me.id
            ? h('button', { class: 'btn sm danger', type: 'button', onclick: act('ban_user', `@${t.username} askıya alınsın mı?`) }, 'Kullanıcıyı askıya al')
            : null,
          h('button', { class: 'btn sm', type: 'button', onclick: act('resolve') }, '✓ Çözüldü'),
          h('button', { class: 'btn sm ghost', type: 'button', onclick: act('dismiss') }, 'Yok say')
        )
      : h('div', { class: 'muted small' }, `${r.resolution} · @${r.resolvedBy || '?'} · ${r.resolvedAt ? logTime(r.resolvedAt) : ''}`, viewLink ? ' · ' : '', viewLink)
  );
}

async function loadReports(reset = false) {
  if (reset) {
    reportState.before = null;
    reportsBox.replaceChildren();
  }
  const params = new URLSearchParams({ status: reportStatus.value });
  if (reportState.before) params.set('before', reportState.before);
  const { reports, hasMore, openCount } = await api(`/admin/reports?${params}`);
  paintReportCount(openCount);
  if (reset && !reports.length) reportsBox.append(h('div', { class: 'empty-state' }, reportStatus.value === 'open' ? 'Bekleyen şikâyet yok. ' : 'Şikâyet yok.'));
  reports.forEach((r) => reportsBox.append(reportCard(r)));
  reportState.before = reports.at(-1)?.id ?? reportState.before;
  reportsMore.classList.toggle('hidden', !hasMore);
}

reportStatus.addEventListener('change', () => loadReports(true));
reportsMore.addEventListener('click', () => loadReports());

/* Sekmeler: #kullanicilar / #kayitlar */
function showView() {
  const view = isModerator ? 'reports' : { '#kayitlar': 'logs', '#sikayetler': 'reports' }[location.hash] || 'users';
  document.querySelectorAll('.admin-tabs a').forEach((a) => a.classList.toggle('active', a.dataset.view === view));
  document.getElementById('view-users').classList.toggle('hidden', view !== 'users');
  document.getElementById('view-logs').classList.toggle('hidden', view !== 'logs');
  document.getElementById('view-reports').classList.toggle('hidden', view !== 'reports');
  if (view === 'logs') return Promise.all([loadLogs(true), loadLogSummary()]);
  if (view === 'reports') return loadReports(true);
  return Promise.all([loadUsers(), loadStats()]);
}
window.addEventListener('hashchange', showView);
await showView();
