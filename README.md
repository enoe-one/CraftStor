
# craft-stor

Boutique Minecraft payée en **diamants** : catalogue public, comptes membres, commandes, tableau de bord admin.

## Démarrage

```bash
npm install
npm start
```

Le site est alors sur http://localhost:3000.




## Variables d'environnement

| Variable | Rôle | Défaut |
|---|---|---|
| `PORT` | port du serveur | `3000` |
| `COOKIE_SECURE=1` | cookie de session réservé au HTTPS | désactivé |
| `TRUST_PROXY=1` | à activer derrière un reverse proxy (nginx, Caddy…) | désactivé |
| `DATABASE_URL` | lien de connexion Postgres : si défini, **toutes les données** (comptes, commandes, prix, codes) y sont stockées | fichier local |
| `STATE_DIR` | sans `DATABASE_URL` : dossier du fichier `db.json` | `data/` |
| `PGSSL=disable` | désactive le SSL vers Postgres (base locale uniquement) | SSL activé |
| `SESSION_SECRET` | secret de session (facultatif) | aléatoire à chaque démarrage |

**En ligne, mettez le site derrière HTTPS** (Caddy ou nginx) et lancez avec `COOKIE_SECURE=1 TRUST_PROXY=1`. Sans HTTPS, les mots de passe circulent en clair sur le réseau.

## Fonctionnement

