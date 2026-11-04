// Redéfinit le mot de passe du compte administrateur : node scripts/reset-admin.js "NouveauMotDePasse"
// Fonctionne avec le fichier local comme avec Postgres (DATABASE_URL), exactement comme le serveur.
const bcrypt = require('bcryptjs');
const store = require('../store');

(async () => {
  const pwd = process.argv[2];
  if (!pwd || pwd.length < 8) { console.error('Usage : node scripts/reset-admin.js "mot-de-passe-de-8-caracteres-minimum"'); process.exit(1); }
  const db = await store.load();
  if (!db || !db.users) { console.error('Aucune donnée trouvée : lancez d’abord le serveur une fois.'); process.exit(1); }
  const admin = db.users.find(u => u.isAdmin);
  if (!admin) { console.error('Aucun administrateur trouvé.'); process.exit(1); }
  admin.passHash = bcrypt.hashSync(pwd, 10);
  await store.write(db);
  await store.close();
  console.log('Mot de passe de « ' + admin.mcName + ' » mis à jour. Redémarrez le serveur.');
})().catch(e => { console.error('Erreur :', e.message); process.exit(1); });
