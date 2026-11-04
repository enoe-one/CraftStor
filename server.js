// craft-stor — boutique Minecraft payée en diamants
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');          // catalogue (versionné dans git)
const store = require('./store');                         // Postgres (DATABASE_URL) ou fichier JSON
const ADMIN_NAME = process.env.ADMIN_NAME || 'Enoe';

// ------------------------------------------------------------------ stockage (JSON, écriture atomique)
const catalog = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'catalog.json'), 'utf8'));
const catalogById = new Map(catalog.map(i => [i.id, i]));

const emptyDb = () => ({ users: [], orders: [], codes: [], overrides: {}, settings: { globalDiscount: 0 }, seq: { user: 0, order: 0 } });
const db = emptyDb(); // objet unique, remplacé « en place » (voir syncFromStore)

let saveTimer = null, dirty = false, inflight = 0;
function save() {
  dirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 50);
}
function saveNow() {
  clearTimeout(saveTimer); saveTimer = null; dirty = false;
  inflight++;
  return store.write(db).finally(() => { inflight--; });
}
async function shutdown() {
  if (dirty) await saveNow(); // on n'écrit à l'arrêt que s'il y a quelque chose à sauvegarder
  await store.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Pendant un redéploiement, l'ancienne et la nouvelle version tournent en même temps sur la même base.
// Une instance dont les données sont périmées ne doit JAMAIS écraser celles de l'autre :
//  1) avant toute requête qui modifie quelque chose, on relit la base si une autre instance y a écrit ;
//  2) si, malgré tout, une écriture entre en conflit, l'instance s'arrête (et redémarre avec les données à jour).
store.onConflict(() => {
  console.error('CONFLIT : une autre instance du site a modifié la base. Cette instance s’arrête pour ne pas écraser ses données ; elle redémarre avec les données à jour.');
  process.exit(1);
});
let syncing = null;
async function syncFromStore() {
  if (!store.usesPostgres || dirty || saveTimer || inflight > 0) return; // des modifications locales sont en cours d'écriture
  if (syncing) return syncing;
  syncing = (async () => {
    if (!(await store.isStale())) return;
    const fresh = await store.load();
    for (const k of Object.keys(db)) delete db[k];
    Object.assign(db, emptyDb(), fresh || {});
    console.log('Données rechargées depuis la base (une autre instance y avait écrit).');
  })().finally(() => { syncing = null; });
  return syncing;
}

// ------------------------------------------------------------------ compte admin
async function ensureAdmin() {
  if (db.users.some(u => u.isAdmin)) return;
  const pwd = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  db.users.push({
    id: ++db.seq.user, mcName: ADMIN_NAME, discord: 'admin', email: 'admin@craft-stor.local',
    passHash: bcrypt.hashSync(pwd, 10), diamonds: 0, favorites: [], isAdmin: true, createdAt: Date.now()
  });
  await saveNow();
  console.log('\n==============================================================');
  console.log(' Compte administrateur créé');
  console.log('   pseudo   : ' + ADMIN_NAME);
  if (!process.env.ADMIN_PASSWORD) console.log('   mot de passe : ' + pwd + '   (notez-le, il ne sera plus affiché)');
  console.log(' Mot de passe perdu : node scripts/reset-admin.js');
  console.log('==============================================================\n');
}

// ------------------------------------------------------------------ prix
function effectiveItem(base) {
  const o = db.overrides[base.id] || {};
  const price = Number.isInteger(o.price) ? o.price : base.price;
  const hidden = typeof o.hidden === 'boolean' ? o.hidden : base.hidden;
  const itemDiscount = Number.isInteger(o.discount) ? o.discount : 0;
  const globalDiscount = db.settings.globalDiscount || 0;
  const discount = Math.max(itemDiscount, globalDiscount);
  const finalPrice = price <= 0 ? 0 : Math.max(1, Math.ceil(price * (1 - discount / 100)));
  return { ...base, price, hidden, discount, itemDiscount, finalPrice };
}

// ------------------------------------------------------------------ app
const app = express();
app.set('trust proxy', process.env.TRUST_PROXY ? 1 : 0);
app.disable('x-powered-by');
app.use(express.json({ limit: '300kb' })); // 300 Ko : assez pour importer le fichier de prix complet (~1 500 lignes)

// Les sessions sont en mémoire : le secret n'a pas besoin de survivre à un redémarrage.
const secret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
app.use(session({
  name: 'craftstor.sid', secret, resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: !!process.env.COOKIE_SECURE, maxAge: 1000 * 60 * 60 * 24 * 14 }
}));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'");
  next();
});

