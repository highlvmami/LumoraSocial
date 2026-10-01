/* Tüm sayfalarda ortak yardımcılar. */

/** `body` JSON olarak gönderilir; `blob` verilirse (ör. resim) olduğu gibi gönderilir. */
export async function api(path, { method = 'GET', body, blob } = {}) {
  let headers = {};
  let payload;
  if (blob) {
    headers = { 'Content-Type': blob.type };
    payload = blob;
  } else if (body !== undefined) {
    headers = { 'Content-Type': 'application/json' };
    payload = JSON.stringify(body);
  }
  const res = await fetch(`/api${path}`, { method, headers, body: payload, credentials: 'same-origin' });
  let data = {};
  try {
    data = await res.json();
  } catch {
    /* boş yanıt */
  }
  if (!res.ok) {
    const err = new Error(data.error || 'Bir hata oluştu.');
    err.status = res.status;
    throw err;
  }
  return data;
}

/** Güvenli DOM oluşturucu: metinler her zaman textContent ile yazılır (XSS koruması). */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function avatar(user, size = '') {
  const initials = (user.displayName || user.username || '?')
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toLocaleUpperCase('tr-TR');
  const content = user.avatarUrl ? h('img', { src: user.avatarUrl, alt: '', loading: 'lazy' }) : initials;
  return h('div', { class: `avatar ${size}`, style: { background: user.avatarColor }, 'aria-hidden': 'true' }, content);
}

/** Doğrulanmış hesap rozeti (mavi tik). */
export function badge(user) {
  return user?.isVerified ? h('span', { class: 'verified', title: 'Doğrulanmış hesap', 'aria-label': 'Doğrulanmış hesap' }, '✓') : null;
}

/** İsim + (varsa) doğrulama rozeti. */
export const nameWithBadge = (user) => [user.displayName, badge(user)];
export const usernameWithBadge = (user) => [user.username, badge(user)];

/** Sosyal ağ anahtarları: görünen ad, simge ve kullanıcı adından adres üretimi. */
export const SOCIALS = {
  instagram: { label: 'Instagram', url: (u) => `https://instagram.com/${u}` },
  x: { label: 'X (Twitter)', url: (u) => `https://x.com/${u}` },
  youtube: { label: 'YouTube', url: (u) => `https://youtube.com/@${u}` },
  tiktok: { label: 'TikTok', url: (u) => `https://tiktok.com/@${u}` },
  linkedin: { label: 'LinkedIn', url: (u) => `https://linkedin.com/in/${u}` },
  github: { label: 'GitHub', url: (u) => `https://github.com/${u}` },
  facebook: { label: 'Facebook', url: (u) => `https://facebook.com/${u}` },
};

export const socialHref = (key, value) => (/^https?:\/\//.test(value) ? value : SOCIALS[key]?.url(value));

/**
 * Seçilen resmi (isteğe bağlı en-boy oranıyla) ortadan kırpıp küçültür ve JPEG'e çevirir.
 * Kapak fotoğrafı için: cropImage(file, 1500, 500)
 */
export async function cropImage(file, width, height) {
  if (!file.type.startsWith('image/')) throw new Error('Lütfen bir resim dosyası seçin.');
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('Bu resim açılamadı. JPG veya PNG deneyin.');
  }
  const ratio = width / height;
  let sw = bitmap.width;
  let sh = sw / ratio;
  if (sh > bitmap.height) {
    sh = bitmap.height;
    sw = sh * ratio;
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(bitmap, (bitmap.width - sw) / 2, (bitmap.height - sh) / 2, sw, sh, 0, 0, width, height);
  bitmap.close();
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86));
}

/** Fotoğrafı oranını bozmadan en uzun kenarı `maxSide` olacak şekilde küçültür (JPEG). */
export async function resizeImage(file, maxSide = 1600) {
  if (!file.type.startsWith('image/')) throw new Error(`"${file.name}" bir resim dosyası değil.`);
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(`"${file.name}" açılamadı. JPG veya PNG deneyin.`);
  }
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; // şeffaf PNG'ler siyah görünmesin
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  return { blob, width, height };
}

/** Fotoğrafı tam ekran gösterir (tıklayınca veya Esc ile kapanır, oklarla gezilir). */
export function openLightbox(images, start = 0) {
  let i = start;
  const img = h('img', { alt: '' });
  const counter = h('div', { class: 'lightbox-counter' });
  const show = () => {
    img.src = images[i].url;
    counter.textContent = images.length > 1 ? `${i + 1} / ${images.length}` : '';
  };
  const move = (d) => {
    i = (i + d + images.length) % images.length;
    show();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowRight') move(1);
    if (e.key === 'ArrowLeft') move(-1);
  };
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
  const nav = (dir, label) =>
    h('button', { class: `lightbox-nav ${dir > 0 ? 'next' : 'prev'}`, type: 'button', 'aria-label': label, onclick: (e) => (e.stopPropagation(), move(dir)) }, dir > 0 ? '›' : '‹');
  const overlay = h(
    'div',
    { class: 'lightbox', onclick: close },
    img,
    images.length > 1 ? nav(-1, 'Önceki') : null,
    images.length > 1 ? nav(1, 'Sonraki') : null,
    counter,
    h('button', { class: 'lightbox-close', type: 'button', 'aria-label': 'Kapat' }, '✕')
  );
  document.addEventListener('keydown', onKey);
  show();
  document.body.append(overlay);
}

/**
 * Açılır menü (⋯). items: [{ label, onClick, danger }] (null olanlar atlanır).
 * Dışarı tıklayınca veya Esc ile kapanır.
 */
