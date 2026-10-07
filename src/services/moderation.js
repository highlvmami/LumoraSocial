/*
 * Otomatik yazı denetimi: Türkçe ve İngilizce küfür / hakaret listesi.
 * Ücretsizdir ve tamamen sunucuda çalışır. Kaçamak yazımları da yakalar:
 * büyük/küçük harf, 4→a, 1→i gibi rakamlar, tekrar eden harfler (siiik), harf aralarına
 * konan nokta/boşluk (s.i.k, f u c k).
 */

import { config } from '../config.js';

// Rakam ve sembolle yazılan harfler
const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's', '!': 'i', '€': 'e' };
// Türkçe harfler sadeleştirilir; ı ayrıca ele alınır (sık/sik karışmasın diye)
const FOLD = { ç: 'c', ş: 's', ğ: 'g', ö: 'o', ü: 'u', â: 'a', î: 'i', û: 'u' };

/**
 * exact = sözcüğün tamamı, prefix = sözcük böyle başlıyorsa, part = sözcüğün içinde geçiyorsa.
 * dotted: ı ile i ayrı tutulur (sık, sıkıntı gibi masum sözcükler yakalanmasın); except: masum istisnalar.
 * raw: Türkçe harfiyle yazılmadıkça masum olan sözcükler (got / göt, pic / piç).
 */
const RULES = [
  // Türkçe
  { exact: ['amk', 'amq', 'aq', 'ibne', 'gotu', 'gotun', 'gotunu', 'yarak', 'kahpe', 'kaltak', 'gavat', 'pust', 'pic', 'oc'], raw: ['got', 'pic', 'oc'] },
  { prefix: ['amcik', 'aminako', 'aminakoy', 'aminag', 'orospu', 'orspu', 'orosbu', 'yarrak', 'yarag', 'dalyarak', 'pezevenk', 'yavsak', 'gotveren', 'gotos', 'gotlek', 'ibnelik', 'kahpelik', 'kancik', 'serefsiz', 'tassak', 'yarram'] },
  {
    prefix: ['sik'],
    dotted: true,
    except: ['siklet', 'sikinti', 'sikil', 'sikici', 'sikica', 'sikisik', 'sikistir', 'sikayet', 'sikay', 'sikest', 'sikh'],
    exceptExact: ['siki'],
  },
  // İngilizce
  { part: ['fuck', 'motherf', 'nigger', 'nigga', 'faggot', 'bitch', 'asshole', 'whore', 'pussy', 'dickhead', 'porn'] },
  { exact: ['fck', 'fcking', 'stfu', 'dick', 'dicks', 'cock', 'cocks', 'fag', 'fags', 'slut', 'sluts', 'bastard', 'bastards', 'retard', 'retarded', 'twat', 'cunt', 'cunts', 'wanker', 'shit', 'shits', 'shitty', 'bullshit', 'nudes'] },
  { prefix: ['shithead', 'shitfac'] },
  // Cinsel içerik
  { exact: ['sex', 'sexy', 'sexi', 'seks', 'seksi', 'xxx', 'penis', 'vajina', 'vagina', 'escort', 'eskort'], prefix: ['sexting', 'sextape', 'seksting', 'onlyfans', 'hentai', 'pornhub', 'xvideos', 'xhamster', 'brazzers'] },
];

/** Harfleri sadeleştir; tekrar eden harfleri tek harfe indir. keepDotless: ı korunur. */
function normalizeWord(word, keepDotless) {
  let w = '';
  for (const ch of word.toLocaleLowerCase('tr')) {
    const c = LEET[ch] ?? FOLD[ch] ?? ch;
    w += c === 'ı' && !keepDotless ? 'i' : c;
  }
  return w.replace(/(.)\1+/g, '$1');
}

const norm = (list) => (list || []).map((x) => normalizeWord(x, false));
const COMPILED = RULES.map((r) => ({
  exact: new Set(norm(r.exact).filter((x) => !(r.raw || []).includes(x))),
  prefix: norm(r.prefix),
  part: norm(r.part),
  except: norm(r.except),
  exceptExact: new Set(norm(r.exceptExact)),
  dotted: !!r.dotted,
}));
const LONG_PREFIXES = COMPILED.filter((r) => !r.dotted).flatMap((r) => r.prefix).filter((p) => p.length >= 6);
// Türkçe harfiyle yazıldığında küfür olanlar (göt, piç, oç)
const RAW_EXACT = new Set(['göt', 'piç', 'oç']);

/** Metni sözcüklere böler; tek harflik parçalar (s.i.k, f u c k) birleştirilir. */
function tokens(text) {
  const raw = String(text)
    .split(/[^\p{L}\p{N}@$!€*]+/u)
    .map((t) => t.replace(/!+$/, ''))
    .filter(Boolean);
  const out = [];
  let run = '';
  for (const t of raw) {
    if ([...t].length === 1) run += t;
    else {
      if (run.length > 1) out.push(run);
      run = '';
      out.push(t);
    }
  }
  if (run.length > 1) out.push(run);
  return out;
}

function matches(word) {
  // Yıldızla gizlenen harf (f*ck, s*ktir): her ünlüyle denenir
  if (word.includes('*')) return [...'aeiouı'].some((c) => matches(word.replaceAll('*', c)));
  const lower = word.toLocaleLowerCase('tr').replace(/(.)\1+/g, '$1');
  if (RAW_EXACT.has(lower)) return true;
  for (const r of COMPILED) {
    const w = normalizeWord(word, r.dotted);
    if (r.exact.has(w)) return true;
    if (r.part.some((p) => w.includes(p))) return true;
    if (r.prefix.some((p) => w.startsWith(p)) && !r.exceptExact.has(w) && !r.except.some((e) => w.startsWith(e))) return true;
  }
  return false;
}

/** Metinde uygunsuz ifade var mı? */
export function isOffensive(text) {
  if (!text) return false;
  const list = tokens(text);
  if (list.some(matches)) return true;
  // Ayrı yazılan uzun kalıplar (amına koyim): yan yana iki sözcük birlikte de denenir
  return list.slice(1).some((t, i) => {
    const w = normalizeWord(list[i] + t, false);
    return LONG_PREFIXES.some((p) => w.startsWith(p));
  });
}

/*
 * Fotoğraf denetimi (Sightengine, ayda 2000 fotoğrafa kadar ücretsiz).
 * SIGHTENGINE_USER / SIGHTENGINE_SECRET yoksa denetim atlanır. Servis hata verirse fotoğraf kabul edilir
 * (site çalışmaya devam etsin diye) ve sunucu günlüğüne yazılır.
 */
const NUDITY_LIMIT = 0.5;

/** Çıplaklık / cinsel içerik varsa true döner. */
export async function isExplicitImage(buffer) {
  const { user, secret } = config.sightengine;
  if (!user || !secret) return false;
  try {
    const form = new FormData();
    form.append('media', new Blob([buffer]), 'image');
    form.append('models', 'nudity-2.1');
    form.append('api_user', user);
    form.append('api_secret', secret);
    const res = await fetch('https://api.sightengine.com/1.0/check.json', { method: 'POST', body: form, signal: AbortSignal.timeout(10000) });
    const data = await res.json();
    if (data.status !== 'success') throw new Error(data.error?.message || `HTTP ${res.status}`);
    const n = data.nudity || {};
    return [n.sexual_activity, n.sexual_display, n.erotica].some((score) => (score || 0) >= NUDITY_LIMIT);
  } catch (err) {
    console.warn('Fotoğraf denetimi yapılamadı:', err.message);
    return false;
  }
}
