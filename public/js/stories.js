import { api, avatar, h, resizeImage, timeAgo, toast } from './common.js';

/*
 * Hikayeler: akışın üstündeki yuvarlak profil çubuğu, tam ekran görüntüleyici ve hikaye ekleme penceresi.
 * Hikayeler 24 saat sonra kaybolur; yalnızca onaylı takipçiler görür.
 */

const STORY_MS = 5000;
let backgrounds = [];
let reactions = [];

/** Akışın en üstüne konan hikaye çubuğu. me: oturumdaki kullanıcı */
export function storyBar(me) {
  const bar = h('section', { class: 'card story-bar', 'aria-label': 'Hikayeler' });
  const load = async () => {
    let tray;
    try {
      ({ tray, backgrounds, reactions } = await api('/stories'));
    } catch {
      bar.remove();
      return;
    }
    const mine = tray.find((g) => g.user.id === me.id);
    const others = tray.filter((g) => g.user.id !== me.id);
    const bubble = (group, label, extra) =>
      h(
        'button',
        { type: 'button', class: `story-bubble ${group && !group.allViewed ? 'unseen' : ''}`, onclick: extra.onclick, title: label },
        h('span', { class: 'story-ring' }, avatar(group?.user || me, 'lg'), extra.plus ? h('span', { class: 'story-plus', 'aria-hidden': 'true' }, '+') : null),
        h('span', { class: 'story-name' }, label)
      );
    bar.replaceChildren(
      bubble(mine, 'Hikayen', {
        plus: !mine,
        onclick: () => (mine ? openViewer(tray, tray.indexOf(mine), me, load) : openComposer(load)),
      }),
      ...others.map((g) => bubble(g, g.user.username, { onclick: () => openViewer(tray, tray.indexOf(g), me, load) }))
    );
  };
  load();
  return bar;
}

/* ---------------- Görüntüleyici ---------------- */

