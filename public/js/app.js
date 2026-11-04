(() => {
'use strict';

// ============================================================ utilitaires
const $app = document.getElementById('app');
const $nav = document.getElementById('nav');

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

// replaceChildren() transforme null en texte « null » : on filtre les valeurs vides avant.
const fill = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter(k => k != null && k !== false));

async function api(path, method = 'GET', body) {
  const opt = { method, credentials: 'same-origin', headers: { 'x-requested-with': 'craftstor' } };
  if (body !== undefined) { opt.headers['content-type'] = 'application/json'; opt.body = JSON.stringify(body); }
  let res;
  try { res = await fetch('/api' + path, opt); } catch { throw new Error('Impossible de joindre le serveur.'); }
  let data = {};
  try { data = await res.json(); } catch { /* vide */ }
  if (!res.ok) throw new Error(data.error || 'Erreur ' + res.status);
  return data;
}

function toast(msg, isErr) {
  const t = h('div', { class: 'toast' + (isErr ? ' err' : '') }, msg);
  document.getElementById('toasts').append(t);
  setTimeout(() => t.remove(), isErr ? 6000 : 3500);
}
const guard = fn => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message, true); } };

const dia = () => h('img', { class: 'inline-dia', src: 'img/diamond.png', alt: 'diamants' });
const fmtDate = ts => new Date(ts).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const DIM_LABEL = { overworld: 'Overworld', nether: 'Nether', end: 'End' };

const CATS = [
  ['all', 'Tout'], ['blocs', 'Blocs'], ['ressources', 'Ressources'], ['armures', 'Armures'], ['armes', 'Armes'],
  ['outils', 'Outils'], ['livres', 'Livres enchantés'], ['nourriture', 'Nourriture'], ['redstone', 'Redstone'],
  ['divers', 'Divers'], ['services', 'Services']
];
const catLabel = c => (CATS.find(x => x[0] === c) || [0, c])[1];

// ============================================================ état
const S = { user: null, items: [], map: new Map(), globalDiscount: 0, cart: [], code: null };
try { S.cart = JSON.parse(localStorage.getItem('cs-cart') || '[]'); if (!Array.isArray(S.cart)) S.cart = []; } catch { S.cart = []; }
const saveCart = () => { try { localStorage.setItem('cs-cart', JSON.stringify(S.cart)); } catch { /* ignoré */ } };
const cartCount = () => S.cart.reduce((n, l) => n + l.qty, 0);

async function loadCatalog() {
  const d = await api('/catalog');
  S.items = d.items; S.map = new Map(d.items.map(i => [i.id, i])); S.globalDiscount = d.globalDiscount;
  S.cart = S.cart.filter(l => S.map.has(l.id));
  saveCart();
  const b = document.getElementById('sale-banner');
  b.hidden = !S.globalDiscount;
  b.textContent = S.globalDiscount ? `🔥 Promotion en cours : −${S.globalDiscount} % sur tout le catalogue !` : '';
}
async function loadMe() { S.user = (await api('/me')).user; }

// ============================================================ navigation
function renderNav() {
  const route = location.hash.split('/')[1] || '';
  const a = (href, label, key) => h('a', { href, class: route === key ? 'active' : '' }, label);
  fill($nav,
    a('#/', 'Catalogue', ''),
    a('#/cart', ['Panier', cartCount() ? h('span', { class: 'badge-count' }, cartCount()) : null], 'cart'),
    ...(S.user ? [
      S.user.isAdmin ? a('#/admin/orders', 'Admin', 'admin') : null,
      a('#/account/orders', S.user.mcName, 'account'),
      h('span', { class: 'balance', title: 'Votre solde' }, dia(), S.user.diamonds),
      h('button', { onclick: guard(async () => { await api('/logout', 'POST'); S.user = null; S.code = null; location.hash = '#/'; renderNav(); route_(); }) }, 'Déconnexion')
    ] : [a('#/login', 'Connexion', 'login'), a('#/register', 'Créer un compte', 'register')])
  );
}

const routes = {
  '': viewCatalog, cart: viewCart, login: viewLogin, register: viewRegister, account: viewAccount, admin: viewAdmin
};
function route_() {
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  const fn = routes[parts[0]] || viewCatalog;
  renderNav();
  window.scrollTo(0, 0);
  Promise.resolve(fn(parts.slice(1))).catch(e => { $app.replaceChildren(h('div', { class: 'panel' }, h('p', { class: 'msg-err' }, e.message))); });
}
window.addEventListener('hashchange', route_);

const needLogin = () => {
  $app.replaceChildren(h('div', { class: 'panel authbox' }, h('h2', {}, 'Connexion requise'), h('p', {}, 'Connectez-vous pour accéder à cette page.'), h('a', { class: 'btn', href: '#/login' }, 'Se connecter')));
};

// ============================================================ catalogue
const catalogState = { q: '', cat: 'all', page: 1, favOnly: false };
const PER_PAGE = 60;

function unitLabel(it) {
  if (it.unit === 'stack') return it.stackSize === 64 ? 'le stack (64)' : `le stack (${it.stackSize})`;
  if (it.unit === 'service') return 'le service';
  return 'la pièce';
}

