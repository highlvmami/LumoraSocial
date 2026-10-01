import { api, avatar, h, nameWithBadge, timeAgo, toast } from './common.js';

const ipLabel = (ip) => (['::1', '127.0.0.1'].includes(ip) ? 'bu bilgisayar' : ip);
const userLink = (u) => h('a', { href: `#/u/${encodeURIComponent(u.username)}` }, nameWithBadge(u));

/** Bildirim türüne göre simge ve metin. Yeni tür eklerken buraya bir satır eklemek yeterli. */
const postLink = (n, label) => h('a', { href: `#/p/${n.data.postId}`, class: 'post-link' }, label);
const postRef = (n) => (n.data.preview ? ['"', postLink(n, n.data.preview), '"'] : [postLink(n, 'fotoğraflı paylaşımına')]);

const TEMPLATES = {
  post_reaction: (n) => ['', [userLink(n.actor), ` paylaşımına ${n.data.emoji} tepkisi verdi: `, ...postRef(n)]],
  post_comment: (n) => [
    '',
    [userLink(n.actor), ' paylaşımına yorum yaptı: ', ...postRef(n), h('div', { class: 'notif-quote' }, n.data.text)],
  ],
  new_follower: (n) => ['', [userLink(n.actor), ' seni takip etmeye başladı.']],
  follow_request: (n) => ['', [userLink(n.actor), ' seni takip etmek istiyor.']],
  follow_accepted: (n) => ['', [userLink(n.actor), ' takip isteğini kabul etti.']],
  new_device: (n) => ['', [`Hesabına yeni bir cihazdan giriş yapıldı: `, h('b', {}, n.data.device), ` (IP ${ipLabel(n.data.ip)}). Bu sen değilsen şifreni değiştir.`]],
  suspicious_login: (n) => [
    '',
    [h('b', {}, 'Şüpheli giriş: '), `${n.data.failures} hatalı denemeden sonra `, h('b', {}, n.data.device), ` cihazından giriş yapıldı (IP ${ipLabel(n.data.ip)}). Sen değilsen hemen şifreni değiştir ve tüm cihazlardan çıkış yap.`],
  ],
};

function requestRow(r, ctx, render) {
  const act = async (action) => {
    try {
      await api(`/account/follow-requests/${r.id}/${action}`, { method: 'POST', body: {} });
      toast(action === 'accept' ? 'Takip isteği kabul edildi.' : 'Takip isteği silindi.');
      ctx.refreshMyStats();
      render();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  return h(
    'div',
    { class: 'notification' },
    avatar(r, 'sm'),
    h('div', { class: 'text' }, userLink(r), h('div', { class: 'muted small' }, `@${r.username} · ${timeAgo(r.createdAt)}`)),
    h('div', { class: 'row-actions' }, h('button', { class: 'btn sm', onclick: () => act('accept') }, 'Onayla'), h('button', { class: 'btn sm ghost', onclick: () => act('reject') }, 'Sil'))
  );
}

export async function showNotifications(ctx) {
  const { main } = ctx;
  const render = async () => {
    const [{ requests }, { notifications }] = await Promise.all([api('/account/follow-requests'), api('/notifications')]);
    const sections = [h('div', { class: 'feed-header' }, h('h2', {}, 'Bildirimler'))];

    if (requests.length) {
      sections.push(h('section', { class: 'card panel' }, h('h3', {}, `Takip istekleri (${requests.length})`), ...requests.map((r) => requestRow(r, ctx, render))));
    }

    const list = notifications
      .filter((n) => TEMPLATES[n.type])
      .map((n) => {
        const [, text] = TEMPLATES[n.type](n);
        const href = n.data.postId ? `#/p/${n.data.postId}` : null;
        return h(
          'div',
          {
            class: `notification ${n.read ? '' : 'unread'} ${href ? 'clickable' : ''}`,
            onclick: href ? (e) => !e.target.closest('a') && (location.hash = href) : null,
          },
          n.actor ? avatar(n.actor, 'sm') : h('div', { class: 'notif-icon' }, '!'),
          h('div', { class: 'text' }, h('div', {}, ...text), h('div', { class: 'muted small' }, timeAgo(n.createdAt)))
        );
      });
    sections.push(
      h('section', { class: 'card panel' }, list.length ? list : h('div', { class: 'empty-state' }, 'Henüz bildirimin yok. '))
    );
    main.replaceChildren(...sections);

    if (notifications.some((n) => !n.read)) {
      await api('/notifications/read-all', { method: 'POST', body: {} });
      ctx.state.unread = 0;
      ctx.renderUnread();
    }
  };
  await render();
}