function openViewer(tray, groupIndex, me, onClose) {
  let gi = groupIndex;
  let si = Math.max(0, tray[gi].stories.findIndex((s) => !s.viewed));
  let timer;
  let started;
  let remaining = STORY_MS;
  let paused = false;

  const progress = h('div', { class: 'story-progress' });
  const head = h('div', { class: 'story-head' });
  const stage = h('div', { class: 'story-stage' });
  const foot = h('div', { class: 'story-foot' });
  const viewer = h(
    'div',
    { class: 'story-viewer', role: 'dialog', 'aria-label': 'Hikaye' },
    h('div', { class: 'story-frame' }, progress, head, stage, foot, h('button', { type: 'button', class: 'story-tap prev', 'aria-label': 'Önceki', onclick: () => step(-1) }), h('button', { type: 'button', class: 'story-tap next', 'aria-label': 'Sonraki', onclick: () => step(1) }))
  );

  const close = () => {
    clearTimeout(timer);
    viewer.remove();
    document.removeEventListener('keydown', onKey);
    document.body.classList.remove('story-open');
    onClose?.();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowRight') step(1);
    if (e.key === 'ArrowLeft') step(-1);
  };

  const schedule = (ms) => {
    clearTimeout(timer);
    started = Date.now();
    remaining = ms;
    timer = setTimeout(() => step(1), ms);
  };
  const setPaused = (p) => {
    if (p === paused) return;
    paused = p;
    viewer.classList.toggle('paused', p);
    if (p) {
      clearTimeout(timer);
      remaining -= Date.now() - started;
    } else schedule(remaining);
  };

  function step(d) {
    const group = tray[gi];
    si += d;
    if (si >= group.stories.length) {
      gi += 1;
      si = 0;
    } else if (si < 0) {
      gi -= 1;
      si = gi >= 0 ? tray[gi].stories.length - 1 : 0;
    }
    if (gi < 0 || gi >= tray.length) return close();
    show();
  }

  function show() {
    const group = tray[gi];
    const story = group.stories[si];
    const mine = group.user.id === me.id;
    paused = false;
    viewer.classList.remove('paused');

    progress.replaceChildren(
      ...group.stories.map((_, i) => h('span', { class: i < si ? 'done' : i === si ? 'active' : '' }, h('i', {})))
    );
    progress.querySelector('.active i')?.style.setProperty('animation-duration', `${STORY_MS}ms`);

    head.replaceChildren(
      h('a', { class: 'story-user', href: `#/u/${encodeURIComponent(group.user.username)}`, onclick: close }, avatar(group.user, 'sm'), h('b', {}, group.user.username), h('span', {}, timeAgo(story.createdAt))),
      h('button', { type: 'button', class: 'story-close', 'aria-label': 'Kapat', onclick: close }, '✕')
    );

    stage.replaceChildren(
      story.imageUrl
        ? h('div', { class: 'story-photo' }, h('img', { src: story.imageUrl, alt: '' }), story.text ? h('p', { class: 'story-caption' }, story.text) : null)
        : h('div', { class: 'story-text', style: { background: story.bg || '#1f4e8c' } }, h('p', {}, story.text))
    );

    foot.replaceChildren();
    if (mine) {
      const viewersBtn = h('button', { type: 'button', class: 'story-action' }, 'Görenler');
      viewersBtn.addEventListener('click', async () => {
        setPaused(true);
        const { viewers } = await api(`/stories/${story.id}/viewers`);
        showViewers(viewers, () => setPaused(false));
      });
      foot.append(
        viewersBtn,
        h('button', {
          type: 'button',
          class: 'story-action danger',
          onclick: async () => {
            setPaused(true);
            if (!confirm('Bu hikaye silinsin mi?')) return setPaused(false);
            await api(`/stories/${story.id}`, { method: 'DELETE' });
            group.stories.splice(si, 1);
            toast('Hikaye silindi.');
            if (!group.stories.length) return close();
            si = Math.min(si, group.stories.length - 1);
            show();
          },
        }, 'Sil'),
        h('button', { type: 'button', class: 'story-action', onclick: () => (close(), openComposer(onClose)) }, 'Yeni hikaye')
      );
    } else {
      if (!story.viewed) {
        story.viewed = true;
        api(`/stories/${story.id}/view`, { method: 'POST', body: {} }).catch(() => {});
      }
      foot.append(replyBar(group, story));
    }
    schedule(STORY_MS);
  }

  // Emoji tepkisi ve yazılı yanıt; ikisi de hikaye sahibine mesaj olarak gider
  function replyBar(group, story) {
    const emojis = h(
      'div',
      { class: 'story-emojis' },
      ...reactions.map((e) =>
        h('button', {
          type: 'button',
          class: `story-emoji ${story.myReaction === e ? 'mine' : ''}`,
          title: story.myReaction === e ? 'Tepkini geri al' : 'Tepki ver',
          onclick: async (ev) => {
            ev.currentTarget.classList.add('pop');
            try {
              const { reaction } = await api(`/stories/${story.id}/react`, { method: 'POST', body: { emoji: e } });
              story.myReaction = reaction;
              emojis.querySelectorAll('.story-emoji').forEach((b) => b.classList.toggle('mine', b.textContent === reaction));
              if (reaction) toast(`${reaction} ${group.user.username} kullanıcısına gönderildi.`);
            } catch (err) {
              toast(err.message, 'error');
            }
          },
        }, e)
      )
    );
    const input = h('input', { type: 'text', maxlength: 1000, placeholder: `${group.user.username} kullanıcısına yanıt ver…`, 'aria-label': 'Hikayeye yanıt' });
    const form = h('form', { class: 'story-reply' }, input, h('button', { type: 'submit', class: 'story-send' }, 'Gönder'));
    // Yazarken hikaye durur
    input.addEventListener('focus', () => setPaused(true));
    input.addEventListener('blur', () => !input.value && setPaused(false));
    input.addEventListener('keydown', (e) => e.stopPropagation());
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      try {
        await api(`/stories/${story.id}/reply`, { method: 'POST', body: { text } });
        input.value = '';
        input.blur();
        toast('Yanıtın mesaj olarak gönderildi.');
        setPaused(false);
      } catch (err) {
        toast(err.message, 'error');
      }
    });
    return h('div', { class: 'story-replybar' }, emojis, form);
  }

  // Basılı tutunca durur (telefonda parmakla, bilgisayarda fareyle)
  stage.addEventListener('pointerdown', () => setPaused(true));
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => stage.addEventListener(ev, () => setPaused(false)));

  document.addEventListener('keydown', onKey);
  document.body.classList.add('story-open');
  document.body.append(viewer);
  show();
}

