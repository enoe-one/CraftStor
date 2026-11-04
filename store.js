// Stockage des données (comptes, commandes, prix modifiés, codes).
//  - DATABASE_URL défini  → Postgres (recommandé en ligne : les disques des offres gratuites sont effacés)
//  - sinon                → fichier JSON local (STATE_DIR/db.json), pratique pour tester chez soi
//
// Postgres : tout le jeu de données est un seul document JSON, avec un numéro de révision (_rev).
// Chaque écriture n'est acceptée que si la base est toujours à la révision que NOUS avons lue.
// Sinon une autre instance (ex. l'ancienne version pendant un redéploiement) a écrit entre-temps :
// on refuse d'écraser ses données avec un état périmé (voir onConflict dans server.js).
const fs = require('fs');
const path = require('path');

const STATE_DIR = process.env.STATE_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(STATE_DIR, 'db.json');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pool = null;
if (process.env.DATABASE_URL) {
  const { Pool } = require('pg');
  const url = new URL(process.env.DATABASE_URL);
  const mode = url.searchParams.get('sslmode');
  url.searchParams.delete('sslmode'); // on gère nous-mêmes le SSL (voir ci-dessous)
  const noSsl = process.env.PGSSL === 'disable' || mode === 'disable';
  pool = new Pool({
    connectionString: url.toString(),
    ssl: noSsl ? false : { rejectUnauthorized: false }, // hébergeurs gérés (Neon, Render, Supabase…)
    max: 3,
    connectionTimeoutMillis: 15000
  });
  // Une connexion inactive coupée par l'hébergeur ne doit pas faire planter le site.
  pool.on('error', e => console.error('Postgres (connexion inactive) :', e.message));
}

// Les bases gratuites se mettent en veille : le premier accès peut échouer, on réessaie.
async function retry(fn, tries = 4) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) { last = e; await sleep(1000 * (i + 1)); }
  }
  throw last;
}

let rev = 0;                       // révision de la base telle que nous l'avons lue / écrite en dernier
let conflictHandler = () => {};
function onConflict(fn) { conflictHandler = fn; }

async function load() {
  if (pool) {
    return retry(async () => {
      await pool.query('CREATE TABLE IF NOT EXISTS craftstor_data (key text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())');
      const r = await pool.query("SELECT value FROM craftstor_data WHERE key = 'db'");
      if (!r.rows[0]) { rev = 0; return null; }
      const v = r.rows[0].value;
      rev = Number.isInteger(v._rev) ? v._rev : 0; // anciennes données sans _rev : révision 0
      delete v._rev;
      return v;
    });
  }
  fs.mkdirSync(STATE_DIR, { recursive: true });
  return fs.existsSync(DB_FILE) ? JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) : null;
}

// true si une autre instance a écrit dans la base depuis notre dernière lecture/écriture.
async function isStale() {
  if (!pool) return false;
  const r = await retry(() => pool.query("SELECT COALESCE((value->>'_rev')::int, 0) AS r FROM craftstor_data WHERE key = 'db'"));
  return (r.rows[0] ? r.rows[0].r : 0) !== rev;
}

let chain = Promise.resolve(); // les écritures Postgres partent dans l'ordre
function write(db) {
  if (!pool) {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
    fs.renameSync(tmp, DB_FILE); // écriture atomique
    return Promise.resolve();
  }
  const snapshot = JSON.stringify(db); // instantané pris maintenant
  chain = chain
    .then(async () => {
      const next = rev + 1;
      const json = '{"_rev":' + next + ',' + snapshot.slice(1); // snapshot est un objet JSON non vide
      let r = await retry(() => pool.query(
        "UPDATE craftstor_data SET value = $1::jsonb, updated_at = now() WHERE key = 'db' AND COALESCE((value->>'_rev')::int, 0) = $2", [json, rev]));
      if (r.rowCount === 0) { // soit la ligne n'existe pas encore, soit elle a été modifiée par une autre instance
        r = await retry(() => pool.query("INSERT INTO craftstor_data (key, value) VALUES ('db', $1::jsonb) ON CONFLICT (key) DO NOTHING", [json]));
        if (r.rowCount === 0) { conflictHandler(); return; }
      }
      rev = next;
    })
    .catch(e => console.error('ERREUR de sauvegarde Postgres :', e.message));
  return chain;
}

async function close() {
  await chain;
  if (pool) await pool.end().catch(() => {});
}

module.exports = { load, write, close, isStale, onConflict, kind: pool ? 'Postgres' : 'fichier ' + DB_FILE, usesPostgres: !!pool };
