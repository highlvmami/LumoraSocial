import { api, avatar, h, nameWithBadge } from './common.js';

/* Arama sayfası: #/ara?q=...&t=kisiler|paylasimlar */

export function searchHref(q, tab = 'kisiler') {
  return `#/ara?${new URLSearchParams({ q, t: tab })}`;
}

export function showSearch(ctx, params) {
  const { main } = ctx;
  const q = (params.get('q') || '').trim();
  // #etiket aramalarında varsayılan sekme paylaşımlar
  const tab = params.get('t') || (q.startsWith('#') ? 'paylasimlar' : 'kisiler');

  const input = h('input', { type: 'search', name: 'q', value: q, placeholder: 'Kişi, paylaşım veya #etiket ara', autocomplete: 'off', maxlength: 80 });
  const form = h('form', { class: 'card search-box' }, input, h('button', { class: 'btn', type: 'submit' }, 'Ara'));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    location.hash = searchHref(input.value.trim(), tab);
  });

  const tabLink = (key, label) => h('a', { href: searchHref(q, key), class: tab === key ? 'active' : '' }, label);
  main.replaceChildren(
    h('div', { class: 'feed-header' }, h('h2', {}, 'Ara')),
    form,
    h('nav', { class: 'tabs feed-tabs' }, tabLink('kisiler', 'Kişiler'), tabLink('paylasimlar', 'Paylaşımlar'))
  );
  if (!q) {
    main.append(h('div', { class: 'card empty-state' }, 'Aramak istediğin kişinin adını, kullanıcı adını ya da paylaşımlardaki bir kelimeyi yaz.'));
    input.focus();
    return;
  }

  if (tab === 'paylasimlar') {
    ctx.renderPostList(main, (before) => api(`/search/posts?${new URLSearchParams({ q, ...(before && { before }) })}`), `"${q}" geçen bir paylaşım bulunamadı.`);
    return;
  }

  const list = h('section', { class: 'card panel' });
  main.append(list);
  api(`/search/users?${new URLSearchParams({ q })}`).then(({ users }) => {
    list.replaceChildren(
      ...(users.length
        ? users.map((u) =>
            h(
              'div',
              { class: 'list-row person' },
              avatar(u),
              h(
                'a',
                { class: 'grow person-info', href: `#/u/${encodeURIComponent(u.username)}` },
                h('b', {}, ...nameWithBadge(u), u.privateAccount ? ' · Gizli hesap' : ''),
                h('div', { class: 'muted small' }, `@${u.username} · ${u.followers} takipçi`),
                u.bio ? h('div', { class: 'small person-bio' }, u.bio) : null
              ),
              u.followStatus === 'self' ? null : ctx.followButton(u, u.followStatus, () => ctx.refreshMyStats())
            )
          )
        : [h('div', { class: 'empty-state' }, `"${q}" ile eşleşen kişi bulunamadı.`)])
    );
  });
}