function priceTag(it) {
  return h('div', { class: 'price' },
    it.discount > 0 && it.finalPrice !== it.price ? h('s', {}, it.price) : null,
    it.finalPrice, ' ', dia(),
    h('span', { class: 'unit' }, unitLabel(it)));
}

function addToCart(id, qty) {
  qty = Math.max(1, Math.min(1000, Math.floor(Number(qty) || 1)));
  const line = S.cart.find(l => l.id === id && !l.hole);
  if (line) line.qty = Math.min(1000, line.qty + qty); else S.cart.push({ id, qty });
  saveCart(); renderNav();
  toast(`Ajouté au panier : ${S.map.get(id).name} × ${qty}`);
}

function openHoleDialog(it) {
  const x = h('input', { type: 'number', step: '1', required: true, placeholder: 'ex : 120' });
  const z = h('input', { type: 'number', step: '1', required: true, placeholder: 'ex : -340' });
  const dim = h('select', {}, ...Object.entries(DIM_LABEL).map(([v, l]) => h('option', { value: v }, l)));
  const note = h('textarea', { rows: 2, maxlength: 200, placeholder: 'Précisions (facultatif)' });
  const err = h('div', { class: 'msg-err' });
  const dlg = h('dialog', {},
    h('h2', {}, 'Commander un trou profond'),
    h('p', { class: 'muted' }, 'Indiquez les coordonnées exactes. Prix : ', it.finalPrice, ' ', dia(), ' par trou.'),
    h('div', { class: 'row' },
      h('div', { class: 'field' }, h('label', {}, 'X'), x),
      h('div', { class: 'field' }, h('label', {}, 'Z'), z),
      h('div', { class: 'field' }, h('label', {}, 'Dimension'), dim)),
    h('div', { class: 'field' }, h('label', {}, 'Note'), note),
    err,
    h('div', { class: 'row between' },
      h('button', { class: 'btn secondary', type: 'button', onclick: () => dlg.close() }, 'Annuler'),
      h('button', { class: 'btn', type: 'button', onclick: () => {
        const xv = Number(x.value), zv = Number(z.value);
        if (x.value === '' || z.value === '' || !Number.isInteger(xv) || !Number.isInteger(zv)) { err.textContent = 'X et Z doivent être des nombres entiers.'; return; }
        S.cart.push({ id: it.id, qty: 1, hole: { x: xv, z: zv, dim: dim.value, note: note.value.trim() } });
        saveCart(); renderNav(); dlg.close(); toast('Trou ajouté au panier.');
      } }, 'Ajouter au panier')));
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg); dlg.showModal();
}

function itemCard(it) {
  const qty = h('input', { type: 'number', min: '1', max: '1000', value: '1', 'aria-label': 'Quantité' });
  const isFav = S.user && S.user.favorites.includes(it.id);
  return h('article', { class: 'card' },
    it.discount > 0 ? h('span', { class: 'tag-sale' }, `−${it.discount}%`) : null,
    S.user ? h('button', { class: 'fav' + (isFav ? ' on' : ''), title: isFav ? 'Retirer des favoris' : 'Ajouter aux favoris', 'aria-label': 'Favori', onclick: guard(async e => {
      const d = await api('/favorites/' + encodeURIComponent(it.id), 'POST');
      S.user.favorites = d.favorites;
      if (catalogState.favOnly) renderCatalogBody(); else { e.target.classList.toggle('on'); e.target.textContent = e.target.classList.contains('on') ? '♥' : '♡'; }
    }) }, isFav ? '♥' : '♡') : null,
    h('div', { class: 'pic' }, h('img', { src: it.img, alt: '', loading: 'lazy', width: 48, height: 48 })),
    h('h3', {}, it.name),
    priceTag(it),
    it.service === 'deep_hole'
      ? h('button', { class: 'btn', onclick: () => openHoleDialog(it) }, 'Commander')
      : h('div', { class: 'buy' }, qty, h('button', { class: 'btn', onclick: () => addToCart(it.id, qty.value) }, 'Ajouter')));
}

function filteredItems() {
  const q = norm(catalogState.q.trim());
  return S.items.filter(i =>
    (catalogState.cat === 'all' || i.cat === catalogState.cat) &&
    (!catalogState.favOnly || (S.user && S.user.favorites.includes(i.id))) &&
    (!q || norm(i.name).includes(q) || i.id.includes(q.replace(/ /g, '_'))));
}

let $catBody;
function renderCatalogBody() {
  const list = filteredItems();
  const pages = Math.max(1, Math.ceil(list.length / PER_PAGE));
  if (catalogState.page > pages) catalogState.page = pages;
  const slice = list.slice((catalogState.page - 1) * PER_PAGE, catalogState.page * PER_PAGE);
  $catBody.replaceChildren(
    h('p', { class: 'muted small' }, `${list.length} article${list.length > 1 ? 's' : ''}`),
    slice.length ? h('div', { class: 'grid' }, slice.map(itemCard)) : h('div', { class: 'panel' }, 'Aucun article ne correspond à votre recherche.'),
    pager(catalogState.page, pages, p => { catalogState.page = p; renderCatalogBody(); window.scrollTo(0, 0); }));
}

