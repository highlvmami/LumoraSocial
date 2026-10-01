import { api, avatar, h, handleForm, nameWithBadge, timeAgo } from './common.js';

/* Mesajlar: #/mesajlar (sohbet listesi) ve #/mesajlar/:kullaniciAdi (sohbet ekranı) */

const clock = (s) => new Date(s.replace(' ', 'T') + 'Z').toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
const dayLabel = (s) => {
  const d = new Date(s.replace(' ', 'T') + 'Z');
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400000);
  if (d.toDateString() === today.toDateString()) return 'Bugün';
  if (d.toDateString() === yesterday.toDateString()) return 'Dün';
  return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
};

/** Sayfa değişince yenilemeyi durdurmak için: rota hâlâ aynı mı? */
const stillOn = (hash) => location.hash === hash;

export async function showMessages(ctx, username) {
  if (username) return showChat(ctx, username);

  const { main } = ctx;
  const hash = location.hash;
  const list = h('section', { class: 'card panel conversations' });
  main.replaceChildren(h('div', { class: 'feed-header' }, h('h2', {}, 'Mesajlar')), list);

  const render = async () => {
    const { conversations } = await api('/messages/conversations');
    list.replaceChildren(
      ...(conversations.length
        ? conversations.map((c) =>
            h(
              'a',
              { class: `conversation ${c.unread ? 'unread' : ''}`, href: `#/mesajlar/${encodeURIComponent(c.user.username)}` },
              avatar(c.user),
              h(
                'div',
                { class: 'grow' },
                h('div', { class: 'conv-top' }, h('b', {}, ...nameWithBadge(c.user)), h('span', { class: 'muted small' }, timeAgo(c.lastMessage.createdAt))),
                h(
                  'div',
                  { class: 'conv-preview' },
                  c.lastMessage.mine ? 'Sen: ' : '',
                  c.lastMessage.deleted ? h('i', {}, 'Bu mesaj silindi') : c.lastMessage.content
                )
              ),
              c.unread ? h('span', { class: 'count-badge' }, c.unread) : null
            )
          )
        : [
            h(
              'div',
              { class: 'empty-state' },
              h('div', { class: 'big-icon' }, ''),
              'Henüz mesajın yok. Birinin profiline gidip "Mesaj" butonuna bas.'
            ),
          ])
    );
  };
  await render();
  const timer = setInterval(() => (stillOn(hash) ? render().catch(() => {}) : clearInterval(timer)), 10000);
}

