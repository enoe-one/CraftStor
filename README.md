
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
| `STATE_DIR` | dossier où sont stockés `db.json` (comptes, commandes…) et le secret de session | `data/` |
| `SESSION_SECRET` | secret de session | généré dans le dossier `STATE_DIR` |

**En ligne, mettez le site derrière HTTPS** (Caddy ou nginx) et lancez avec `COOKIE_SECURE=1 TRUST_PROXY=1`. Sans HTTPS, les mots de passe circulent en clair sur le réseau.

## Fonctionnement

- **Catalogue** : visible sans compte (1 387 articles : blocs, items, livres enchantés à chaque niveau, armures…). Commander demande un compte.
- **Inscription** : pseudo Minecraft, pseudo Discord, e-mail, mot de passe saisi deux fois.
- **Commande** : statut « Commande en cours — règlement non effectué » jusqu'à ce que l'admin accepte le règlement. L'acceptation **débite le solde** du membre (refusée si le solde est insuffisant).
- **Membre** : historique des commandes, favoris, solde. Pour recharger : contacter Enoe (l'admin ajoute les diamants).
- **Admin** : toutes les commandes (accepter / annuler), tous les comptes (ajouter ou retirer des diamants, définir un nouveau mot de passe), prix et réductions par article, promotion globale, codes de remise (pourcentage, limite d'utilisations, activation).

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
   - variables : `ADMIN_PASSWORD`, `COOKIE_SECURE=1`, `TRUST_PROXY=1`, et `STATE_DIR` pointant vers un **disque persistant** (ex. `/var/data`)
   - ⚠ sans disque persistant (cas des offres gratuites), comptes et commandes sont **effacés à chaque redéploiement**. Prévoyez un disque, ou un VPS.

Le dépôt ne contient aucun secret : `data/db.json` et le secret de session sont exclus par `.gitignore`.

## Notes

- **Mots de passe** : stockés hachés (bcrypt). Personne ne peut les lire, y compris l'admin, qui peut en définir un nouveau.
- **Items masqués** : les items impossibles à obtenir en survie (bedrock, command block, spawner, œufs d'apparition…) sont masqués. La liste est une estimation : vous pouvez masquer ou afficher n'importe quel article depuis le panneau admin. Les diamants et blocs de diamant ne sont pas vendus (c'est la monnaie).
- **Réductions** : par article ou globale ; si les deux existent, la plus forte s'applique (pas de cumul). Les codes de remise s'appliquent ensuite sur le total de la commande. Les prix sont arrondis au diamant supérieur.
- **Données** : tout est dans `data/db.json` (comptes, commandes, prix modifiés, codes). Sauvegardez ce fichier. Les sessions sont en mémoire : un redémarrage déconnecte les membres.
- **Regénérer le catalogue** (nouvelle version de Minecraft) : `npm install --include=dev` puis `npm run build-catalog`.
- Les icônes viennent des textures du jeu (paquet `minecraft-assets`). Site non officiel, sans lien avec Mojang ni Microsoft.
=======
# CraftStor
site for surviedesgenschill
>>>>>>> bf7529e8ec6205bc03f6e072336f5f18c7b1e1e7