function pager(page, pages, onChange) {
  if (pages <= 1) return h('div');
  return h('div', { class: 'pager' },
    h('button', { class: 'btn secondary small', disabled: page <= 1, onclick: () => onChange(page - 1) }, '← Précédent'),
    h('span', {}, `Page ${page} / ${pages}`),
    h('button', { class: 'btn secondary small', disabled: page >= pages, onclick: () => onChange(page + 1) }, 'Suivant →'));
}

async function viewCatalog() {
  await loadCatalog();
  const search = h('input', { type: 'search', placeholder: 'Rechercher un item ou un bloc…', value: catalogState.q, 'aria-label': 'Recherche', oninput: e => { catalogState.q = e.target.value; catalogState.page = 1; renderCatalogBody(); } });
  const chips = h('div', { class: 'chips' });
  const drawChips = () => fill(chips,
    ...CATS.map(([k, l]) => h('button', { class: 'chip' + (catalogState.cat === k && !catalogState.favOnly ? ' on' : ''), onclick: () => { catalogState.cat = k; catalogState.favOnly = false; catalogState.page = 1; drawChips(); renderCatalogBody(); } }, l)),
    S.user ? h('button', { class: 'chip' + (catalogState.favOnly ? ' on' : ''), onclick: () => { catalogState.favOnly = !catalogState.favOnly; catalogState.page = 1; drawChips(); renderCatalogBody(); } }, '♥ Mes favoris') : null);
  drawChips();
  $catBody = h('div');
  $app.replaceChildren(
    h('div', { class: 'row between' }, h('h1', {}, 'Catalogue'), S.user ? null : h('span', { class: 'muted small' }, 'Le catalogue est visible par tous · connexion nécessaire pour commander')),
    h('div', { class: 'toolbar' }, search), chips, $catBody);
  renderCatalogBody();
}

// ============================================================ panier
function totals(codePercent) {
  const subtotal = S.cart.reduce((n, l) => n + S.map.get(l.id).finalPrice * l.qty, 0);
  const total = subtotal <= 0 ? 0 : Math.max(1, Math.ceil(subtotal * (1 - (codePercent || 0) / 100)));
  return { subtotal, total };
}

async function viewCart() {
  await loadCatalog();
  const draw = () => {
    if (!S.cart.length) { $app.replaceChildren(h('h1', {}, 'Panier'), h('div', { class: 'panel' }, h('p', {}, 'Votre panier est vide.'), h('a', { class: 'btn', href: '#/' }, 'Voir le catalogue'))); return; }
    const pct = S.code ? S.code.percent : 0;
    const { subtotal, total } = totals(pct);
    const code = h('input', { type: 'text', placeholder: 'Code de réduction', maxlength: 40, value: S.code ? S.code.code : '', style: 'max-width:220px' });
    const rows = S.cart.map((l, idx) => {
      const it = S.map.get(l.id);
      return h('tr', {},
        h('td', {}, h('img', { class: 'thumb', src: it.img, alt: '' }), it.name,
          l.hole ? h('div', { class: 'muted small' }, `X ${l.hole.x} · Z ${l.hole.z} · ${DIM_LABEL[l.hole.dim]}${l.hole.note ? ' · ' + l.hole.note : ''}`) : null,
          h('div', { class: 'muted small' }, it.finalPrice, ' ', dia(), ' ', unitLabel(it))),
        h('td', {}, l.hole ? '1' : h('input', { type: 'number', min: '1', max: '1000', value: l.qty, 'aria-label': 'Quantité', onchange: e => { l.qty = Math.max(1, Math.min(1000, Math.floor(Number(e.target.value) || 1))); saveCart(); renderNav(); draw(); } })),
        h('td', {}, it.finalPrice * l.qty, ' ', dia()),
        h('td', {}, h('button', { class: 'btn danger small', onclick: () => { S.cart.splice(idx, 1); saveCart(); renderNav(); draw(); } }, 'Retirer')));
    });
    $app.replaceChildren(
      h('h1', {}, 'Panier'),
      h('div', { class: 'panel tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Article', 'Quantité', 'Total', ''].map(t => h('th', {}, t)))), h('tbody', {}, rows))),
      h('div', { class: 'panel stack', style: 'margin-top:1rem' },
        h('div', { class: 'row' }, code,
          h('button', { class: 'btn secondary', onclick: guard(async () => {
            if (!S.user) throw new Error('Connectez-vous pour utiliser un code.');
            if (!code.value.trim()) { S.code = null; draw(); return; }
            S.code = await api('/codes/check', 'POST', { code: code.value }); toast(`Code appliqué : −${S.code.percent} %`); draw();
          }) }, 'Appliquer')),
        h('div', {}, h('div', {}, 'Sous-total : ', subtotal, ' ', dia()),
          pct ? h('div', { class: 'muted' }, `Code ${S.code.code} : −${pct} %`) : null,
          h('div', { class: 'order' }, h('span', { class: 'total' }, 'Total : ', total, ' ', dia()))),
        S.user
          ? h('div', { class: 'row' },
              h('span', { class: 'muted' }, 'Votre solde : ', S.user.diamonds, ' ', dia()),
              h('button', { class: 'btn', onclick: guard(async e => {
                e.target.disabled = true;
                try {
                  const d = await api('/orders', 'POST', { lines: S.cart.map(l => ({ id: l.id, qty: l.qty, hole: l.hole })), code: S.code ? S.code.code : undefined });
                  S.cart = []; S.code = null; saveCart(); renderNav();
                  toast(`Commande ${d.order.id} enregistrée.`); location.hash = '#/account/orders';
                } finally { e.target.disabled = false; }
              }) }, 'Passer la commande'))
          : h('div', { class: 'callout' }, 'Il faut être connecté pour commander. ', h('a', { href: '#/login' }, 'Se connecter'), ' ou ', h('a', { href: '#/register' }, 'créer un compte'), '.')));
  };
  draw();
}

