import { api, h, toast } from './common.js';

/*
 * Anlık bildirim (Web Push): telefona/bilgisayara, site kapalıyken bile bildirim.
 * iPhone'da yalnızca site "Ana Ekrana Ekle" ile uygulama gibi açıldığında çalışır (iOS 16.4+).
 */

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

export function registerServiceWorker() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
}

const toKey = (base64) => {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

/** Servis çalışanı kaydı; kaydedilemiyorsa (desteklenmeyen ortam) null. */
async function registration() {
  try {
    return (await navigator.serviceWorker.getRegistration('/')) || (await navigator.serviceWorker.register('/sw.js'));
  } catch {
    return null;
  }
}

async function currentSubscription() {
  const reg = await registration();
  return reg ? reg.pushManager.getSubscription() : null;
}

const report = (err) => api('/push/error', { method: 'POST', body: { message: err?.message || String(err) } }).catch(() => {});

async function enable() {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Bildirim izni verilmedi. Tarayıcı ayarlarından bu siteye izin verebilirsin.');
  const { publicKey } = await api('/push/key');
  const reg = await registration();
  if (!reg) throw new Error('Bu tarayıcı anlık bildirimleri desteklemiyor.');
  const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(publicKey) }));
  await api('/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON() } });
}

/** İzin daha önce verildiyse aboneliği her açılışta sunucuyla eşitler (silinmiş/yenilenmiş abonelikler için). */
export async function syncPush() {
  if (!pushSupported() || Notification.permission !== 'granted') return;
  try {
    await enable();
  } catch (err) {
    report(err);
  }
}

/** Ana sayfada bir kez gösterilen "Bildirimleri aç" çağrısı (izin hiç sorulmadıysa). */
export function pushPrompt() {
  let dismissed = false;
  try {
    dismissed = localStorage.getItem('pushPromptDismissed') === '1';
  } catch {
    /* yok say */
  }
  if (dismissed || !pushSupported() || Notification.permission !== 'default') return null;
  const box = h('section', { class: 'card banner push-prompt' });
  const close = () => {
    box.remove();
    try {
      localStorage.setItem('pushPromptDismissed', '1');
    } catch {
      /* yok say */
    }
  };
  const on = h('button', { type: 'button', class: 'btn sm' }, 'Bildirimleri aç');
  on.addEventListener('click', async () => {
    on.disabled = true;
    try {
      await enable();
      toast('Anlık bildirimler açıldı.');
      close();
    } catch (err) {
      report(err);
      toast(err.message, 'error');
      on.disabled = false;
    }
  });
  box.append(h('span', {}, h('b', {}, 'Bildirim almak ister misin?'), ' Beğeni, yorum ve mesajlarda telefonuna haber verelim.'), h('div', { class: 'push-prompt-actions' }, h('button', { type: 'button', class: 'btn sm ghost', onclick: close }, 'Şimdi değil'), on));
  return box;
}

async function disable() {
  const sub = await currentSubscription();
  if (!sub) return;
  await api('/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } });
  await sub.unsubscribe();
}

/** Bildirimler sayfasının üstündeki "Telefona bildirim" kartı */
export function pushCard() {
  const card = h('section', { class: 'card panel push-card hidden' });
  const paint = async () => {
    if (!pushSupported() || !(await registration())) {
      if (isIos() && !isStandalone()) {
        card.replaceChildren(
          h('b', {}, 'Telefona bildirim almak için'),
          h('p', { class: 'muted small' }, 'Safari\'de alttaki Paylaş düğmesine bas, "Ana Ekrana Ekle"yi seç ve LumoraSocial\'ı ana ekrandaki simgeden aç. Sonra buradan bildirimleri açabilirsin.')
        );
        card.classList.remove('hidden');
      } else card.remove();
      return;
    }
    const sub = await currentSubscription().catch(() => null);
    const on = Boolean(sub) && Notification.permission === 'granted';
    const btn = h('button', { type: 'button', class: `btn sm ${on ? 'ghost' : ''}` }, on ? 'Kapat' : 'Aç');
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        if (on) {
          await disable();
          toast('Bu cihazda anlık bildirimler kapatıldı.');
        } else {
          await enable().catch((err) => (report(err), Promise.reject(err)));
          toast('Anlık bildirimler açıldı.');
        }
      } catch (err) {
        toast(err.message, 'error');
      }
      paint();
    });
    card.replaceChildren(
      h(
        'div',
        { class: 'push-row' },
        h('div', {}, h('b', {}, on ? 'Anlık bildirimler açık' : 'Telefona anlık bildirim'), h('p', { class: 'muted small' }, on ? 'Bu cihaza beğeni, yorum, takip ve mesaj bildirimleri gelir.' : 'Site kapalıyken bile beğeni, yorum ve mesajlardan haberin olsun.')),
        btn
      )
    );
    card.classList.remove('hidden');
  };
  paint();
  return card;
}
