import { api, avatar, dropdown, formatDate, h, handleForm, logout, nameWithBadge, usernameWithBadge, openReportDialog, openLightbox, resizeImage, SOCIALS, socialHref, timeAgo, toast } from './common.js';
import { storyBar } from './stories.js';
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
      me.role === 'admin' ? h('div', {}, h('span', { class: 'badge-admin' }, 'Yönetici')) : null,
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
  document.getElementById('nav-admin').classList.toggle('hidden', me.role !== 'admin');
}

function renderUnread() {
  for (const [id, n] of [['unread-count', state.unread], ['unread-messages', state.unreadMessages]]) {
    const el = document.getElementById(id);
    el.textContent = n > 99 ? '99+' : n;
    el.classList.toggle('hidden', !n);
  }
  // Mobilde menü kapalıyken okunmamışlar menü düğmesindeki noktayla gösterilir
  document.getElementById('menu-dot').classList.toggle('hidden', !(state.unread || state.unreadMessages));
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
    if (status === 'accepted' && user.privateAccount && !confirm('Gizli hesap: takibi bırakırsan yeniden istek göndermen gerekir. Devam edilsin mi?')) return;
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

const canModify = (ownerId) => ownerId === state.me.id || state.me.role === 'admin';
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
          h('p', {}, c.content)
        ),
        c.author.id !== state.me.id
          ? h('button', { class: 'icon-btn comment-report', title: 'Yorumu şikâyet et', 'aria-label': 'Yorumu şikâyet et', onclick: () => openReportDialog('comment', c.id, 'Bu yorum') }, 'Şikâyet')
          : null,
        canModify(c.author.id)
          ? h(
              'button',
              {
                class: 'icon-btn',
                title: 'Yorumu sil',
                'aria-label': 'Yorumu sil',
                onclick: async () => {
                  if (!confirm('Yorum silinsin mi?')) return;
                  const res = await api(`/posts/${post.id}/comments/${c.id}`, { method: 'DELETE' });
                  post.comments = res.comments;
                  renderComments(post, container);
                },
              },
              '✕'
            )
          : null
      )
    ),
    commentForm(post, container)
  );
}

function commentForm(post, container) {
  const input = h('input', { name: 'content', maxlength: 500, placeholder: 'Yorum yaz…', required: true, autocomplete: 'off' });
  const form = h('form', { class: 'comment-form' }, avatar(state.me, 'sm'), input, h('button', { class: 'btn sm', type: 'submit' }, 'Gönder'));
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
        h('div', { class: 'muted small' }, `${post.author.displayName} · ${timeAgo(post.createdAt)}`)
      ),
      postMenu(post, () => el)
    ),
    post.content ? h('div', { class: 'post-body' }, linkifyTags(post.content)) : null,
    postImages(post),
    reactions,
    comments
  );
  return el;
}