export function dropdown(items, { label = '⋯', title = 'Diğer' } = {}) {
  const list = items.filter(Boolean);
  const wrap = h('div', { class: 'dropdown' });
  const panel = h('div', { class: 'dropdown-menu hidden', role: 'menu' });
  const btn = h('button', { type: 'button', class: 'icon-btn dropdown-toggle', title, 'aria-label': title, 'aria-haspopup': 'true' }, label);
  const close = () => {
    panel.classList.add('hidden');
    document.removeEventListener('click', outside, true);
    document.removeEventListener('keydown', onKey);
  };
  const outside = (e) => !wrap.contains(e.target) && close();
  const onKey = (e) => e.key === 'Escape' && close();
  btn.addEventListener('click', () => {
    const open = panel.classList.toggle('hidden') === false;
    if (open) {
      document.addEventListener('click', outside, true);
      document.addEventListener('keydown', onKey);
    } else close();
  });
  panel.append(
    ...list.map((it) =>
      h('button', { type: 'button', role: 'menuitem', class: `dropdown-item ${it.danger ? 'danger' : ''}`, onclick: () => (close(), it.onClick()) }, it.label)
    )
  );
  wrap.append(btn, panel);
  return list.length ? wrap : null;
}

let reportReasons;
/** Şikâyet penceresi. type: 'post' | 'comment' | 'user' */
export async function openReportDialog(type, id, subject) {
  reportReasons ||= (await api('/reports/reasons')).reasons;
  const alertEl = h('div', { class: 'alert hidden' });
  const form = h(
    'form',
    { class: 'card modal' },
    h('h2', {}, 'Şikâyet et'),
    h('p', { class: 'muted small' }, `${subject} yöneticilere bildirilecek. Kimin şikâyet ettiği karşı tarafa gösterilmez.`),
    h(
      'div',
      { class: 'reason-list' },
      Object.entries(reportReasons).map(([key, label], i) =>
        h('label', { class: 'reason' }, h('input', { type: 'radio', name: 'reason', value: key, required: true, checked: i === 0 }), label)
      )
    ),
    h('label', {}, 'Açıklama (isteğe bağlı)', h('textarea', { name: 'details', maxlength: 500, placeholder: 'Yöneticilerin bilmesi gereken bir şey varsa yaz…' })),
    alertEl,
    h('div', { class: 'modal-actions' }, h('button', { type: 'button', class: 'btn ghost', 'data-close': true }, 'Vazgeç'), h('button', { type: 'submit', class: 'btn danger' }, 'Şikâyet et'))
  );
  const backdrop = h('div', { class: 'modal-backdrop' }, form);
  const close = () => backdrop.remove();
  backdrop.addEventListener('click', (e) => (e.target === backdrop || e.target.dataset.close !== undefined) && close());
  handleForm(form, alertEl, async ({ reason, details }) => {
    await api('/reports', { method: 'POST', body: { type, id, reason, details } });
    close();
    toast('Şikâyetin alındı. Teşekkürler, yöneticiler inceleyecek.');
  });
  document.body.append(backdrop);
}

/** "Şifreler eşleşmiyor" kontrolünü tarayıcıda anında gösterir. */
export function bindPasswordConfirm(passwordInput, confirmInput) {
  const check = () =>
    confirmInput.setCustomValidity(confirmInput.value && confirmInput.value !== passwordInput.value ? 'Şifreler eşleşmiyor.' : '');
  passwordInput.addEventListener('input', check);
  confirmInput.addEventListener('input', check);
}

/**
 * Seçilen resmi tarayıcıda ortadan kare kırpıp küçültür ve JPEG'e çevirir.
 * Böylece yüklenen dosya küçük olur ve fotoğraftaki konum vb. (EXIF) bilgileri silinir.
 */
export async function squareImage(file, size = 400) {
  if (!file.type.startsWith('image/')) throw new Error('Lütfen bir resim dosyası seçin.');
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('Bu resim açılamadı. JPG veya PNG deneyin.');
  }
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  canvas
    .getContext('2d')
    .drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  bitmap.close();
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88));
}

/** SQLite UTC zamanını "5 dk önce" biçimine çevirir. */
export function timeAgo(sqlDate) {
  const date = new Date(sqlDate.replace(' ', 'T') + 'Z');
  const s = Math.floor((Date.now() - date.getTime()) / 1000);
  if (s < 60) return 'az önce';
  if (s < 3600) return `${Math.floor(s / 60)} dk önce`;
  if (s < 86400) return `${Math.floor(s / 3600)} sa önce`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} gün önce`;
  return date.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function formatDate(sqlDate) {
  return new Date(sqlDate.replace(' ', 'T') + 'Z').toLocaleDateString('tr-TR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

let toastTimer;
export function toast(message, type = '') {
  document.querySelector('.toast')?.remove();
  const el = h('div', { class: `toast ${type}`, role: 'status' }, message);
  document.body.append(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 3000);
}

export function showAlert(el, message, type = 'error') {
  el.className = `alert ${type}`;
  el.textContent = message;
  el.classList.toggle('hidden', !message);
}

/** Form gönderimini yönetir: butonu kilitler, hatayı gösterir. */
export function handleForm(form, alertEl, fn) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    btn && (btn.disabled = true);
    alertEl && alertEl.classList.add('hidden');
    try {
      await fn(Object.fromEntries(new FormData(form)));
    } catch (err) {
      if (alertEl) showAlert(alertEl, err.message);
      else toast(err.message, 'error');
    } finally {
      btn && (btn.disabled = false);
    }
  });
}

export function confirmDialog(message) {
  return window.confirm(message);
}

export async function logout() {
  await api('/auth/logout', { method: 'POST', body: {} });
  location.href = '/';
}