async function showChat(ctx, username) {
  const { main, state } = ctx;
  const hash = location.hash;
  const thread = h('div', { class: 'chat-thread' });
  const moreBtn = h('button', { class: 'btn ghost sm hidden load-more', type: 'button' }, 'Daha eski mesajlar');
  const input = h('textarea', { name: 'content', rows: 1, maxlength: 2000, placeholder: 'Mesaj yaz…', required: true, autocomplete: 'off' });
  const form = h('form', { class: 'chat-form' }, input, h('button', { class: 'btn', type: 'submit' }, 'Gönder'));
  const header = h('div', { class: 'chat-header' });
  main.replaceChildren(h('div', { class: 'feed-header' }, h('a', { href: '#/mesajlar' }, '← Mesajlar')), h('section', { class: 'card chat' }, header, moreBtn, thread, form));

  let firstId = null;
  let lastId = null;
  let lastDay = null;

  const bubble = (m) => {
    const mine = m.senderId === state.me.id;
    const el = h(
      'div',
      { class: `msg ${mine ? 'mine' : ''} ${m.deleted ? 'deleted' : ''}`, dataset: { id: m.id } },
      h('div', { class: 'msg-text' }, m.deleted ? 'Bu mesaj silindi' : m.content),
      h('div', { class: 'msg-meta' }, clock(m.createdAt), mine && !m.deleted ? (m.read ? ' · Görüldü' : ' · Gönderildi') : '')
    );
    if (mine && !m.deleted) {
      el.append(
        h('button', {
          class: 'msg-delete',
          type: 'button',
          title: 'Mesajı sil',
          'aria-label': 'Mesajı sil',
          onclick: async () => {
            if (!confirm('Bu mesaj silinsin mi?')) return;
            await api(`/messages/${m.id}`, { method: 'DELETE' });
            el.replaceWith(bubble({ ...m, deleted: true }));
          },
        }, '✕')
      );
    }
    return el;
  };

  /** Mesajları gün ayırıcılarıyla birlikte düğümlere çevirir. */
  const withDays = (messages, dayRef) =>
    messages.flatMap((m) => {
      const day = dayLabel(m.createdAt);
      const nodes = day !== dayRef.value ? [h('div', { class: 'chat-day' }, day)] : [];
      dayRef.value = day;
      return [...nodes, bubble(m)];
    });

  const atBottom = () => thread.scrollHeight - thread.scrollTop - thread.clientHeight < 60;
  const scrollDown = () => (thread.scrollTop = thread.scrollHeight);

  let data;
  try {
    data = await api(`/messages/with/${encodeURIComponent(username)}`);
  } catch (err) {
    thread.append(h('div', { class: 'empty-state' }, err.message));
    form.remove();
    return;
  }
  const u = data.user;
  header.append(
    h('a', { class: 'chat-user', href: `#/u/${encodeURIComponent(u.username)}` }, avatar(u, 'sm'), h('div', {}, h('b', {}, ...nameWithBadge(u)), h('div', { class: 'muted small' }, `@${u.username}`)))
  );

  const dayRef = { value: null };
  if (!data.messages.length) thread.append(h('div', { class: 'empty-state chat-empty' }, `${u.displayName} ile ilk mesajını yaz `));
  thread.append(...withDays(data.messages, dayRef));
  lastDay = dayRef.value;
  firstId = data.messages[0]?.id ?? null;
  lastId = data.messages.at(-1)?.id ?? null;
  moreBtn.classList.toggle('hidden', !data.hasMore);
  scrollDown();
  ctx.refreshUnread();

  if (!data.canMessage) {
    form.replaceWith(h('div', { class: 'chat-locked muted small' }, 'Bu gizli hesaba yalnızca takipçileri mesaj gönderebilir.'));
  }

  moreBtn.addEventListener('click', async () => {
    const older = await api(`/messages/with/${encodeURIComponent(username)}?before=${firstId}`);
    const prevHeight = thread.scrollHeight;
    thread.querySelector('.chat-day')?.remove(); // eski mesajların gün başlığı yeniden eklenecek
    const ref = { value: null };
    thread.prepend(...withDays(older.messages, ref));
    firstId = older.messages[0]?.id ?? firstId;
    moreBtn.classList.toggle('hidden', !older.hasMore);
    thread.scrollTop = thread.scrollHeight - prevHeight;
  });

  const appendNew = (messages) => {
    if (!messages.length) return;
    thread.querySelector('.chat-empty')?.remove();
    const stick = atBottom();
    const ref = { value: lastDay };
    thread.append(...withDays(messages, ref));
    lastDay = ref.value;
    lastId = messages.at(-1).id;
    if (stick) scrollDown();
  };

  // Enter gönderir, Shift+Enter yeni satır
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  handleForm(form, null, async ({ content }) => {
    if (!content.trim()) return;
    const { message } = await api(`/messages/with/${encodeURIComponent(username)}`, { method: 'POST', body: { content } });
    input.value = '';
    appendNew([message]);
    scrollDown();
    input.focus();
  });

  // Yeni mesajları ve "görüldü" durumunu birkaç saniyede bir yenile
  const poll = async () => {
    // Ekrandaki ilk mesajdan itibaren hepsini al: yeniler eklenir, "görüldü" ve silinme durumu güncellenir
    const res = await api(`/messages/with/${encodeURIComponent(username)}${firstId ? `?after=${firstId - 1}` : ''}`);
    appendNew(res.messages.filter((m) => m.id > (lastId ?? 0)));
    if (!firstId && res.messages.length) firstId = res.messages[0].id;
    for (const m of res.messages) {
      const el = thread.querySelector(`[data-id="${m.id}"]`);
      if (!el) continue;
      if (m.deleted && !el.classList.contains('deleted')) el.replaceWith(bubble(m));
      else if (m.senderId === state.me.id && m.read && !m.deleted) {
        const meta = el.querySelector('.msg-meta');
        if (meta && !meta.textContent.includes('Görüldü')) meta.textContent = `${clock(m.createdAt)} · Görüldü`;
      }
    }
  };
  const timer = setInterval(() => (stillOn(hash) ? poll().catch(() => {}) : clearInterval(timer)), 4000);
  input.focus();
}