// Protection CSRF : toute requête qui modifie quelque chose doit porter un en-tête que seul notre JS envoie.
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD'].includes(req.method)) return next();
  if (req.get('x-requested-with') !== 'craftstor') return res.status(403).json({ error: 'Requête refusée.' });
  syncFromStore().then(() => next(), next); // données à jour avant toute modification
});

// Limiteur simple en mémoire
const hits = new Map();
function limit(key, max, windowMs) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter(t => now - t < windowMs);
  if (arr.length >= max) { hits.set(key, arr); return false; }
  arr.push(now); hits.set(key, arr); return true;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (!v.some(t => now - t < 3600e3)) hits.delete(k); }, 600e3).unref();

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const fail = (res, code, msg) => res.status(code).json({ error: msg });
const currentUser = req => db.users.find(u => u.id === req.session.uid) || null;
const requireUser = (req, res, next) => { const u = currentUser(req); if (!u) return fail(res, 401, 'Connexion requise.'); req.user = u; next(); };
const requireAdmin = (req, res, next) => { const u = currentUser(req); if (!u || !u.isAdmin) return fail(res, 403, 'Accès réservé à l’administrateur.'); req.user = u; next(); };
const publicUser = u => u && ({ id: u.id, mcName: u.mcName, discord: u.discord, email: u.email, diamonds: u.diamonds, favorites: u.favorites, isAdmin: !!u.isAdmin });

// ------------------------------------------------------------------ catalogue (public)
app.get('/api/catalog', (req, res) => {
  const items = catalog.map(effectiveItem).filter(i => !i.hidden).map(({ hidden, itemDiscount, ...rest }) => rest);
  res.json({ items, globalDiscount: db.settings.globalDiscount || 0 });
});

// ------------------------------------------------------------------ comptes
const MC_RE = /^[A-Za-z0-9_]{3,16}$/;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

app.post('/api/register', wrap(async (req, res) => {
  if (!limit('reg:' + req.ip, 10, 3600e3)) return fail(res, 429, 'Trop de tentatives, réessayez plus tard.');
  const mcName = str(req.body.mcName, 16), discord = str(req.body.discord, 32), email = str(req.body.email, 320).toLowerCase();
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const password2 = typeof req.body.password2 === 'string' ? req.body.password2 : '';
  if (!MC_RE.test(mcName)) return fail(res, 400, 'Pseudo Minecraft invalide (3 à 16 caractères : lettres, chiffres, _).');
  if (discord.length < 2) return fail(res, 400, 'Pseudo Discord requis.');
  if (!EMAIL_RE.test(email)) return fail(res, 400, 'Adresse e-mail invalide.');
  if (password.length < 8 || password.length > 128) return fail(res, 400, 'Le mot de passe doit faire au moins 8 caractères.');
  if (password !== password2) return fail(res, 400, 'Les deux mots de passe ne correspondent pas.');
  if (db.users.some(u => u.mcName.toLowerCase() === mcName.toLowerCase())) return fail(res, 409, 'Ce pseudo Minecraft a déjà un compte.');
  if (db.users.some(u => u.email === email)) return fail(res, 409, 'Cette adresse e-mail est déjà utilisée.');
  const user = {
    id: ++db.seq.user, mcName, discord, email, passHash: await bcrypt.hash(password, 10),
    diamonds: 0, favorites: [], isAdmin: false, createdAt: Date.now()
  };
  db.users.push(user); save();
  req.session.regenerate(err => {
    if (err) return fail(res, 500, 'Erreur de session.');
    req.session.uid = user.id;
    res.json({ user: publicUser(user) });
  });
}));

const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 10);
app.post('/api/login', wrap(async (req, res) => {
  const id = str(req.body.id, 320).toLowerCase();
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (!limit('login:' + req.ip, 15, 600e3) || !limit('loginid:' + id, 8, 600e3)) return fail(res, 429, 'Trop de tentatives, réessayez dans quelques minutes.');
  const user = db.users.find(u => u.mcName.toLowerCase() === id || u.email === id);
  const ok = await bcrypt.compare(password, user ? user.passHash : DUMMY_HASH);
  if (!user || !ok) return fail(res, 401, 'Identifiants incorrects.');
  req.session.regenerate(err => {
    if (err) return fail(res, 500, 'Erreur de session.');
    req.session.uid = user.id;
    res.json({ user: publicUser(user) });
  });
}));

