import { api, avatar, dropdown, formatDate, h, handleForm, logout, nameWithBadge, usernameWithBadge, attachMentionAutocomplete, openReportDialog, openLightbox, resizeImage, SOCIALS, socialHref, timeAgo, toast, confirmDialog } from './common.js';
import { highlightsRow, openComposer as openStoryComposer, storyBar } from './stories.js';
import { pushPrompt, registerServiceWorker, syncPush } from './push.js';
import { showSettings } from './settings.js';
import { showNotifications } from './notifications.js';
import { showMessages } from './messages.js';
import { searchHref, showSearch } from './search.js';

const state = { me: null, colors: [], socialKeys: [], stats: { followers: 0, following: 0 }, unread: 0, unreadMessages: 0 };
const main = document.getElementById('main');

/* ---------------- Sol profil alanı ---------------- */

function renderProfileCard() {
  const me = state.me;
  document.getElementById('profile-card').replaceChildren(
    ...[
      me.coverUrl ? h('div', { class: 'mini-cover', style: { backgroundImage: `url("${me.coverUrl}")` } }) : null,
      avatar(me, 'lg'),
      h('div', { class: 'name' }, ...usernameWithBadge(me)),
      h('div', { class: 'muted small' }, me.displayName),
      me.role !== 'member' ? h('div', {}, h('span', { class: 'badge-admin' }, me.role === 'admin' ? 'Yönetici' : 'Denetimci')) : null,
      me.bio ? h('p', { class: 'bio' }, me.bio) : h('p', { class: 'bio muted' }, 'Henüz biyografi yok.'),
      h(
        'div',
        { class: 'stats' },
        h('span', {}, h('b', {}, state.stats.followers), ' takipçi'),
        h('span', {}, h('b', {}, state.stats.following), ' takip')
      ),
      h('div', { class: 'muted small joined' }, `Katılım: ${formatDate(me.createdAt)}`),
    ].filter(Boolean)
  );
  document.getElementById('nav-me').href = `#/u/${encodeURIComponent(me.username)}`;
  const navAdmin = document.getElementById('nav-admin');
  navAdmin.classList.toggle('hidden', me.role === 'member');
  navAdmin.textContent = me.role === 'moderator' ? 'Denetim paneli' : 'Yönetim paneli';
}

function renderUnread() {
  for (const [id, n] of [['unread-count', state.unread], ['unread-messages', state.unreadMessages], ['unread-bell', state.unread], ['unread-messages-bottom', state.unreadMessages]]) {
    const el = document.getElementById(id);
    el.textContent = n > 99 ? '99+' : n;
    el.classList.toggle('hidden', !n);
  }
  // Mobilde menü kapalıyken okunmamışlar menü düğmesindeki noktayla gösterilir
  // Uygulama simgesindeki sayı (destekleyen telefonlarda)
  try {
    const n = state.unread + state.unreadMessages;
    if (navigator.setAppBadge) (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {});
  } catch {
    /* desteklenmiyor */
  }
  for (const id of ['menu-dot', 'menu-dot-bottom']) document.getElementById(id).classList.toggle('hidden', !(state.unread || state.unreadMessages));
}

async function refreshMyStats() {
  state.stats = await api('/users/me/stats');
  renderProfileCard();
}

async function refreshUnread() {
  try {
    const counts = await api('/notifications/unread-count');
    state.unread = counts.count;
    state.unreadMessages = counts.messages;
    renderUnread();
  } catch {
    /* oturum kapanmış olabilir */
  }
}

function setMe(user) {
  state.me = user;
  renderProfileCard();
}

/* ---------------- Takip ---------------- */

/**
 * Takip butonu. Durumlar: none → "Takip et" (gizli hesapta "Takip isteği gönder"),
 * pending → "İstek gönderildi", accepted → "Takip ediliyor". onChange yeni istatistiklerle çağrılır.
 */