// ============================================================ connexion / inscription
function viewLogin() {
  if (S.user) { location.hash = '#/account/orders'; return; }
  const id = h('input', { type: 'text', autocomplete: 'username', required: true });
  const pw = h('input', { type: 'password', autocomplete: 'current-password', required: true });
  const err = h('div', { class: 'msg-err' });
  const form = h('form', { class: 'panel authbox', onsubmit: async e => {
    e.preventDefault(); err.textContent = '';
    try { S.user = (await api('/login', 'POST', { id: id.value, password: pw.value })).user; location.hash = '#/'; route_(); } catch (x) { err.textContent = x.message; }
  } },
    h('h2', {}, 'Connexion'),
    h('div', { class: 'field' }, h('label', {}, 'Pseudo Minecraft ou e-mail'), id),
    h('div', { class: 'field' }, h('label', {}, 'Mot de passe'), pw),
    err, h('button', { class: 'btn', type: 'submit' }, 'Se connecter'),
    h('p', { class: 'muted small' }, 'Pas de compte ? ', h('a', { href: '#/register' }, 'Créer un compte')));
  $app.replaceChildren(form);
}

function viewRegister() {
  if (S.user) { location.hash = '#/account/orders'; return; }
  const f = {
    mc: h('input', { type: 'text', maxlength: 16, required: true, autocomplete: 'username' }),
    dc: h('input', { type: 'text', maxlength: 32, required: true }),
    em: h('input', { type: 'email', required: true, autocomplete: 'email' }),
    p1: h('input', { type: 'password', minlength: 8, required: true, autocomplete: 'new-password' }),
    p2: h('input', { type: 'password', minlength: 8, required: true, autocomplete: 'new-password' })
  };
  const err = h('div', { class: 'msg-err' });
  const field = (label, el, hint) => h('div', { class: 'field' }, h('label', {}, label), el, hint ? h('div', { class: 'hint' }, hint) : null);
  $app.replaceChildren(h('form', { class: 'panel authbox', onsubmit: async e => {
    e.preventDefault(); err.textContent = '';
    if (f.p1.value !== f.p2.value) { err.textContent = 'Les deux mots de passe ne correspondent pas.'; return; }
    try {
      S.user = (await api('/register', 'POST', { mcName: f.mc.value, discord: f.dc.value, email: f.em.value, password: f.p1.value, password2: f.p2.value })).user;
      toast('Compte créé, bienvenue !'); location.hash = '#/'; route_();
    } catch (x) { err.textContent = x.message; }
  } },
    h('h2', {}, 'Créer un compte'),
    field('Pseudo Minecraft', f.mc, '3 à 16 caractères : lettres, chiffres, _'),
    field('Pseudo Discord', f.dc),
    field('Adresse e-mail', f.em),
    field('Mot de passe', f.p1, '8 caractères minimum'),
    field('Confirmer le mot de passe', f.p2),
    err, h('button', { class: 'btn', type: 'submit' }, 'Créer mon compte'),
    h('p', { class: 'muted small' }, 'Déjà inscrit ? ', h('a', { href: '#/login' }, 'Se connecter'))));
}

// ============================================================ commandes (affichage commun)
const STATUS = {
  pending: ['pending', 'Commande en cours — règlement non effectué'],
  paid: ['paid', 'Réglée'],
  cancelled: ['cancelled', 'Annulée']
};
function orderCard(o, actions) {
  const [cls, label] = STATUS[o.status] || ['pending', o.status];
  return h('div', { class: 'order' },
    h('div', { class: 'row between' }, h('strong', {}, o.id), h('span', { class: 'status ' + cls }, label)),
    h('div', { class: 'muted small' }, fmtDate(o.createdAt), actions ? ` · ${o.mcName} (Discord : ${o.discord})` : ''),
    h('ul', {}, o.lines.map(l => h('li', {},
      `${l.name} × ${l.qty}`, l.unit === 'stack' ? ` stack${l.qty > 1 ? 's' : ''}` : '',
      l.hole ? ` — X ${l.hole.x}, Z ${l.hole.z}, ${DIM_LABEL[l.hole.dim] || l.hole.dim}${l.hole.note ? ' (' + l.hole.note + ')' : ''}` : '',
      h('span', { class: 'muted' }, ` · ${l.unitPrice * l.qty} 💎`)))),
    o.code ? h('div', { class: 'muted small' }, `Code ${o.code} : −${o.codePercent} % (sous-total ${o.subtotal} 💎)`) : null,
    h('div', { class: 'total' }, 'Total : ', o.total, ' ', dia()),
    o.paidAt ? h('div', { class: 'muted small' }, 'Réglée le ' + fmtDate(o.paidAt)) : null,
    actions || null);
}

