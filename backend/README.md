# Tablanathas Backend

API Node.js + TypeScript + Express + PostgreSQL. Les comptes sont authentifiés par session stockée dans PostgreSQL ; les mots de passe sont hachés avec Argon2id.

## Prérequis

- Node.js 20 ou supérieur
- PostgreSQL
- Un fichier `backend/.env` local, créé à partir de `.env.example`

## Développement local (Windows PowerShell)

Depuis ce dossier (`backend`) :

```powershell
Copy-Item .env.example .env  # une seule fois ; renseigne la base de développement
npm ci
npm run dev
```

Le backend écoute par défaut sur `http://localhost:3000`. L'origine frontend locale par défaut est `http://localhost:5173`. Utilise une base PostgreSQL et un `SESSION_SECRET` propres au développement, distincts de la production.

Variables principales :

- `DATABASE_URL` : URL de connexion PostgreSQL.
- `SESSION_SECRET` : secret aléatoire d'au moins 32 caractères. Génération possible avec `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`.
- `NODE_ENV` : `development` localement, `production` sur le serveur.
- `WEB_ORIGIN` : origine exacte du frontend, sans chemin (par exemple `http://localhost:5173` localement et `https://app.example.com` en production).
- `ANATHAS_API_KEY` : clé confidentielle utilisée uniquement par le backend. Ne la mets jamais dans le frontend ou dans une variable `VITE_*`.
- `ANATHAS_API_BASE_URL`, `ANATHAS_TIMEZONE`, `ANATHAS_SNAPSHOT_POLL_MS` : configuration de l'API Anathas et de son planificateur de captures.

Ne versionne ni ne partage les fichiers `.env` réels. Les fichiers `*.env.example` sont des modèles non secrets et ne sont pas chargés automatiquement.

## Base de données

### Créer une base neuve

Le fichier [`sql/production-bootstrap.sql`](sql/production-bootstrap.sql) contient le schéma complet attendu par la version actuelle : tables métier, vues, comptes, scénarios privés, captures Anathas et tables de session. Il est destiné exclusivement à une **base PostgreSQL vide**. Une garde refuse le bootstrap si des tables Tablanathas essentielles existent, et le script applique le schéma dans une transaction.

1. Crée une base PostgreSQL vide et configure `DATABASE_URL` dans `backend/.env` ou dans les variables du service.
2. Depuis `backend`, exécute :

   ```powershell
   npm ci
   npm run db:bootstrap
   npm run user:create -- --username admin
   ```

3. La commande de création de compte génère un mot de passe initial aléatoire et l'affiche une seule fois. L'identifiant `admin` reçoit le rôle administrateur ; conserve ce mot de passe dans un gestionnaire sécurisé.

Le SQL peut aussi être lancé directement avec `psql` :

```powershell
psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -f .\sql\production-bootstrap.sql
```

### Déployer une nouvelle version sur une base existante

**Ne relance pas `db:bootstrap` lors des déploiements ultérieurs et ne supprime pas le schéma de production.** Le bootstrap est une recette de création initiale, pas une migration de mise à niveau. Avant toute modification du schéma :

1. Fais une sauvegarde PostgreSQL (`pg_dump -Fc`).
2. Applique uniquement la migration incrémentale destinée à la version déployée.
3. Vérifie le schéma puis construis/déploie l'application.

Les prochaines évolutions SQL doivent être versionnées comme des fichiers distincts sous [`sql/migrations/`](sql/migrations/README.md). La table `schema_migrations` est créée pour garder la trace des versions appliquées ; n'ajoute pas une ligne avant que la migration correspondante ait réussi.

## Créer des comptes

L'inscription publique est désactivée. Depuis une machine de confiance connectée à la base :

```powershell
npm run user:create -- --username joueur1
npm run user:create -- --username joueur2 --email joueur2@example.com
```

L'e-mail est facultatif. Le mot de passe aléatoire est affiché une fois. La création d'un compte nommé `admin` attribue le rôle administrateur ; les autres comptes sont standards.

## Commandes utiles

```powershell
npm run check
npm run build
npm run start
```

- `npm run dev` : serveur avec rechargement automatique.
- `npm run check` : vérification TypeScript.
- `npm run build` : compilation dans `dist/`.
- `npm run db:bootstrap` : création initiale du schéma sur base vide uniquement.
- `npm run user:create -- --username <identifiant>` : création d'un compte.

## API et planification

- `GET /api/health` : contrôle de santé public.
- `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout` : authentification.
- Les routes métier sous `/api` exigent une session valide ; les routes d'administration vérifient le rôle `admin` côté serveur.

Le planificateur Anathas est lancé avec le serveur et utilise `Europe/Paris`, y compris pendant le passage à l'heure d'été/hiver. Il capture à 05:05, 18:00, 20:05 et 00:00 selon la phase du tour. Configure la clé API uniquement dans le backend.

## Production et reverse proxy

En `NODE_ENV=production`, le backend exige une valeur `WEB_ORIGIN` publique valide, refuse `localhost` et active les cookies de session sécurisés. `SESSION_SECRET` doit être aléatoire, long et distinct de celui de développement.

Voir [`../DEPLOYMENT.md`](../DEPLOYMENT.md) pour les exemples de configuration, la séparation des environnements et le proxy Nginx.