app.post('/api/logout', (req, res) => req.session.destroy(() => { res.clearCookie('craftstor.sid'); res.json({ ok: true }); }));
app.get('/api/me', (req, res) => res.json({ user: publicUser(currentUser(req)) }));

app.post('/api/me/password', requireUser, wrap(async (req, res) => {
  const { current, password, password2 } = req.body || {};
  if (typeof current !== 'string' || typeof password !== 'string') return fail(res, 400, 'Champs manquants.');
  if (!(await bcrypt.compare(current, req.user.passHash))) return fail(res, 403, 'Mot de passe actuel incorrect.');
  if (password.length < 8 || password.length > 128) return fail(res, 400, 'Le nouveau mot de passe doit faire au moins 8 caractères.');
  if (password !== password2) return fail(res, 400, 'Les deux mots de passe ne correspondent pas.');
  req.user.passHash = await bcrypt.hash(password, 10); save();
  res.json({ ok: true });
}));

// ------------------------------------------------------------------ favoris
app.post('/api/favorites/:id', requireUser, (req, res) => {
  const id = req.params.id;
  if (!catalogById.has(id)) return fail(res, 404, 'Item inconnu.');
  const i = req.user.favorites.indexOf(id);
  if (i >= 0) req.user.favorites.splice(i, 1); else req.user.favorites.push(id);
  save();
  res.json({ favorites: req.user.favorites });
});

// ------------------------------------------------------------------ commandes
function findCode(raw) {
  const c = str(raw, 40).toUpperCase();
  if (!c) return null;
  return db.codes.find(x => x.code === c) || null;
}
function codeProblem(c) {
  if (!c || !c.active) return 'Code invalide.';
  if (c.maxUses > 0 && c.uses >= c.maxUses) return 'Ce code a atteint sa limite d’utilisation.';
  return null;
}

app.post('/api/codes/check', requireUser, (req, res) => {
  const c = findCode(req.body.code);
  const p = codeProblem(c);
  if (p) return fail(res, 400, p);
  res.json({ code: c.code, percent: c.percent });
});

const DIMS = ['overworld', 'nether', 'end'];
app.post('/api/orders', requireUser, (req, res) => {
  const lines = Array.isArray(req.body.lines) ? req.body.lines : [];
  if (!lines.length) return fail(res, 400, 'Votre panier est vide.');
  if (lines.length > 100) return fail(res, 400, 'Trop de lignes dans la commande (100 maximum).');
  const out = [];
  let subtotal = 0;
  for (const l of lines) {
    const base = catalogById.get(l && l.id);
    if (!base) return fail(res, 400, 'Un item de votre panier n’existe pas.');
    const it = effectiveItem(base);
    if (it.hidden) return fail(res, 400, `« ${it.name} » n’est plus disponible.`);
    const qty = Number(l.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 1000) return fail(res, 400, `Quantité invalide pour « ${it.name} ».`);
    const line = { id: it.id, name: it.name, qty, unit: it.unit, stackSize: it.stackSize, unitPrice: it.finalPrice };
    if (it.service === 'deep_hole') {
      const h = l.hole || {};
      const x = Number(h.x), z = Number(h.z);
      if (!Number.isInteger(x) || !Number.isInteger(z) || Math.abs(x) > 30000000 || Math.abs(z) > 30000000) return fail(res, 400, 'Coordonnées X et Z du trou invalides (nombres entiers).');
      if (!DIMS.includes(h.dim)) return fail(res, 400, 'Dimension du trou invalide.');
      line.qty = 1;
      line.hole = { x, z, dim: h.dim, note: str(h.note, 200) };
    }
    subtotal += line.unitPrice * line.qty;
    out.push(line);
  }
  let code = null, percent = 0;
  if (req.body.code) {
    const c = findCode(req.body.code);
    const p = codeProblem(c);
    if (p) return fail(res, 400, p);
    code = c.code; percent = c.percent; c.uses++;
  }
  const total = subtotal <= 0 ? 0 : Math.max(1, Math.ceil(subtotal * (1 - percent / 100)));
  const order = {
    id: 'CS-' + String(++db.seq.order).padStart(4, '0'),
    userId: req.user.id, mcName: req.user.mcName, discord: req.user.discord,
    lines: out, subtotal, code, codePercent: percent, total,
    status: 'pending', createdAt: Date.now(), paidAt: null
  };
  db.orders.push(order); save();
  res.json({ order });
});