// ============================================================ espace membre
async function viewAccount([tab = 'orders']) {
  if (!S.user) return needLogin();
  await loadMe(); await loadCatalog(); renderNav();
  const tabs = [['orders', 'Mes commandes'], ['favorites', 'Mes favoris'], ['profile', 'Mon compte']];
  const body = h('div');
  $app.replaceChildren(
    h('div', { class: 'row between' }, h('h1', {}, 'Mon espace')),
    h('div', { class: 'stats', style: 'margin-bottom:1rem' },
      h('div', { class: 'stat' }, h('span', { class: 'muted' }, 'Solde'), h('b', {}, S.user.diamonds, ' ', dia())),
      h('div', { class: 'stat' }, h('span', { class: 'muted' }, 'Favoris'), h('b', {}, S.user.favorites.filter(i => S.map.has(i)).length))),
    h('div', { class: 'callout', style: 'margin-bottom:1rem' }, 'Pour ajouter des diamants à votre compte, contactez ', h('strong', {}, 'Enoe'), '.'),
    h('nav', { class: 'tabs' }, tabs.map(([k, l]) => h('a', { href: '#/account/' + k, class: tab === k ? 'on' : '' }, l))), body);

  if (tab === 'orders') {
    const { orders } = await api('/orders');
    body.append(orders.length ? h('div', { class: 'stack' }, orders.map(o => orderCard(o))) : h('div', { class: 'panel' }, 'Vous n’avez pas encore passé de commande.'));
  } else if (tab === 'favorites') {
    const favs = S.user.favorites.map(id => S.map.get(id)).filter(Boolean);
    body.append(favs.length ? h('div', { class: 'grid' }, favs.map(itemCard)) : h('div', { class: 'panel' }, 'Aucun favori. Cliquez sur ♡ sur un article du catalogue.'));
  } else {
    const cur = h('input', { type: 'password', autocomplete: 'current-password' });
    const p1 = h('input', { type: 'password', autocomplete: 'new-password' });
    const p2 = h('input', { type: 'password', autocomplete: 'new-password' });
    body.append(
      h('div', { class: 'panel stack' },
        h('h2', {}, 'Informations'),
        h('div', {}, 'Pseudo Minecraft : ', h('strong', {}, S.user.mcName)),
        h('div', {}, 'Pseudo Discord : ', h('strong', {}, S.user.discord)),
        h('div', {}, 'E-mail : ', h('strong', {}, S.user.email))),
      h('form', { class: 'panel', style: 'margin-top:1rem;max-width:460px', onsubmit: guard(async e => {
        e.preventDefault();
        await api('/me/password', 'POST', { current: cur.value, password: p1.value, password2: p2.value });
        cur.value = p1.value = p2.value = ''; toast('Mot de passe modifié.');
      }) },
        h('h2', {}, 'Changer mon mot de passe'),
        h('div', { class: 'field' }, h('label', {}, 'Mot de passe actuel'), cur),
        h('div', { class: 'field' }, h('label', {}, 'Nouveau mot de passe'), p1),
        h('div', { class: 'field' }, h('label', {}, 'Confirmer'), p2),
        h('button', { class: 'btn', type: 'submit' }, 'Modifier')));
  }
}

// ============================================================ admin
const adminState = { orderFilter: 'pending', userQ: '', itemQ: '', itemCat: 'all', itemPage: 1 };

async function viewAdmin([tab = 'orders']) {
  if (!S.user || !S.user.isAdmin) return needLogin();
  const tabs = [['orders', 'Commandes'], ['users', 'Comptes'], ['items', 'Prix & réductions'], ['codes', 'Codes de remise']];
  const body = h('div');
  $app.replaceChildren(h('h1', {}, 'Tableau de bord administrateur'),
    h('nav', { class: 'tabs' }, tabs.map(([k, l]) => h('a', { href: '#/admin/' + k, class: tab === k ? 'on' : '' }, l))), body);
  if (tab === 'orders') await adminOrders(body);
  else if (tab === 'users') await adminUsers(body);
  else if (tab === 'items') await adminItems(body);
  else await adminCodes(body);
}