- **Catalogue** : visible sans compte (1 387 articles : blocs, items, livres enchantés à chaque niveau, armures…). Commander demande un compte.
- **Inscription** : pseudo Minecraft, pseudo Discord, e-mail, mot de passe saisi deux fois.
- **Commande** : statut « Commande en cours — règlement non effectué » jusqu'à ce que l'admin accepte le règlement. L'acceptation **débite le solde** du membre (refusée si le solde est insuffisant).
- **Membre** : historique des commandes, favoris, solde. Pour recharger : contacter Enoe (l'admin ajoute les diamants).
- **Admin** : toutes les commandes (accepter / annuler), tous les comptes (ajouter ou retirer des diamants, définir un nouveau mot de passe), prix et réductions par article, promotion globale, codes de remise (pourcentage, limite d'utilisations, activation).
- **Prix par fichier .txt** (Admin → Prix & réductions) : téléchargez les prix actuels (modèle), modifiez les chiffres, puis réimportez le fichier. Un aperçu s'affiche avant toute modification.

### Format du fichier de prix

Une ligne par article, `NOM : PRIX`. Le NOM est l'identifiant (`iron_ingot`) ou le nom anglais (`Iron Ingot`), sans tenir compte des majuscules. Raccourcis acceptés : `IRON` (lingot de fer), `GOLD`, `COPPER`, `NETHERITE`, `LAPIS`. Séparateurs acceptés : `:` `=` `;` ou tabulation. Les lignes vides et ce qui suit `#` sont ignorés.

```
# exemple
IRON : 4
oak_log : 3
Oak Planks = 5
diamond_sword : 2   # commentaire
```

Le prix est celui d'un **stack** pour les articles empilables, sinon celui de la pièce. Les lignes en erreur (article inconnu, prix non entier, doublon…) sont signalées et ignorées ; les autres sont appliquées.

## Prix appliqués

| Article | Prix |
|---|---|
| Livre enchanté (chaque enchantement, chaque niveau) | 2 💎 |
| Livres Wind Burst et Swift Sneak | 20 💎 |
| Casque / bottes en diamant | 2 💎 |
| Jambières / plastron en diamant | 3 💎 / 4 💎 |
| Autres pièces d'armure (cuir, mailles, fer, or, tortue) | 1 💎 |
| Armure et outils en netherite | version diamant + 10 💎 (le lingot d'amélioration) |
| Outils en diamant | épée, pioche, hache 2 💎 · pelle, houe 1 💎 |
| Bois (bûches, planches, portes, escaliers, dalles…) | 2 💎 le stack |
| Blocs travaillés (briques, pierre lisse, verre, laine, béton, terre cuite, grès…) | 2 💎 le stack |
| Pierre et terre brutes (stone, cobblestone, terre, sable, gravier, netherrack…) | 1 💎 le stack |
| Obsidienne / blocs de quartz, prismarine, purpur | 3 💎 le stack |
| Blocs de minerai (9 lingots) | fer, émeraude, charbon, lapis, redstone : 9 💎 le stack · or : 18 💎 le stack |
| Cuivre (lingot) / blocs de cuivre | 1 💎 / 6 💎 le stack |
| Nourriture cuite | 2 💎 le stack |
| Objets rares, à la pièce | ailes (elytra) 20 · totem 8 · pomme dorée enchantée 10 · étoile du Nether 10 · balise 12 · œuf de dragon 40 · tête de dragon 15 · trident 8 · disques 4 (les plus rares 8) · shulker box 3 · gabarits d'amélioration 3 à 5 · bloc de netherite 90 |
| Trou profond (X, Z, dimension) | 25 💎 |
| Lingot de netherite | 10 💎 l'unité |
| Masse (mace) | 25 💎 |
| Or (lingot, or brut) | 2 💎 le stack |
| Tout le reste (fer, émeraude, charbon, blocs…) | 1 💎 le stack, ou la pièce si non empilable |

Tout est modifiable ensuite depuis **Admin → Prix & réductions**.

## Mettre en ligne (GitHub + hébergement)

GitHub conserve le code, mais **il n'exécute pas** un site avec comptes et base de données (GitHub Pages ne sert que des pages statiques). Pour que tout le monde y accède, il faut deux étapes :

1. **Envoyer le code sur GitHub** : créez un dépôt vide sur github.com, puis

   ```bash
   git remote add origin https://github.com/VOTRE-COMPTE/craft-stor.git
   git push -u origin main
   ```

2. **Le faire tourner chez un hébergeur Node.js** relié à ce dépôt (Render, Railway, Fly.io, ou un petit VPS) :
   - build : `npm install` · démarrage : `npm start`
   - variables : `ADMIN_PASSWORD`, `COOKIE_SECURE=1`, `TRUST_PROXY=1`, et `DATABASE_URL` (voir ci-dessous)

3. **Stocker les données dans une base Postgres gratuite.** Sur les offres gratuites, le disque du serveur est effacé à chaque redémarrage : sans base externe, comptes et commandes disparaissent. Créez une base chez un fournisseur qui ne la supprime pas (par exemple Neon), copiez son lien de connexion (`postgresql://…`) et mettez-le dans la variable `DATABASE_URL`. La table est créée automatiquement au premier démarrage.
   - ⚠ La base gratuite de **Render** expire après 30 jours puis est supprimée : à éviter.
   - Une base gratuite qui se met en veille peut mettre quelques secondes à répondre au premier accès : le site réessaie tout seul.
   - Aucune sauvegarde automatique sur les offres gratuites : exportez de temps en temps (`pg_dump "$DATABASE_URL" > sauvegarde.sql`).

Le dépôt ne contient aucun secret : `data/db.json` est exclu par `.gitignore`, et le lien `DATABASE_URL` ne doit **jamais** être écrit dans le code ni dans GitHub, seulement dans les variables de l'hébergeur.

## Notes

- **Mots de passe** : stockés hachés (bcrypt). Personne ne peut les lire, y compris l'admin, qui peut en définir un nouveau.
- **Items masqués** : les items impossibles à obtenir en survie (bedrock, command block, spawner, œufs d'apparition…) sont masqués. La liste est une estimation : vous pouvez masquer ou afficher n'importe quel article depuis le panneau admin. Les diamants et blocs de diamant ne sont pas vendus (c'est la monnaie).
- **Réductions** : par article ou globale ; si les deux existent, la plus forte s'applique (pas de cumul). Les codes de remise s'appliquent ensuite sur le total de la commande. Les prix sont arrondis au diamant supérieur.
- **Données** : comptes, commandes, prix modifiés et codes sont dans Postgres (`DATABASE_URL`) ou, sans cette variable, dans `data/db.json` : sauvegardez-les. Les sessions sont en mémoire : un redémarrage déconnecte les membres (sans perte de données).
- **Mot de passe admin perdu** : `node scripts/reset-admin.js "nouveau"` fonctionne avec la base Postgres si `DATABASE_URL` est défini dans votre terminal.
- **Regénérer le catalogue** (nouvelle version de Minecraft) : `npm install --include=dev` puis `npm run build-catalog`.
- Les icônes viennent des textures du jeu (paquet `minecraft-assets`). Site non officiel, sans lien avec Mojang ni Microsoft.
=======
# CraftStor
site for surviedesgenschill