function showViewers(viewers, onDone) {
  const box = h(
    'div',
    { class: 'card modal story-viewers' },
    h('h2', {}, `Görenler (${viewers.length})`),
    viewers.length
      ? h('div', { class: 'viewer-list' }, ...viewers.map((u) => h('div', { class: 'viewer-row' }, avatar(u, 'sm'), h('b', {}, u.username), u.reaction ? h('span', { class: 'viewer-reaction' }, u.reaction) : null, h('span', { class: 'muted small' }, timeAgo(u.viewedAt)))))
      : h('p', { class: 'muted' }, 'Henüz kimse görmedi.'),
    h('div', { class: 'modal-actions' }, h('button', { type: 'button', class: 'btn', 'data-close': true }, 'Kapat'))
  );
  const backdrop = h('div', { class: 'modal-backdrop story-modal' }, box);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop || e.target.dataset.close !== undefined) {
      backdrop.remove();
      onDone();
    }
  });
  document.body.append(backdrop);
}

/* ---------------- Hikaye ekleme ---------------- */

export function openComposer(onDone) {
  let file = null;
  let bg = backgrounds[0] || '#1f4e8c';
  const preview = h('div', { class: 'story-compose-preview' });
  const text = h('textarea', { maxlength: 200, rows: 3, placeholder: 'Bir şey yaz… (fotoğraf eklersen altına yazı olur)' });
  const fileInput = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', class: 'hidden' });
  const colors = h('div', { class: 'story-colors' });
  const submit = h('button', { type: 'submit', class: 'btn' }, 'Paylaş');

  const paint = () => {
    preview.replaceChildren(
      file
        ? h('img', { src: URL.createObjectURL(file), alt: '' })
        : h('div', { class: 'story-text small-preview', style: { background: bg } }, h('p', {}, text.value || 'Yazın burada görünür'))
    );
    colors.classList.toggle('hidden', Boolean(file));
    colors.replaceChildren(
      ...backgrounds.map((c) =>
        h('button', { type: 'button', class: `swatch ${c === bg ? 'selected' : ''}`, style: { background: c }, 'aria-label': 'Arka plan rengi', onclick: () => ((bg = c), paint()) })
      )
    );
  };
  text.addEventListener('input', () => !file && paint());
  fileInput.addEventListener('change', () => {
    file = fileInput.files[0] || null;
    paint();
  });

  const form = h(
    'form',
    { class: 'card modal story-compose' },
    h('h2', {}, 'Hikaye ekle'),
    h('p', { class: 'muted small' }, 'Hikayen 24 saat sonra kaybolur ve yalnızca takipçilerin görür.'),
    preview,
    colors,
    text,
    h(
      'div',
      { class: 'modal-actions' },
      h('button', { type: 'button', class: 'btn ghost', onclick: () => fileInput.click() }, 'Fotoğraf seç'),
      h('span', { class: 'spacer' }),
      h('button', { type: 'button', class: 'btn ghost', 'data-close': true }, 'Vazgeç'),
      submit
    ),
    fileInput
  );
  const backdrop = h('div', { class: 'modal-backdrop' }, form);
  const close = () => backdrop.remove();
  backdrop.addEventListener('click', (e) => (e.target === backdrop || e.target.dataset.close !== undefined) && close());

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    submit.disabled = true;
    try {
      if (file) {
        const { blob } = await resizeImage(file, 1440);
        await api(`/stories/photo?${new URLSearchParams({ text: text.value.trim() })}`, { method: 'POST', blob });
      } else {
        if (!text.value.trim()) throw new Error('Bir şey yaz ya da fotoğraf seç.');
        await api('/stories', { method: 'POST', body: { text: text.value, bg } });
      }
      close();
      toast('Hikayen paylaşıldı.');
      onDone?.();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      submit.disabled = false;
    }
  });

  paint();
  document.body.append(backdrop);
  text.focus();
}