async function adminOrders(body) {
  const { orders } = await api('/admin/orders');
  const count = s => orders.filter(o => o.status === s).length;
  const draw = () => {
    const list = orders.filter(o => adminState.orderFilter === 'all' || o.status === adminState.orderFilter);
    body.replaceChildren(
      h('div', { class: 'stats', style: 'margin-bottom:1rem' },
        h('div', { class: 'stat' }, h('span', { class: 'muted' }, 'En attente de règlement'), h('b', {}, count('pending'))),
        h('div', { class: 'stat' }, h('span', { class: 'muted' }, 'Réglées'), h('b', {}, count('paid'))),
        h('div', { class: 'stat' }, h('span', { class: 'muted' }, 'Total commandes'), h('b', {}, orders.length))),
      h('div', { class: 'chips' }, [['pending', 'En attente'], ['paid', 'Réglées'], ['cancelled', 'Annulées'], ['all', 'Toutes']].map(([k, l]) =>
        h('button', { class: 'chip' + (adminState.orderFilter === k ? ' on' : ''), onclick: () => { adminState.orderFilter = k; draw(); } }, l))),
      list.length ? h('div', { class: 'stack' }, list.map(o => orderCard(o, o.status === 'pending' ? h('div', { class: 'row', style: 'margin-top:.6rem' },
        h('button', { class: 'btn small', onclick: guard(async () => {
          if (!confirm(`Accepter le règlement de ${o.mcName} (${o.total} diamants) ? Le solde du compte sera débité.`)) return;
          const d = await api(`/admin/orders/${o.id}/accept`, 'POST');
          Object.assign(o, d.order); toast(`Règlement accepté — nouveau solde de ${o.mcName} : ${d.user.diamonds} 💎`); draw();
        }) }, 'Accepter le règlement'),
        h('button', { class: 'btn danger small', onclick: guard(async () => {
          if (!confirm('Annuler cette commande ?')) return;
          Object.assign(o, (await api(`/admin/orders/${o.id}/cancel`, 'POST')).order); draw();
        }) }, 'Annuler')) : h('span')))) : h('div', { class: 'panel' }, 'Aucune commande dans cette catégorie.'));
  };
  draw();
}

async function adminUsers(body) {
  const { users } = await api('/admin/users');
  const list = h('div');
  const search = h('input', { type: 'search', placeholder: 'Rechercher un pseudo, Discord ou e-mail…', value: adminState.userQ, oninput: e => { adminState.userQ = e.target.value; draw(); } });
  const draw = () => {
    const q = norm(adminState.userQ);
    const rows = users.filter(u => !q || norm(`${u.mcName} ${u.discord} ${u.email}`).includes(q)).map(u => {
      const amt = h('input', { type: 'number', step: '1', placeholder: '±', 'aria-label': 'Diamants à ajouter ou retirer' });
      const bal = h('strong', {}, u.diamonds);
      const pw = h('input', { type: 'text', placeholder: 'nouveau mot de passe', minlength: 8, autocomplete: 'off', style: 'width:11rem' });
      return h('tr', {},
        h('td', {}, h('strong', {}, u.mcName), u.isAdmin ? ' (admin)' : '', h('div', { class: 'muted small' }, u.discord), h('div', { class: 'muted small' }, u.email)),
        h('td', {}, u.orders),
        h('td', {}, bal, ' ', dia()),
        h('td', {}, h('div', { class: 'row' }, amt, h('button', { class: 'btn small', onclick: guard(async () => {
          const delta = Number(amt.value);
          const d = await api(`/admin/users/${u.id}/diamonds`, 'POST', { delta });
          u.diamonds = d.diamonds; bal.textContent = d.diamonds; amt.value = '';
          if (u.id === S.user.id) { S.user.diamonds = d.diamonds; renderNav(); }
          toast(`${delta > 0 ? '+' : ''}${delta} 💎 pour ${u.mcName} — solde : ${d.diamonds}`);
        }) }, 'Appliquer'))),
        h('td', {}, h('div', { class: 'row' }, pw, h('button', { class: 'btn secondary small', onclick: guard(async () => {
          if (!confirm(`Définir ce nouveau mot de passe pour ${u.mcName} ?`)) return;
          await api(`/admin/users/${u.id}/password`, 'POST', { password: pw.value });
          pw.value = ''; toast(`Mot de passe de ${u.mcName} modifié. Communiquez-le au membre.`);
        }) }, 'Changer'))));
    });
    list.replaceChildren(h('div', { class: 'panel tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Membre', 'Commandes', 'Solde', 'Ajouter / retirer des diamants', 'Mot de passe'].map(t => h('th', {}, t)))), h('tbody', {}, rows))));
  };
  body.replaceChildren(
    h('div', { class: 'callout', style: 'margin-bottom:1rem' }, 'Les mots de passe sont chiffrés (hachés) : personne ne peut les lire, pas même vous. En cas d’oubli, définissez-en un nouveau ci-dessous et transmettez-le au membre.'),
    h('div', { class: 'toolbar' }, search), list);
  draw();
}