app.get('/api/orders', requireUser, (req, res) => {
  res.json({ orders: db.orders.filter(o => o.userId === req.user.id).sort((a, b) => b.createdAt - a.createdAt) });
});

// ------------------------------------------------------------------ admin
app.get('/api/admin/orders', requireAdmin, (req, res) => res.json({ orders: [...db.orders].sort((a, b) => b.createdAt - a.createdAt) }));

app.post('/api/admin/orders/:id/accept', requireAdmin, (req, res) => {
  const o = db.orders.find(x => x.id === req.params.id);
  if (!o) return fail(res, 404, 'Commande introuvable.');
  if (o.status !== 'pending') return fail(res, 409, 'Cette commande n’est plus en attente.');
  const u = db.users.find(x => x.id === o.userId);
  if (!u) return fail(res, 404, 'Compte du client introuvable.');
  if (u.diamonds < o.total) return fail(res, 409, `Solde insuffisant : ${u.mcName} a ${u.diamonds} 💎, la commande en coûte ${o.total}.`);
  u.diamonds -= o.total; o.status = 'paid'; o.paidAt = Date.now(); save();
  res.json({ order: o, user: { id: u.id, diamonds: u.diamonds } });
});

app.post('/api/admin/orders/:id/cancel', requireAdmin, (req, res) => {
  const o = db.orders.find(x => x.id === req.params.id);
  if (!o) return fail(res, 404, 'Commande introuvable.');
  if (o.status !== 'pending') return fail(res, 409, 'Seule une commande en attente peut être annulée.');
  o.status = 'cancelled';
  if (o.code) { const c = db.codes.find(x => x.code === o.code); if (c && c.uses > 0) c.uses--; }
  save();
  res.json({ order: o });
});

app.get('/api/admin/users', requireAdmin, (req, res) => {
  res.json({ users: db.users.map(u => ({ ...publicUser(u), createdAt: u.createdAt, orders: db.orders.filter(o => o.userId === u.id).length })) });
});

app.post('/api/admin/users/:id/diamonds', requireAdmin, (req, res) => {
  const u = db.users.find(x => x.id === Number(req.params.id));
  if (!u) return fail(res, 404, 'Compte introuvable.');
  const delta = Number(req.body.delta);
  if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 1e6) return fail(res, 400, 'Quantité de diamants invalide.');
  if (u.diamonds + delta < 0) return fail(res, 400, 'Le solde ne peut pas devenir négatif.');
  u.diamonds += delta; save();
  res.json({ id: u.id, diamonds: u.diamonds });
});

// Les mots de passe sont hachés (bcrypt) : personne, admin compris, ne peut les lire. L'admin peut en définir un nouveau.
app.post('/api/admin/users/:id/password', requireAdmin, wrap(async (req, res) => {
  const u = db.users.find(x => x.id === Number(req.params.id));
  if (!u) return fail(res, 404, 'Compte introuvable.');
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (password.length < 8 || password.length > 128) return fail(res, 400, 'Le mot de passe doit faire au moins 8 caractères.');
  u.passHash = await bcrypt.hash(password, 10); save();
  res.json({ ok: true });
}));

app.get('/api/admin/items', requireAdmin, (req, res) => {
  res.json({ items: catalog.map(i => { const e = effectiveItem(i); return { id: e.id, name: e.name, cat: e.cat, unit: e.unit, stackSize: e.stackSize, img: e.img, basePrice: i.price, price: e.price, itemDiscount: e.itemDiscount, hidden: e.hidden, defaultHidden: i.hidden }; }), globalDiscount: db.settings.globalDiscount || 0 });
});