function followButton(user, status, onChange) {
  const btn = h('button', { type: 'button', class: 'btn sm' });
  const paint = () => {
    btn.textContent =
      status === 'accepted' ? 'Takip ediliyor' : status === 'pending' ? 'İstek gönderildi' : user.privateAccount ? 'Takip isteği gönder' : 'Takip et';
    btn.classList.toggle('ghost', status !== 'none');
    btn.title = status === 'accepted' ? 'Takibi bırak' : status === 'pending' ? 'İsteği geri çek' : '';
  };
  btn.addEventListener('click', async () => {
    if (status === 'accepted' && user.privateAccount && !await confirmDialog('Gizli hesap: takibi bırakırsan yeniden istek göndermen gerekir. Devam edilsin mi?')) return;
    btn.disabled = true;
    try {
      const stats = await api(`/users/${encodeURIComponent(user.username)}/follow`, { method: status === 'none' ? 'POST' : 'DELETE' });
      status = stats.followStatus;
      paint();
      onChange?.(stats);
      refreshMyStats();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });
  paint();
  return btn;
}

async function renderSuggestions() {
  const card = document.getElementById('suggestions');
  const { users } = await api('/users/suggestions');
  card.classList.toggle('hidden', !users.length);
  card.replaceChildren(
    h('h3', {}, 'Önerilen kişiler'),
    ...users.map((u) =>
      h(
        'div',
        { class: 'suggestion' },
        avatar(u, 'sm'),
        h('div', { class: 'who' }, profileLink(u, nameWithBadge(u)), h('div', { class: 'muted small' }, `@${u.username}`)),
        followButton(u, 'none')
      )
    )
  );
}

/* ---------------- Paylaşım kartı ---------------- */

const canModify = (ownerId) => ownerId === state.me.id || state.me.role !== 'member';
const profileLink = (user, children) => h('a', { href: `#/u/${encodeURIComponent(user.username)}` }, children);

function renderReactions(post, container) {
  const toggle = async (emoji) => {
    try {
      const res = await api(`/posts/${post.id}/reactions`, { method: 'POST', body: { emoji } });
      post.reactions = res.reactions;
      renderReactions(post, container);
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  // Yalnızca tepki almış emojiler görünür; yenisi "Tepki ver" ile açılan küçük panelden seçilir
  const chips = post.reactions
    .filter((r) => r.count)
    .map((r) =>
      h(
        'button',
        { type: 'button', class: `reaction ${r.mine ? 'mine' : ''}`, title: r.mine ? 'Tepkini geri al' : 'Sen de ekle', onclick: () => toggle(r.emoji) },
        h('span', {}, r.emoji),
        h('span', { class: 'count' }, r.count)
      )
    );

  const picker = h(
    'div',
    { class: 'reaction-picker hidden', role: 'menu' },
    ...post.reactions.map((r) =>
      h('button', { type: 'button', class: `pick ${r.mine ? 'mine' : ''}`, title: r.mine ? 'Tepkini geri al' : 'Tepki ver', onclick: () => (close(), toggle(r.emoji)) }, r.emoji)
    )
  );
  const wrap = h('div', { class: 'reaction-add' });
  const close = () => {
    picker.classList.add('hidden');
    document.removeEventListener('click', outside, true);
  };
  const outside = (e) => !wrap.contains(e.target) && close();
  const btn = h('button', { type: 'button', class: 'reaction-btn' }, 'Tepki ver');
  btn.addEventListener('click', () => {
    if (picker.classList.toggle('hidden')) close();
    else document.addEventListener('click', outside, true);
  });
  wrap.append(btn, picker);

  container.replaceChildren(wrap, ...chips);
}

function renderComments(post, container) {
  container.replaceChildren(
    ...post.comments.map((c) =>
      h(
        'div',
        { class: 'comment' },
        avatar(c.author, 'sm'),
        h(
          'div',
          { class: 'bubble' },
          profileLink(c.author, nameWithBadge(c.author)),
          h('span', { class: 'muted small' }, ` · ${timeAgo(c.createdAt)}`),
          h('p', {}, linkifyTags(c.content))
        ),
        // Şikâyet / silme küçük ⋯ menüsünde
        dropdown(
          [
            c.author.id !== state.me.id && { label: 'Şikâyet et', onClick: () => openReportDialog('comment', c.id, 'Bu yorum') },
            (canModify(c.author.id) || post.author.id === state.me.id) && {
              label: c.author.id === state.me.id || post.author.id === state.me.id ? 'Yorumu sil' : 'Yorumu sil (yönetici)',
              danger: true,
              onClick: async () => {
                if (!await confirmDialog('Yorum silinsin mi?')) return;
                const res = await api(`/posts/${post.id}/comments/${c.id}`, { method: 'DELETE' });
                post.comments = res.comments;
                renderComments(post, container);
              },
            },
          ],
          { title: 'Yorum seçenekleri' }
        )
      )
    ),
    commentForm(post, container)
  );
}

function commentForm(post, container) {
  const input = h('input', { name: 'content', maxlength: 500, placeholder: 'Yorum yaz…', required: true, autocomplete: 'off' });
  const form = h('form', { class: 'comment-form' }, avatar(state.me, 'sm'), h('div', { class: 'mention-wrap comment-input' }, input, attachMentionAutocomplete(input)), h('button', { class: 'btn sm', type: 'submit' }, 'Gönder'));
  handleForm(form, null, async ({ content }) => {
    const res = await api(`/posts/${post.id}/comments`, { method: 'POST', body: { content } });
    post.comments = res.comments;
    renderComments(post, container);
    container.querySelector('.comment-form input')?.focus();
  });
  return form;
}

function renderPost(post) {
  const reactions = h('div', { class: 'reactions' });
  const comments = h('div', { class: 'comments' });
  renderReactions(post, reactions);
  renderComments(post, comments);

  const el = h(
    'article',
    { class: 'card post' },
    h(
      'div',
      { class: 'post-head' },
      avatar(post.author),
      h(
        'div',
        { class: 'who' },
        profileLink(post.author, usernameWithBadge(post.author)),
        h('div', { class: 'muted small' }, post.author.displayName)
      ),
      roleBadge(post.author),
      postMenu(post, () => el)
    ),
    post.content ? h('div', { class: 'post-body' }, linkifyTags(post.content)) : null,
    postImages(post),
    post.poll ? pollView(post) : null,
    post.quote ? quoteCard(post.quote) : null,
    // Paylaşım zamanı gönderinin sol altında
    h('time', { class: 'post-time muted small', title: formatDate(post.createdAt) }, timeAgo(post.createdAt)),
    h('div', { class: 'post-actions' }, reactions),
    comments
  );
  return el;
}

/** Yönetici / denetimci rozeti (gönderi başlığında, sağda) */
function roleBadge(user) {
  if (user.role === 'admin') return h('span', { class: 'role-badge admin', title: 'Yönetici' }, h('span', {}, 'Yönetici'), h('i', { class: 'crown', 'aria-hidden': 'true' }));
  if (user.role === 'moderator') return h('span', { class: 'role-badge mod', title: 'Denetimci' }, h('span', {}, 'Denetimci'), h('i', { class: 'mag', 'aria-hidden': 'true' }));
  return null;
}

/** Yeniden paylaşılan gönderinin küçük kartı */
function quoteCard(q) {
  if (q.hidden) return h('div', { class: 'quote-card muted small' }, 'Bu paylaşım artık görüntülenemiyor.');
  return h(
    'a',
    { class: 'quote-card', href: `#/p/${q.id}` },
    h('div', { class: 'quote-head' }, avatar(q.author, 'sm'), h('b', {}, ...usernameWithBadge(q.author)), h('span', { class: 'muted small' }, timeAgo(q.createdAt))),
    q.content ? h('div', { class: 'quote-body' }, q.content) : null,
    q.images?.length ? h('img', { class: 'quote-image', src: q.images[0].url, alt: '', loading: 'lazy' }) : null
  );
}

/** Yeniden paylaşma penceresi: isteğe bağlı yorum + alıntılanan gönderi önizlemesi */
function openRepostDialog(post) {
  // Alıntının alıntısı yerine asıl gönderi paylaşılır
  const target = post.quote && !post.quote.hidden && !post.content && !post.images?.length && !post.poll ? post.quote : post;
  const textarea = h('textarea', { name: 'content', maxlength: 1000, rows: 3, placeholder: 'Bir şey ekle (isteğe bağlı)…' });
  const alertEl = h('div', { class: 'alert hidden' });
  const form = h(
    'form',
    { class: 'card modal' },
    h('h2', {}, 'Yeniden paylaş'),
    h('div', { class: 'mention-wrap' }, textarea, attachMentionAutocomplete(textarea)),
    quoteCard({ id: target.id, content: target.content, createdAt: target.createdAt, author: target.author, images: target.images }),
    alertEl,
    h('div', { class: 'modal-actions' }, h('button', { type: 'button', class: 'btn ghost', 'data-close': true }, 'Vazgeç'), h('button', { type: 'submit', class: 'btn' }, 'Paylaş'))
  );
  const backdrop = h('div', { class: 'modal-backdrop' }, form);
  const close = () => backdrop.remove();
  backdrop.addEventListener('click', (e) => (e.target === backdrop || e.target.dataset.close !== undefined) && close());
  handleForm(form, alertEl, async ({ content }) => {
    const { post: created } = await api('/posts', { method: 'POST', body: { content, quoteOf: target.id } });
    close();
    toast('Yeniden paylaşıldı.');
    const list = main.querySelector('.feed');
    if (list && ['', '#/', '#/takip'].includes(location.hash)) list.prepend(renderPost(created));
  });
  document.body.append(backdrop);
  textarea.focus();
}

/** Anket: oy verilmeden seçenekler düğme, sonra yüzdelik çubuklar */
function pollView(post) {
  const box = h('div', { class: 'poll' });
  const paint = () => {
    const p = post.poll;
    const showResults = p.options[0]?.votes !== null;
    const left = p.ended ? 'Sona erdi' : remaining(p.endsAt);
    box.replaceChildren(
      ...p.options.map((o) => {
        const pct = showResults && p.total ? Math.round((o.votes / p.total) * 100) : 0;
        return h(
          'button',
          {
            type: 'button',
            class: `poll-option ${showResults ? 'result' : ''} ${p.myVote === o.id ? 'mine' : ''}`,
            disabled: p.ended,
            title: p.myVote === o.id ? 'Oyunu geri al' : 'Oy ver',
            onclick: async () => {
              try {
                post.poll = (await api(`/posts/${post.id}/vote`, { method: 'POST', body: { optionId: o.id } })).poll;
                paint();
              } catch (err) {
                toast(err.message, 'error');
              }
            },
          },
          showResults ? h('span', { class: 'poll-bar', style: { width: `${pct}%` } }) : null,
          h('span', { class: 'poll-text' }, o.text),
          showResults ? h('span', { class: 'poll-pct' }, `%${pct}`) : null
        );
      }),
      h('div', { class: 'muted small poll-meta' }, `${p.total} oy · ${left}`)
    );
  };
  paint();
  return box;
}

function remaining(endsAt) {
  const ms = endsAt - Date.now();
  const h_ = Math.floor(ms / 3600000);
  if (h_ >= 24) return `${Math.floor(h_ / 24)} gün kaldı`;
  if (h_ >= 1) return `${h_} saat kaldı`;
  return `${Math.max(1, Math.ceil(ms / 60000))} dakika kaldı`;
}

/** Engelle (onaylı). Engellenince sayfa yenilenir; o kişinin içerikleri kaybolur. */
async function blockUser(user) {
  if (!await confirmDialog(`@${user.username} engellensin mi?

Birbirinizin paylaşımlarını ve yorumlarını görmezsiniz, takip ve mesajlaşma kapanır. Engeli istediğin zaman Ayarlar > Gizlilik'ten kaldırabilirsin.`)) return;
  try {
    await api(`/users/${encodeURIComponent(user.username)}/block`, { method: 'POST', body: {} });
    toast(`@${user.username} engellendi.`);
    refreshMyStats();
    renderSuggestions();
    route();
  } catch (err) {
    toast(err.message, 'error');
  }
}

/** Paylaşımın ⋯ menüsü: kaydet, şikâyet et, engelle, sil */
function postMenu(post, getEl) {
  const mine = post.author.id === state.me.id;
  return dropdown([
    { label: post.repostCount ? `🔁 ${post.repostCount}` : '🔁', title: 'Yeniden paylaş', onClick: () => openRepostDialog(post) },
    {
      label: post.bookmarked ? 'Kaydedilenlerden çıkar' : 'Kaydet',
      onClick: async (item) => {
        try {
          post.bookmarked = (await api(`/posts/${post.id}/bookmark`, { method: 'POST', body: {} })).bookmarked;
          item.textContent = post.bookmarked ? 'Kaydedilenlerden çıkar' : 'Kaydet';
          toast(post.bookmarked ? 'Kaydedilenlere eklendi.' : 'Kaydedilenlerden çıkarıldı.');
        } catch (err) {
          toast(err.message, 'error');
        }
      },
    },
    !mine && { label: 'Şikâyet et', onClick: () => openReportDialog('post', post.id, 'Bu paylaşım') },
    !mine && { label: `@${post.author.username} kullanıcısını engelle`, onClick: () => blockUser(post.author), danger: true },
    canModify(post.author.id) && {
      label: mine ? 'Paylaşımı sil' : 'Paylaşımı sil (yönetici)',
      danger: true,
      onClick: async () => {
        if (!await confirmDialog('Bu paylaşım silinsin mi?')) return;
        await api(`/posts/${post.id}`, { method: 'DELETE' });
        getEl().remove();
        toast('Paylaşım silindi.');
      },
    },
  ]);
}

/** Metindeki #etiketleri aramaya, @kullanıcı adlarını profile bağlar (metin olarak kalır, HTML yorumlanmaz). */
function linkifyTags(text) {
  return text.split(/(#[\p{L}\p{N}_]{2,40}|(?<![\w.@])@[a-zA-Z0-9_.]{3,24})/u).flatMap((part, i) => {
    if (!(i % 2)) return part;
    if (part.startsWith('#')) return h('a', { class: 'hashtag', href: searchHref(part, 'paylasimlar') }, part);
    const name = part.slice(1).replace(/\.+$/, '');
    return [h('a', { class: 'mention', href: `#/u/${encodeURIComponent(name)}` }, '@' + name), part.slice(1 + name.length)];
  });
}

/* ---------------- Akış / profil görünümleri ---------------- */

function renderPostList(container, loader, emptyText = 'Henüz paylaşım yok. İlk paylaşımı sen yap! ') {
  let before = null;
  const list = h('div', { class: 'feed' });
  const more = h('button', { class: 'btn ghost load-more hidden', type: 'button' }, 'Daha fazla yükle');
  container.append(list, more);

  async function load() {
    more.disabled = true;
    try {
      const { posts, hasMore } = await loader(before);
      if (!before && !posts.length && emptyText) list.append(h('div', { class: 'card empty-state' }, emptyText));
      posts.forEach((p) => list.append(renderPost(p)));
      before = posts.at(-1)?.id ?? before;
      more.classList.toggle('hidden', !hasMore);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      more.disabled = false;
    }
  }
  more.addEventListener('click', load);
  load();
  return list;
}

const MAX_IMAGES = 4;

/** Paylaşım kutusu: metin + en fazla 4 fotoğraf. Fotoğraflar seçilince yüklenir, "Paylaş"ta bağlanır. */
function composer(onPosted) {
  const textarea = h('textarea', { name: 'content', maxlength: 1000, placeholder: `Ne düşünüyorsun, ${state.me.displayName}?` });
  const counter = h('span', { class: 'muted small' }, '0 / 1000');
  textarea.addEventListener('input', () => (counter.textContent = `${textarea.value.length} / 1000`));

  let images = []; // { id, url } veya yükleniyorsa { uploading: true, preview }
  let pollOn = false;
  const previews = h('div', { class: 'composer-images' });
  const fileInput = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', multiple: true, class: 'visually-hidden' });
  const photoBtn = h('label', { class: 'btn sm ghost', title: 'Fotoğraf ekle' }, 'Fotoğraf', fileInput);
  const submit = h('button', { class: 'btn', type: 'submit' }, 'Paylaş');

  const paint = () => {
    previews.replaceChildren(
      ...images.map((img) =>
        h(
          'div',
          { class: `composer-thumb ${img.uploading ? 'uploading' : ''}` },
          h('img', { src: img.url || img.preview, alt: '' }),
          img.uploading
            ? h('span', { class: 'spinner' })
            : h('button', {
                type: 'button',
                class: 'thumb-remove',
                'aria-label': 'Fotoğrafı kaldır',
                onclick: () => {
                  images = images.filter((x) => x !== img);
                  api(`/posts/images/${img.id}`, { method: 'DELETE' }).catch(() => {});
                  paint();
                },
              }, '✕')
        )
      )
    );
    photoBtn.classList.toggle('hidden', pollOn || images.length >= MAX_IMAGES);
    submit.disabled = images.some((i) => i.uploading);
  };

  fileInput.addEventListener('change', async () => {
    const files = [...fileInput.files].slice(0, MAX_IMAGES - images.length);
    if (fileInput.files.length > files.length) toast(`En fazla ${MAX_IMAGES} fotoğraf ekleyebilirsin.`, 'error');
    fileInput.value = '';
    await Promise.all(
      files.map(async (file) => {
        const slot = { uploading: true, preview: URL.createObjectURL(file) };
        images.push(slot);
        paint();
        try {
          const { blob, width, height } = await resizeImage(file);
          const { image } = await api(`/posts/images?w=${width}&h=${height}`, { method: 'POST', blob });
          Object.assign(slot, image, { uploading: false });
        } catch (err) {
          images = images.filter((x) => x !== slot);
          toast(err.message, 'error');
        } finally {
          URL.revokeObjectURL(slot.preview);
          paint();
        }
      })
    );
  });

  // Anket: 2-4 seçenek ve süre. Açıkken fotoğraf eklenemez.
  const pollBox = h('div', { class: 'poll-editor hidden' });
  const optionInput = (i) => h('input', { type: 'text', maxlength: 80, placeholder: `${i + 1}. seçenek`, class: 'poll-option-input' });
  const durations = [['1', '1 saat'], ['6', '6 saat'], ['24', '1 gün'], ['72', '3 gün'], ['168', '1 hafta']];
  const durationSel = h('select', { class: 'poll-duration', 'aria-label': 'Anket süresi' }, ...durations.map(([v, l]) => h('option', { value: v, selected: v === '24' }, l)));
  const addOptionBtn = h('button', { type: 'button', class: 'btn sm ghost' }, '+ Seçenek');
  const resetPoll = () => {
    pollBox.replaceChildren(h('div', { class: 'poll-options' }, optionInput(0), optionInput(1)), h('div', { class: 'poll-editor-row' }, addOptionBtn, h('span', { class: 'muted small' }, 'Süre'), durationSel));
    addOptionBtn.classList.remove('hidden');
  };
  addOptionBtn.addEventListener('click', () => {
    const list = pollBox.querySelector('.poll-options');
    list.append(optionInput(list.children.length));
    if (list.children.length >= 4) addOptionBtn.classList.add('hidden');
  });
  const pollBtn = h('button', { type: 'button', class: 'btn sm ghost', title: 'Anket ekle' }, 'Anket');
  pollBtn.addEventListener('click', () => {
    pollOn = !pollOn;
    if (pollOn) resetPoll();
    pollBox.classList.toggle('hidden', !pollOn);
    pollBtn.classList.toggle('active', pollOn);
    photoBtn.classList.toggle('hidden', pollOn || images.length >= MAX_IMAGES);
    if (pollOn) pollBox.querySelector('input').focus();
  });

  const form = h(
    'form',
    { class: 'card composer' },
    h('div', { class: 'mention-wrap' }, textarea, attachMentionAutocomplete(textarea)),
    previews,
    pollBox,
    h('div', { class: 'row' }, h('div', { class: 'row-left' }, photoBtn, pollBtn, counter), submit)
  );
  handleForm(form, null, async ({ content }) => {
    const poll = pollOn
      ? { options: [...pollBox.querySelectorAll('.poll-option-input')].map((i) => i.value.trim()).filter(Boolean), hours: Number(durationSel.value) }
      : null;
    if (poll && !content.trim()) throw new Error('Anket için bir soru yaz.');
    if (poll && poll.options.length < 2) throw new Error('En az 2 seçenek yaz.');
    if (!content.trim() && !images.length) throw new Error('Bir şeyler yaz veya fotoğraf ekle.');
    const { post } = await api('/posts', { method: 'POST', body: { content, imageIds: images.map((i) => i.id), poll } });
    form.reset();
    images = [];
    if (pollOn) pollBtn.click();
    paint();
    counter.textContent = '0 / 1000';
    onPosted(post);
  });
  return form;
}

/** Paylaşımdaki fotoğraflar: 1 tane ise büyük, 2-4 tane ise ızgara. Tıklayınca büyür. */
function postImages(post) {
  if (!post.images?.length) return null;
  const n = post.images.length;
  return h(
    'div',
    { class: `post-images count-${n}` },
    post.images.map((img, i) =>
      h(
        'button',
        { type: 'button', class: 'post-image', onclick: () => openLightbox(post.images, i), 'aria-label': 'Fotoğrafı büyüt' },
        h('img', {
          src: img.url,
          alt: '',
          loading: 'lazy',
          // Tek fotoğrafta oranı koru (sayfa zıplamasın)
          style: n === 1 && img.width && img.height ? { aspectRatio: `${img.width} / ${img.height}` } : {},
        })
      )
    )
  );
}

/** E-posta/telefon doğrulanmamışsa akışın üstünde hatırlatma. */
function verifyBanner() {
  const me = state.me;
  const items = [];
  if (me.email && !me.emailVerified) items.push(`E-posta adresin (${me.email}) henüz doğrulanmadı.`);
  if (me.phone && !me.phoneVerified) items.push(`Telefon numaran (${me.phone}) henüz doğrulanmadı.`);
  if (!items.length) return null;
  return h(
    'div',
    { class: 'card banner' },
    h('span', {}, '', items.join(' ')),
    h('a', { class: 'btn sm', href: '#/ayarlar/hesap' }, 'Şimdi doğrula')
  );
}

/** scope: 'all' (genel akış) veya 'following' (takip ettiklerim) */
/** Ana sayfa: hikayeler, önerilen kişiler (mobilde yatay) ve takip ettiklerinin paylaşımları */
function showFeed() {
  main.replaceChildren(
    ...[
      h('div', { class: 'feed-header home-header' }, h('h2', {}, 'Akış')),
      feedTabs('following'),
      verifyBanner(),
      pushPrompt(),
      storyBar(state.me),
      suggestionStrip(),
    ].filter(Boolean)
  );
  let list;
  main.append(
    composer((post) => {
      list.querySelector('.empty-state')?.remove();
      list.prepend(renderPost(post));
    })
  );
  list = renderPostList(
    main,
    (before) => api(`/posts?${new URLSearchParams({ scope: 'following', ...(before && { before }) })}`),
    'Takip ettiğin kişilerin paylaşımları burada görünür. Önerilen kişilerden birilerini takip et ya da Keşfet\'e göz at. '
  );
}

/** Akışın üstündeki seçim: takip edilenler / keşfet (mobilde alt menüde ayrı oldukları için gizli) */
function feedTabs(active) {
  const tab = (key, label, href) => h('a', { href, class: active === key ? 'active' : '' }, label);
  return h('nav', { class: 'tabs feed-tabs main-tabs' }, tab('following', 'Takip edilenler', '#/'), tab('explore', 'Keşfet', '#/kesfet'));
}

/** Önerilen kişiler: yatay kaydırılan kartlar (mobilde ana sayfada görünür) */
function suggestionStrip() {
  const strip = h('section', { class: 'card suggest-strip hidden', 'aria-label': 'Önerilen kişiler' });
  api('/users/suggestions')
    .then(({ users }) => {
      if (!users.length) return;
      strip.replaceChildren(
        h('h3', {}, 'Önerilen kişiler'),
        h(
          'div',
          { class: 'suggest-row' },
          ...users.map((u) =>
            h('div', { class: 'suggest-card' }, profileLink(u, [avatar(u, 'lg'), h('b', {}, u.username), h('span', { class: 'muted small' }, u.displayName)]), followButton(u, 'none'))
          )
        )
      );
      strip.classList.remove('hidden');
    })
    .catch(() => {});
  return strip;
}

/** Profil başlığı: kapak, fotoğraf, isim, bilgiler, sosyal bağlantılar, ilgi alanları, takip. */
function profileHeader(u) {
  const isSelf = u.id === state.me.id;
  const stats = h('div', { class: 'stats' });
  const paintStats = (s) =>
    stats.replaceChildren(
      h('span', {}, h('b', {}, u.postCount), ' paylaşım'),
      h('span', {}, h('b', {}, s.followers), ' takipçi'),
      h('span', {}, h('b', {}, s.following), ' takip')
    );
  paintStats(u);

  const fact = (_icon, content) => (content ? h('li', {}, content) : null);
  const birth = u.birthDate
    ? new Date(`${u.birthDate}T00:00:00`).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })
    : null;
  const facts = [
    fact('', u.occupation),
    fact('', u.education),
    fact('', u.location),
    fact('', u.website ? h('a', { href: u.website, target: '_blank', rel: 'noopener noreferrer nofollow' }, u.website.replace(/^https?:\/\//, '').replace(/\/$/, '')) : null),
    fact('', birth),
    fact('', u.email),
    fact('', u.phone),
    fact('', `${formatDate(u.createdAt)} tarihinde katıldı`),
  ].filter(Boolean);

  const socials = Object.entries(u.socialLinks || {})
    .filter(([k, val]) => val && SOCIALS[k])
    .map(([k, val]) =>
      h('a', { class: 'social-chip', href: socialHref(k, val), target: '_blank', rel: 'noopener noreferrer nofollow', title: SOCIALS[k].label }, SOCIALS[k].label)
    );

  return h(
    'section',
    { class: 'card profile-hero' },
    h('div', { class: 'cover', style: u.coverUrl ? { backgroundImage: `url("${u.coverUrl}")` } : {} }),
    h(
      'div',
      { class: 'hero-body' },
      h(
        'div',
        { class: 'hero-top' },
        avatar(u, 'xl'),
        h(
          'div',
          { class: 'hero-actions' },
          isSelf
            ? h('a', { class: 'btn sm ghost', href: '#/ayarlar/profil' }, 'Profili düzenle')
            : [
                h('a', { class: 'btn sm ghost', href: `#/mesajlar/${encodeURIComponent(u.username)}` }, 'Mesaj'),
                followButton(u, u.followStatus, (s) => {
                  paintStats(s);
                  renderSuggestions();
                }),
                dropdown([
                  { label: 'Şikâyet et', onClick: () => openReportDialog('user', u.id, `@${u.username} hesabı`) },
                  { label: 'Engelle', onClick: () => blockUser(u), danger: true },
                ]),
              ]
        )
      ),
      u.adminView
        ? h('div', { class: 'admin-view-note small' }, 'Yönetici olduğun için bu hesabın gizli içeriğini görüyorsun. Normal üyeler bunları görmez.')
        : null,
      h('h2', { class: 'hero-name' }, ...nameWithBadge(u), u.privateAccount ? h('span', { class: 'lock', title: 'Gizli hesap' }, 'Gizli hesap') : null),
      h('div', { class: 'muted' }, `@${u.username}`, u.role !== 'member' ? ' · ' : '', u.role !== 'member' ? h('span', { class: 'badge-admin' }, u.role === 'admin' ? 'Yönetici' : 'Denetimci') : null),
      u.bio ? h('p', { class: 'bio' }, linkifyTags(u.bio)) : null,
      facts.length ? h('ul', { class: 'facts' }, facts) : null,
      socials.length ? h('div', { class: 'socials' }, socials) : null,
      u.interests?.length ? h('div', { class: 'chips' }, u.interests.map((i) => h('span', { class: 'chip' }, i))) : null,
      stats
    )
  );
}

function showUser(username) {
  main.replaceChildren(h('div', { class: 'feed-header back-home' }, h('a', { href: '#/' }, '← Akışa dön')));
  let header;
  const list = renderPostList(
    main,
    async (before) => {
      const data = await api(`/users/${encodeURIComponent(username)}${before ? `?before=${before}` : ''}`);
      if (!header && data.blocked) {
        // Engellediğim kişi: yalnızca adı ve engeli kaldırma düğmesi
        const u = data.user;
        header = h(
          'div',
          { class: 'card empty-state' },
          avatar(u, 'lg'),
          h('h3', {}, u.displayName),
          h('div', { class: 'muted' }, `@${u.username}`),
          h('p', {}, 'Bu kişiyi engelledin. Paylaşımlarını ve yorumlarını görmüyorsun.'),
          h('button', {
            class: 'btn ghost',
            type: 'button',
            onclick: async () => {
              await api(`/users/${encodeURIComponent(u.username)}/block`, { method: 'DELETE' });
              toast('Engel kaldırıldı.');
              route();
            },
          }, 'Engeli kaldır')
        );
        list.before(header);
        return data;
      }
      if (!header) {
        header = profileHeader(data.user);
        list.before(header);
        if (!data.locked) list.before(highlightsRow(data.user, state.me));
        if (data.locked) {
          list.before(
            h(
              'div',
              { class: 'card empty-state' },
              h('div', { class: 'big-icon' }, ''),
              h('b', {}, 'Bu hesap gizli'),
              h('p', {}, 'Paylaşımları görmek için takip isteği gönder. Hesap sahibi onaylayınca paylaşımlar görünür.')
            )
          );
        } else if (data.user.id === state.me.id) {
          list.before(composer((post) => list.prepend(renderPost(post))));
        } else if (!data.posts.length) {
          list.append(h('div', { class: 'card empty-state' }, 'Henüz paylaşım yok.'));
        }
      }
      return data;
    },
    null
  );
}

/** Kaydedilen paylaşımlar */
function showBookmarks() {
  main.replaceChildren(h('div', { class: 'feed-header' }, h('h2', {}, 'Kaydedilenler')));
  renderPostList(
    main,
    (before) => api(`/posts/bookmarks${before ? `?before=${before}` : ''}`),
    'Henüz kaydettiğin paylaşım yok. Bir paylaşımdaki simgesine basarak kaydedebilirsin.'
  );
}

/** Keşfet: gündemdeki etiketler + son 7 günün popüler paylaşımları */
function showExplore(params = new URLSearchParams()) {
  const sort = params.get('sirala') === 'populer' ? 'popular' : 'new';
  const search = h(
    'form',
    { class: 'card explore-search', role: 'search' },
    h('input', { type: 'search', name: 'q', placeholder: 'Kişi, paylaşım veya #etiket ara…', autocomplete: 'off', maxlength: 80 })
  );
  search.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = search.q.value.trim();
    if (q) location.hash = searchHref(q);
  });
  const tags = h('section', { class: 'card explore-tags hidden' });
  const tab = (key, label, href) => h('a', { href, class: sort === key ? 'active' : '' }, label);
  main.replaceChildren(
    h('div', { class: 'feed-header home-header' }, h('h2', {}, 'Akış')),
    feedTabs('explore'),
    search,
    tags,
    h('nav', { class: 'tabs feed-tabs' }, tab('new', 'Tümü', '#/kesfet'), tab('popular', 'Popüler', '#/kesfet?sirala=populer'))
  );
  api('/posts/tags')
    .then(({ tags: list }) => {
      if (!list.length) return;
      tags.replaceChildren(
        h('h3', {}, 'Gündemdekiler'),
        h('div', { class: 'tag-chips' }, ...list.map((t) => h('a', { class: 'tag-chip', href: searchHref(t.tag, 'paylasimlar') }, t.tag, h('span', {}, t.count))))
      );
      tags.classList.remove('hidden');
    })
    .catch(() => {});
  if (sort === 'popular') {
    let page = 0;
    renderPostList(main, async () => api(`/posts/explore?page=${page++}`), 'Son 7 günde henüz paylaşım yok.');
  } else {
    renderPostList(main, (before) => api(`/posts${before ? `?before=${before}` : ''}`), 'Henüz paylaşım yok. İlk paylaşımı sen yap! ');
  }
}

/** Tek paylaşım sayfası (bildirimden açılır). */
async function showPost(id) {
  main.replaceChildren(h('div', { class: 'feed-header' }, h('a', { href: '#/' }, '← Akışa dön')));
  try {
    const { post } = await api(`/posts/${id}`);
    main.append(renderPost(post));
  } catch (err) {
    main.append(h('div', { class: 'card empty-state' }, err.status === 404 ? 'Bu paylaşım silinmiş ya da görüntüleme iznin yok.' : err.message));
  }
}

/* ---------------- Yönlendirme ---------------- */

const ctx = { state, main, setMe, refreshMyStats, refreshUnread, renderUnread, route: () => route(), avatar, followButton, renderPostList };

function route() {
  const hash = location.hash || '#/';
  const [path] = hash.slice(1).split('?');
  const userMatch = path.match(/^\/u\/(.+)$/);
  const postMatch = path.match(/^\/p\/(\d+)$/);
  const isSearch = path === '/ara';
  const isBookmarks = path === '/kaydedilenler';
  const isExplore = path === '/kesfet';
  const messagesMatch = path.match(/^\/mesajlar(?:\/(.+))?$/);
  const settingsMatch = path.match(/^\/ayarlar(?:\/(\w+))?$/);
  const active = userMatch
    ? decodeURIComponent(userMatch[1]) === state.me.username
      ? 'me'
      : ''
    : settingsMatch
      ? 'settings'
      : path === '/bildirimler'
        ? 'notifications'
        : messagesMatch
          ? 'messages'
          : isSearch
            ? 'search'
            : isBookmarks
              ? 'bookmarks'
              : isExplore
                ? 'explore'
                : 'feed';
  document.querySelectorAll('#bottom-nav a[data-route]').forEach((a) => a.classList.toggle('active', a.dataset.route === active));
  // Masaüstü menüsünde Keşfet, Akış'ın bir sekmesi
  document.querySelectorAll('#nav a[data-route]').forEach((a) => a.classList.toggle('active', a.dataset.route === (active === 'explore' ? 'feed' : active)));

  if (userMatch) showUser(decodeURIComponent(userMatch[1]));
  else if (postMatch) showPost(postMatch[1]);
  else if (isBookmarks) showBookmarks();
  else if (isExplore) showExplore(new URLSearchParams(hash.split('?')[1] || ''));
  else if (isSearch) showSearch(ctx, new URLSearchParams(hash.split('?')[1] || ''));
  else if (messagesMatch) showMessages(ctx, messagesMatch[1] ? decodeURIComponent(messagesMatch[1]) : null);
  else if (settingsMatch) showSettings(ctx, settingsMatch[1] || 'profil', new URLSearchParams(hash.split('?')[1] || ''));
  else if (path === '/bildirimler') showNotifications(ctx);
  else showFeed();
  window.scrollTo(0, 0);
}

/* ---------------- Başlangıç ---------------- */

const me = await api('/auth/me');
if (!me.user) {
  location.replace('/' + location.search);
  throw new Error('Oturum yok');
}
state.me = me.user;
state.unread = me.unreadNotifications;
state.unreadMessages = me.unreadMessages;
const [colors, stats] = await Promise.all([api('/users/avatar-colors'), api('/users/me/stats')]);
state.colors = colors.colors;
state.socialKeys = colors.socialKeys;
state.stats = stats;

renderProfileCard();
renderUnread();
renderSuggestions();
document.getElementById('logout-btn').addEventListener('click', logout);

// Tema değişince Görünüm sekmesi açıksa seçimi yenile (düğmeyi theme.js yönetir)
document.addEventListener('lumora:theme', () => location.hash.startsWith('#/ayarlar/gorunum') && route());
document.getElementById('side-search').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = e.target.q.value.trim();
  location.hash = searchHref(q);
  e.target.reset();
});
// Mobil menü (çekmece): menü düğmesiyle açılır, bir sayfaya geçince kapanır ve sayfanın başına gidilir
const setDrawer = (open) => {
  document.body.classList.toggle('drawer-open', open);
  document.getElementById('menu-btn').setAttribute('aria-expanded', String(open));
};
// Menüdeki profil kartına dokununca kendi profiline git
document.getElementById('profile-card').addEventListener('click', () => (location.hash = `#/u/${encodeURIComponent(state.me.username)}`));
for (const id of ['menu-btn', 'bottom-menu']) document.getElementById(id).addEventListener('click', () => setDrawer(!document.body.classList.contains('drawer-open')));
document.getElementById('drawer-backdrop').addEventListener('click', () => setDrawer(false));
document.addEventListener('keydown', (e) => e.key === 'Escape' && setDrawer(false));
document.getElementById('nav').addEventListener('click', (e) => e.target.closest('a') && setDrawer(false));
window.addEventListener('hashchange', () => {
  setDrawer(false);
  window.scrollTo(0, 0);
});
document.getElementById('create-btn').addEventListener('click', openCreateSheet);
registerServiceWorker();
syncPush();
checkAndroidUpdate();
window.addEventListener('hashchange', route);
setInterval(refreshUnread, 30 * 1000);
route();