async function adminItems(body) {
  const data = await api('/admin/items');
  const items = data.items;
  const gd = h('input', { type: 'number', min: '0', max: '100', step: '1', value: data.globalDiscount });
  const tbl = h('div');
  const draw = () => {
    const q = norm(adminState.itemQ.trim());
    const list = items.filter(i => (adminState.itemCat === 'all' || i.cat === adminState.itemCat) && (!q || norm(i.name).includes(q) || i.id.includes(q.replace(/ /g, '_'))));
    const pages = Math.max(1, Math.ceil(list.length / 40));
    if (adminState.itemPage > pages) adminState.itemPage = pages;
    const slice = list.slice((adminState.itemPage - 1) * 40, adminState.itemPage * 40);
    const rows = slice.map(i => {
      const save = (field, el, parse) => guard(async () => {
        const v = parse(el);
        const d = await api('/admin/items/' + encodeURIComponent(i.id), 'POST', { [field]: v });
        i.price = d.item.price; i.itemDiscount = d.item.itemDiscount; i.hidden = d.item.hidden; toast(`${i.name} : enregistré`);
      });
      const price = h('input', { type: 'number', min: '0', step: '1', value: i.price });
      const disc = h('input', { type: 'number', min: '0', max: '100', step: '1', value: i.itemDiscount });
      const hid = h('input', { type: 'checkbox', checked: i.hidden });
      price.addEventListener('change', save('price', price, e => Number(e.value)));
      disc.addEventListener('change', save('discount', disc, e => Number(e.value)));
      hid.addEventListener('change', save('hidden', hid, e => e.checked));
      return h('tr', {},
        h('td', {}, h('img', { class: 'thumb', src: i.img, alt: '', loading: 'lazy' }), i.name, h('div', { class: 'muted small' }, catLabel(i.cat), ' · ', i.unit === 'stack' ? `par stack (${i.stackSize})` : i.unit === 'service' ? 'service' : 'à la pièce')),
        h('td', {}, price), h('td', {}, disc), h('td', {}, hid));
    });
    tbl.replaceChildren(
      h('p', { class: 'muted small' }, `${list.length} articles · les modifications sont enregistrées automatiquement`),
      h('div', { class: 'panel tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Article', 'Prix (💎)', 'Réduction (%)', 'Masqué'].map(t => h('th', {}, t)))), h('tbody', {}, rows))),
      pager(adminState.itemPage, pages, p => { adminState.itemPage = p; draw(); }));
  };
  // ---- import des prix par fichier .txt
  const report = h('div', { style: 'margin-top:.8rem' });
  const fileIn = h('input', { type: 'file', accept: '.txt,text/plain', 'aria-label': 'Fichier de prix (.txt)' });
  let pendingText = '';
  const MAXROWS = 150;
  const showReport = (d) => {
    const nodes = [];
    nodes.push(h('p', {}, h('strong', {}, d.applied ? '✅ Import appliqué : ' : 'Aperçu : '),
      `${d.valid} ligne${d.valid > 1 ? 's' : ''} valide${d.valid > 1 ? 's' : ''} (${d.changes.length} prix à modifier, ${d.unchanged} déjà identique${d.unchanged > 1 ? 's' : ''})`,
      d.errors.length ? `, ${d.errors.length} erreur${d.errors.length > 1 ? 's' : ''}` : '', '.'));
    if (d.changes.length) {
      nodes.push(h('div', { class: 'tablewrap' }, h('table', {},
        h('thead', {}, h('tr', {}, ['Ligne', 'Article', 'Ancien prix', 'Nouveau prix'].map(t => h('th', {}, t)))),
        h('tbody', {}, d.changes.slice(0, MAXROWS).map(r => h('tr', {},
          h('td', {}, r.line),
          h('td', {}, r.name, r.via === 'alias' ? h('div', { class: 'muted small' }, `« ${r.input} » interprété comme ${r.name}`) : null, h('div', { class: 'muted small' }, r.unit)),
          h('td', {}, r.oldPrice), h('td', {}, h('strong', {}, r.newPrice))))))));
      if (d.changes.length > MAXROWS) nodes.push(h('p', { class: 'muted small' }, `… et ${d.changes.length - MAXROWS} autres modifications non affichées.`));
    }
    if (d.errors.length) {
      nodes.push(h('p', { class: 'msg-err' }, 'Lignes ignorées :'));
      nodes.push(h('ul', {}, d.errors.slice(0, MAXROWS).map(e => h('li', {},
        h('code', {}, `ligne ${e.line}`), ' ', e.text ? h('span', { class: 'muted' }, `« ${e.text} » — `) : null, e.reason,
        e.suggestions && e.suggestions.length ? h('div', { class: 'muted small' }, 'Vouliez-vous dire : ', e.suggestions.join(', '), ' ?') : null))));
    }
    if (!d.applied && d.changes.length) {
      nodes.push(h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: guard(async () => {
          if (!confirm(`Modifier ${d.changes.length} prix ?${d.errors.length ? ` (${d.errors.length} ligne(s) en erreur seront ignorées.)` : ''}`)) return;
          const r = await api('/admin/prices/import', 'POST', { text: pendingText, apply: true });
          for (const c of r.changes) { const it = items.find(i => i.id === c.id); if (it) it.price = c.newPrice; }
          toast(`${r.changes.length} prix modifié${r.changes.length > 1 ? 's' : ''}.`);
          showReport(r); draw();
        }) }, `Appliquer ${d.changes.length} modification${d.changes.length > 1 ? 's' : ''}`),
        h('button', { class: 'btn secondary', onclick: () => { report.replaceChildren(); fileIn.value = ''; pendingText = ''; } }, 'Annuler')));
    } else if (!d.applied) {
      nodes.push(h('p', { class: 'muted' }, 'Rien à modifier.'));
    }
    fill(report, nodes);
  };
  fileIn.addEventListener('change', guard(async () => {
    const f = fileIn.files[0]; if (!f) return;
    if (f.size > 250 * 1024) { fileIn.value = ''; throw new Error('Fichier trop gros (250 Ko maximum).'); }
    pendingText = await f.text();
    showReport(await api('/admin/prices/import', 'POST', { text: pendingText, apply: false }));
  }));

  body.replaceChildren(
    h('div', { class: 'panel', style: 'margin-bottom:1rem' },
      h('h3', {}, 'Importer les prix depuis un fichier .txt'),
      h('p', { class: 'muted small' }, 'Une ligne par article : ', h('code', {}, 'NOM : PRIX'), ' (exemples : ', h('code', {}, 'iron_ingot : 4'), ', ', h('code', {}, 'Oak Log : 3'), ', ', h('code', {}, 'IRON : 4'), '). Le prix est celui d’un stack pour les articles empilables, sinon de la pièce. Les lignes vides et les commentaires (', h('code', {}, '# …'), ') sont ignorés. Vous verrez un aperçu avant que quoi que ce soit change.'),
      h('div', { class: 'row' },
        h('a', { class: 'btn secondary small', href: '/api/admin/prices/export', download: 'craft-stor-prix.txt' }, '⬇ Télécharger les prix actuels (modèle)'),
        fileIn),
      report),
    h('div', { class: 'panel', style: 'margin-bottom:1rem' },
      h('h3', {}, 'Réduction sur tout le catalogue'),
      h('div', { class: 'row' }, gd, '%', h('button', { class: 'btn', onclick: guard(async () => {
        const d = await api('/admin/settings', 'POST', { globalDiscount: Number(gd.value) });
        toast(d.globalDiscount ? `Promotion −${d.globalDiscount} % activée` : 'Promotion désactivée');
      }) }, 'Enregistrer')),
      h('div', { class: 'hint' }, '0 = aucune promotion. Si un article a sa propre réduction, c’est la plus forte des deux qui s’applique (elles ne se cumulent pas).')),
    h('div', { class: 'toolbar' },
      h('input', { type: 'search', placeholder: 'Rechercher un article…', value: adminState.itemQ, oninput: e => { adminState.itemQ = e.target.value; adminState.itemPage = 1; draw(); } }),
      h('select', { style: 'max-width:220px', onchange: e => { adminState.itemCat = e.target.value; adminState.itemPage = 1; draw(); } },
        ...CATS.map(([k, l]) => h('option', { value: k, selected: adminState.itemCat === k }, l)))),
    tbl);
  draw();
}