app.post('/api/admin/items/:id', requireAdmin, (req, res) => {
  const base = catalogById.get(req.params.id);
  if (!base) return fail(res, 404, 'Item inconnu.');
  const o = db.overrides[base.id] || (db.overrides[base.id] = {});
  const b = req.body || {};
  if ('price' in b) {
    const p = Number(b.price);
    if (!Number.isInteger(p) || p < 0 || p > 100000) return fail(res, 400, 'Prix invalide (entier ≥ 0).');
    if (p === base.price) delete o.price; else o.price = p;
  }
  if ('discount' in b) {
    const d = Number(b.discount);
    if (!Number.isInteger(d) || d < 0 || d > 100) return fail(res, 400, 'Réduction invalide (0 à 100 %).');
    if (d === 0) delete o.discount; else o.discount = d;
  }
  if ('hidden' in b) {
    if (typeof b.hidden !== 'boolean') return fail(res, 400, 'Valeur invalide.');
    if (b.hidden === base.hidden) delete o.hidden; else o.hidden = b.hidden;
  }
  if (!Object.keys(o).length) delete db.overrides[base.id];
  save();
  const e = effectiveItem(base);
  res.json({ item: { id: e.id, price: e.price, itemDiscount: e.itemDiscount, hidden: e.hidden } });
});

// ------------------------------------------------------------------ prix par fichier .txt (export / import)
// Format : une ligne par article, « NOM : PRIX ». NOM = identifiant (iron_ingot) ou nom anglais (Iron Ingot).
// Les lignes vides et les commentaires (# …) sont ignorés. Le prix est celui du stack (articles empilables) ou de la pièce.
const normKey = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const idIndex = new Map(catalog.map(it => [normKey(it.id), it]));   // identifiant exact : toujours prioritaire
const nameIndex = new Map();                                          // nom anglais : peut être partagé par plusieurs articles
for (const it of catalog) { const k = normKey(it.name); if (!nameIndex.has(k)) nameIndex.set(k, []); nameIndex.get(k).push(it); }
const lookup = key => idIndex.has(key) ? [idIndex.get(key)] : (nameIndex.get(key) || null);
// Raccourcis pour les matières premières dont le nom du jeu est plus long (IRON = lingot de fer…)
const ALIASES = { iron: 'iron_ingot', gold: 'gold_ingot', copper: 'copper_ingot', netherite: 'netherite_ingot', lapis: 'lapis_lazuli' };
const unitWord = it => it.unit === 'stack' ? `stack de ${it.stackSize}` : it.unit === 'service' ? 'service' : 'pièce';

function setPrice(base, p) {
  const o = db.overrides[base.id] || (db.overrides[base.id] = {});
  if (p === base.price) delete o.price; else o.price = p;
  if (!Object.keys(o).length) delete db.overrides[base.id];
}

function suggest(key) {
  if (key.length < 2) return [];
  return catalog.filter(i => normKey(i.id).includes(key) || normKey(i.name).includes(key)).slice(0, 5).map(i => i.id);
}

function parsePriceFile(text) {
  const rows = [], errors = [], seen = new Map();
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/);
  let valid = 0;
  lines.forEach((raw, idx) => {
    const n = idx + 1;
    const clean = raw.replace(/\s+#.*$/, '').trim();
    if (!clean || clean.startsWith('#') || clean.startsWith('//')) return;
    const err = (reason, extra) => errors.push({ line: n, text: raw.trim().slice(0, 120), reason, ...extra });
    const m = clean.match(/^(.+?)\s*[:=;\t]\s*(-?\d+(?:[.,]\d+)?)\s*(?:💎|diamants?|diamonds?)?$/i);
    if (!m) return err('Ligne illisible. Format attendu : NOM : PRIX (exemple : iron_ingot : 4)');
    const priceStr = m[2];
    if (/[.,]/.test(priceStr)) return err('Le prix doit être un nombre entier de diamants.');
    const price = Number(priceStr);
    if (price < 0 || price > 100000) return err('Prix invalide (entier entre 0 et 100 000).');
    if (++valid > 4000) return err('Trop de lignes (4 000 maximum).');
    const key = normKey(m[1]);
    let matches = lookup(key), via = null;
    if (!matches && ALIASES[key] && lookup(ALIASES[key])) { matches = lookup(ALIASES[key]); via = 'alias'; }
    if (!matches) return err(`Article « ${m[1].trim()} » introuvable.`, { suggestions: suggest(key) });
    const uniq = [...new Set(matches)];
    if (uniq.length > 1) return err(`« ${m[1].trim()} » correspond à plusieurs articles : précisez avec l’identifiant.`, { suggestions: uniq.slice(0, 5).map(i => i.id) });
    const base = uniq[0];
    if (seen.has(base.id)) return err(`Article déjà défini à la ligne ${seen.get(base.id)} : ligne ignorée.`);
    seen.set(base.id, n);
    const old = effectiveItem(base).price;
    rows.push({ line: n, input: m[1].trim(), id: base.id, name: base.name, unit: unitWord(base), oldPrice: old, newPrice: price, changed: old !== price, via });
  });
  return { rows, errors, base: id => catalogById.get(id) };
}

