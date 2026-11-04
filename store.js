// Stockage des données (comptes, commandes, prix modifiés, codes).
//  - DATABASE_URL défini  → Postgres (recommandé en ligne : les disques des offres gratuites sont effacés)
//  - sinon                → fichier JSON local (STATE_DIR/db.json), pratique pour tester chez soi
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

async function load() {
  if (pool) {
    return retry(async () => {
      await pool.query('CREATE TABLE IF NOT EXISTS craftstor_data (key text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())');
      const r = await pool.query("SELECT value FROM craftstor_data WHERE key = 'db'");
      return r.rows[0] ? r.rows[0].value : null;
    });
  }
  fs.mkdirSync(STATE_DIR, { recursive: true });
  return fs.existsSync(DB_FILE) ? JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) : null;
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
  const json = JSON.stringify(db); // instantané pris maintenant
  chain = chain
    .then(() => retry(() => pool.query(
      "INSERT INTO craftstor_data (key, value) VALUES ('db', $1::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()", [json])))
    .catch(e => console.error('ERREUR de sauvegarde Postgres :', e.message));
  return chain;
}

async function close() {
  await chain;
  if (pool) await pool.end().catch(() => {});
}

module.exports = { load, write, close, kind: pool ? 'Postgres' : 'fichier ' + DB_FILE };