async function adminCodes(body) {
  let { codes } = await api('/admin/codes');
  const code = h('input', { type: 'text', placeholder: 'ex : BIENVENUE10', maxlength: 40, style: 'text-transform:uppercase' });
  const pct = h('input', { type: 'number', min: '1', max: '100', placeholder: '%', value: 10 });
  const max = h('input', { type: 'number', min: '0', placeholder: '0 = illimité', value: '' });
  const list = h('div');
  const draw = () => list.replaceChildren(codes.length ? h('div', { class: 'panel tablewrap' }, h('table', {},
    h('thead', {}, h('tr', {}, ['Code', 'Remise', 'Utilisations', 'État', ''].map(t => h('th', {}, t)))),
    h('tbody', {}, codes.map(c => h('tr', {},
      h('td', {}, h('strong', {}, c.code)), h('td', {}, `−${c.percent} %`), h('td', {}, c.maxUses ? `${c.uses} / ${c.maxUses}` : `${c.uses} (illimité)`),
      h('td', {}, c.active ? 'Actif' : 'Désactivé'),
      h('td', {}, h('div', { class: 'row' },
        h('button', { class: 'btn secondary small', onclick: guard(async () => { codes = (await api(`/admin/codes/${encodeURIComponent(c.code)}/toggle`, 'POST')).codes; draw(); }) }, c.active ? 'Désactiver' : 'Activer'),
        h('button', { class: 'btn danger small', onclick: guard(async () => { if (!confirm(`Supprimer le code ${c.code} ?`)) return; codes = (await api(`/admin/codes/${encodeURIComponent(c.code)}`, 'DELETE')).codes; draw(); }) }, 'Supprimer')))))))) : h('div', { class: 'panel' }, 'Aucun code pour le moment.'));
  body.replaceChildren(
    h('form', { class: 'panel', style: 'margin-bottom:1rem', onsubmit: guard(async e => {
      e.preventDefault();
      codes = (await api('/admin/codes', 'POST', { code: code.value, percent: Number(pct.value), maxUses: max.value === '' ? 0 : Number(max.value) })).codes;
      code.value = ''; toast('Code créé.'); draw();
    }) },
      h('h3', {}, 'Créer un code de remise'),
      h('div', { class: 'row' },
        h('div', {}, h('label', {}, 'Code'), code), h('div', {}, h('label', {}, 'Remise (%)'), pct), h('div', {}, h('label', {}, 'Utilisations max.'), max),
        h('button', { class: 'btn', type: 'submit', style: 'align-self:flex-end' }, 'Créer'))), list);
  draw();
}

// ============================================================ démarrage
(async () => {
  try { await Promise.all([loadMe(), loadCatalog()]); } catch (e) { toast(e.message, true); }
  route_();
})();
})();