app.get('/api/admin/prices/export', requireAdmin, (req, res) => {
  const head = [
    '# craft-stor — prix des articles (en diamants)',
    '# Format : identifiant : prix      (le texte après # est ignoré)',
    '# Prix = un stack complet pour les articles empilables, sinon la pièce.',
    '# Modifiez les chiffres puis réimportez ce fichier depuis Admin → Prix & réductions.',
    ''
  ];
  const body = catalog.map(i => { const e = effectiveItem(i); return `${i.id} : ${e.price}   # ${i.name} (${unitWord(i)})${e.hidden ? ' [masqué]' : ''}`; });
  res.type('text/plain; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="craft-stor-prix.txt"');
  res.send([...head, ...body, ''].join('\n'));
});

app.post('/api/admin/prices/import', requireAdmin, (req, res) => {
  if (typeof req.body.text !== 'string' || !req.body.text.trim()) return fail(res, 400, 'Le fichier est vide.');
  const { rows, errors } = parsePriceFile(req.body.text);
  const changes = rows.filter(r => r.changed);
  let applied = false;
  if (req.body.apply === true) {
    for (const r of changes) setPrice(catalogById.get(r.id), r.newPrice);
    if (changes.length) save();
    applied = true;
  }
  res.json({ applied, total: rows.length + errors.length, valid: rows.length, unchanged: rows.length - changes.length, changes, errors });
});

app.post('/api/admin/settings', requireAdmin, (req, res) => {
  const d = Number(req.body.globalDiscount);
  if (!Number.isInteger(d) || d < 0 || d > 100) return fail(res, 400, 'Réduction invalide (0 à 100 %).');
  db.settings.globalDiscount = d; save();
  res.json({ globalDiscount: d });
});

app.get('/api/admin/codes', requireAdmin, (req, res) => res.json({ codes: db.codes }));

app.post('/api/admin/codes', requireAdmin, (req, res) => {
  const code = str(req.body.code, 40).toUpperCase();
  const percent = Number(req.body.percent);
  const maxUses = req.body.maxUses === '' || req.body.maxUses == null ? 0 : Number(req.body.maxUses);
  if (!/^[A-Z0-9_-]{3,40}$/.test(code)) return fail(res, 400, 'Code invalide (3 à 40 caractères : lettres, chiffres, - et _).');
  if (!Number.isInteger(percent) || percent < 1 || percent > 100) return fail(res, 400, 'Pourcentage invalide (1 à 100).');
  if (!Number.isInteger(maxUses) || maxUses < 0 || maxUses > 100000) return fail(res, 400, 'Limite d’utilisations invalide (0 = illimité).');
  if (db.codes.some(c => c.code === code)) return fail(res, 409, 'Ce code existe déjà.');
  db.codes.push({ code, percent, maxUses, uses: 0, active: true, createdAt: Date.now() }); save();
  res.json({ codes: db.codes });
});

app.post('/api/admin/codes/:code/toggle', requireAdmin, (req, res) => {
  const c = db.codes.find(x => x.code === req.params.code);
  if (!c) return fail(res, 404, 'Code introuvable.');
  c.active = !c.active; save();
  res.json({ codes: db.codes });
});

app.delete('/api/admin/codes/:code', requireAdmin, (req, res) => {
  const i = db.codes.findIndex(x => x.code === req.params.code);
  if (i < 0) return fail(res, 404, 'Code introuvable.');
  db.codes.splice(i, 1); save();
  res.json({ codes: db.codes });
});

// ------------------------------------------------------------------ statique + erreurs
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h', index: 'index.html' }));
app.use('/api', (req, res) => fail(res, 404, 'Route inconnue.'));
app.get('/{*splat}', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') return fail(res, 400, 'Requête invalide.');
  if (err && err.type === 'entity.too.large') return fail(res, 413, 'Fichier ou requête trop volumineux (300 Ko maximum).');
  console.error(err);
  fail(res, 500, 'Erreur interne du serveur.');
});

(async () => {
  const saved = await store.load();
  if (saved) Object.assign(db, saved);
  await ensureAdmin();
  app.listen(PORT, () => console.log(`craft-stor : http://localhost:${PORT}  (données : ${store.kind})`));
})().catch(e => { console.error('Démarrage impossible :', e.message); process.exit(1); });