/** Engelle (onaylı). Engellenince sayfa yenilenir; o kişinin içerikleri kaybolur. */
async function blockUser(user) {
  if (!confirm(`@${user.username} engellensin mi?

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
        if (!confirm('Bu paylaşım silinsin mi?')) return;
        await api(`/posts/${post.id}`, { method: 'DELETE' });
        getEl().remove();
        toast('Paylaşım silindi.');
      },
    },
  ]);
}

/** Metindeki #etiketleri arama bağlantısına çevirir (metin olarak kalır, HTML yorumlanmaz). */
function linkifyTags(text) {
  return text.split(/(#[\p{L}\p{N}_]{2,40})/u).map((part, i) => (i % 2 ? h('a', { class: 'hashtag', href: searchHref(part, 'paylasimlar') }, part) : part));
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
    photoBtn.classList.toggle('hidden', images.length >= MAX_IMAGES);
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

  const form = h(
    'form',
    { class: 'card composer' },
    textarea,
    previews,
    h('div', { class: 'row' }, h('div', { class: 'row-left' }, photoBtn, counter), submit)
  );
  handleForm(form, null, async ({ content }) => {
    if (!content.trim() && !images.length) throw new Error('Bir şeyler yaz veya fotoğraf ekle.');
    const { post } = await api('/posts', { method: 'POST', body: { content, imageIds: images.map((i) => i.id) } });
    form.reset();
    images = [];
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
function showFeed(scope) {
  const tab = (key, label, href) => h('a', { href, class: scope === key ? 'active' : '' }, label);
  main.replaceChildren(
    ...[
      h('div', { class: 'feed-header' }, h('h2', {}, 'Akış')),
      verifyBanner(),
      storyBar(state.me),
      h('nav', { class: 'tabs feed-tabs' }, tab('all', 'Genel akış', '#/'), tab('following', 'Takip ettiklerim', '#/takip')),
    ].filter(Boolean)
  );
  let list;
  main.append(
    composer((post) => {
      list.querySelector('.empty-state')?.remove();
      list.prepend(renderPost(post));
    })
  );
  const query = (before) => new URLSearchParams({ ...(scope === 'following' && { scope }), ...(before && { before }) });
  list = renderPostList(
    main,
    (before) => api(`/posts?${query(before)}`),
    scope === 'following'
      ? 'Takip ettiğin kişilerin paylaşımları burada görünür. Genel akıştan veya önerilen kişilerden birilerini takip et. '
      : undefined
  );
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
      h('h2', { class: 'hero-name' }, ...nameWithBadge(u), u.privateAccount ? h('span', { class: 'lock', title: 'Gizli hesap' }, 'Gizli hesap') : null),
      h('div', { class: 'muted' }, `@${u.username}`, u.role === 'admin' ? ' · ' : '', u.role === 'admin' ? h('span', { class: 'badge-admin' }, 'Yönetici') : null),
      u.bio ? h('p', { class: 'bio' }, u.bio) : null,
      facts.length ? h('ul', { class: 'facts' }, facts) : null,
      socials.length ? h('div', { class: 'socials' }, socials) : null,
      u.interests?.length ? h('div', { class: 'chips' }, u.interests.map((i) => h('span', { class: 'chip' }, i))) : null,
      stats
    )
  );
}

function showUser(username) {
  main.replaceChildren(h('div', { class: 'feed-header' }, h('a', { href: '#/' }, '← Akışa dön')));
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
              : 'feed';
  document.querySelectorAll('#nav a[data-route]').forEach((a) => a.classList.toggle('active', a.dataset.route === active));

  if (userMatch) showUser(decodeURIComponent(userMatch[1]));
  else if (postMatch) showPost(postMatch[1]);
  else if (isBookmarks) showBookmarks();
  else if (isSearch) showSearch(ctx, new URLSearchParams(hash.split('?')[1] || ''));
  else if (messagesMatch) showMessages(ctx, messagesMatch[1] ? decodeURIComponent(messagesMatch[1]) : null);
  else if (settingsMatch) showSettings(ctx, settingsMatch[1] || 'profil', new URLSearchParams(hash.split('?')[1] || ''));
  else if (path === '/bildirimler') showNotifications(ctx);
  else showFeed(path === '/takip' ? 'following' : 'all');
  window.scrollTo(0, 0);
}

/* ---------------- Başlangıç ---------------- */

const me = await api('/auth/me');
if (!me.user) {
  location.href = '/';
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
document.getElementById('menu-btn').addEventListener('click', () => setDrawer(!document.body.classList.contains('drawer-open')));
document.getElementById('drawer-backdrop').addEventListener('click', () => setDrawer(false));
document.addEventListener('keydown', (e) => e.key === 'Escape' && setDrawer(false));
document.getElementById('nav').addEventListener('click', (e) => e.target.closest('a') && setDrawer(false));
window.addEventListener('hashchange', () => {
  setDrawer(false);
  window.scrollTo(0, 0);
});
window.addEventListener('hashchange', route);
setInterval(refreshUnread, 30 * 1000);
route();

