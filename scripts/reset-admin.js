// Redéfinit le mot de passe du compte administrateur : node scripts/reset-admin.js "NouveauMotDePasse"
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const file = path.join(process.env.STATE_DIR || path.join(__dirname, '..', 'data'), 'db.json');
const pwd = process.argv[2];
if (!pwd || pwd.length < 8) { console.error('Usage : node scripts/reset-admin.js "mot-de-passe-de-8-caracteres-minimum"'); process.exit(1); }
if (!fs.existsSync(file)) { console.error('Aucune base trouvée : lancez d’abord le serveur une fois.'); process.exit(1); }
const db = JSON.parse(fs.readFileSync(file, 'utf8'));
const admin = db.users.find(u => u.isAdmin);
if (!admin) { console.error('Aucun administrateur trouvé.'); process.exit(1); }
admin.passHash = bcrypt.hashSync(pwd, 10);
fs.writeFileSync(file, JSON.stringify(db, null, 2));
console.log('Mot de passe de « ' + admin.mcName + ' » mis à jour. Redémarrez le serveur.');