/* ---------------- Android uygulaması güncelleme uyarısı ---------------- */

/** Uygulama siteyi "?app=android&v=<sürüm>" ile açar; daha yeni sürüm yayınlandıysa üstte uyarı gösterilir. */
async function checkAndroidUpdate() {
  let version = 0;
  try {
    const p = new URLSearchParams(location.search);
    if (p.get('app') === 'android') sessionStorage.setItem('androidApp', p.get('v') || '0');
    version = Number(sessionStorage.getItem('androidApp') || 0);
  } catch {
    return;
  }
  if (!version) return;
  try {
    const latest = await api('/app/android');
    if (!latest.apkUrl || latest.versionCode <= version) return;
    const bar = h(
      'div',
      { class: 'card banner app-update' },
      h('span', {}, h('b', {}, `Yeni sürüm var (${latest.versionName})`), latest.notes ? ` · ${latest.notes}` : ''),
      h('a', { class: 'btn sm', href: latest.apkUrl }, 'Güncelle')
    );
    bar.classList.add('app-update-top');
    document.querySelector('.layout').before(bar);
  } catch {
    /* sessizce geç */
  }
}

/* ---------------- Mobil "+" düğmesi: gönderi veya hikaye ---------------- */

function openCreateSheet() {
  const close = () => backdrop.remove();
  const option = (title, desc, onClick) =>
    h('button', { type: 'button', class: 'create-option', onclick: () => (close(), onClick()) }, h('b', {}, title), h('span', { class: 'muted small' }, desc));
  const sheet = h(
    'div',
    { class: 'card create-sheet' },
    h('div', { class: 'sheet-handle' }),
    option('Gönderi paylaş', 'Yazı, fotoğraf veya anket', openPostComposer),
    option('Hikaye ekle', '24 saat sonra kaybolur', () => openStoryComposer(() => location.hash === '#/' || !location.hash ? route() : null))
  );
  const backdrop = h('div', { class: 'modal-backdrop sheet-backdrop' }, sheet);
  backdrop.addEventListener('click', (e) => e.target === backdrop && close());
  document.body.append(backdrop);
}

function openPostComposer() {
  const close = () => backdrop.remove();
  const box = composer((post) => {
    close();
    toast('Paylaşıldı.');
    const list = main.querySelector('.feed');
    if (list && ['', '#/'].includes(location.hash)) {
      list.querySelector('.empty-state')?.remove();
      list.prepend(renderPost(post));
    }
  });
  box.classList.add('modal', 'composer-modal');
  box.prepend(h('div', { class: 'composer-modal-head' }, h('b', {}, 'Yeni gönderi'), h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Kapat', onclick: close }, '✕')));
  const backdrop = h('div', { class: 'modal-backdrop' }, box);
  backdrop.addEventListener('click', (e) => e.target === backdrop && close());
  document.body.append(backdrop);
  box.querySelector('textarea')?.focus();
}
