# Déploiement Tablanathas sur Cloudflare Workers

## Architecture retenue : Workers + Hyperdrive + PostgreSQL

Cette version conserve le backend Express et le modèle de données PostgreSQL. Cloudflare Workers exécute l'API, publie le build React/Vite comme assets statiques et accède à PostgreSQL par Hyperdrive.

**Aucune migration D1 n'est fournie, volontairement.** D1 repose sur SQLite, alors que Tablanathas utilise des fonctions et triggers PL/pgSQL, des vues analytiques, `jsonb`, `timestamptz`, `numeric`, les paramètres `$1`, `RETURNING`, des transactions et des contraintes PostgreSQL. Convertir seulement `production-bootstrap.sql` en SQL SQLite ne rendrait pas compatibles les requêtes du backend. Une véritable migration D1 nécessiterait de réécrire le dépôt SQL, le bootstrap, les vues, les fonctions, les transactions et la gestion des sessions. Hyperdrive permet de déployer le Worker sans réécrire cette couche.

Le fichier `deployment/legacy/nginx-tablanathas.conf` est conservé uniquement pour un ancien hébergement VPS avec Nginx ; il n’est pas utilisé par le Worker.

Documentation Cloudflare :
- [Déployer Express sur Workers](https://developers.cloudflare.com/workers/tutorials/deploy-an-express-app/)
- [Connecter PostgreSQL avec Hyperdrive](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/)
- [Développement local avec Hyperdrive](https://developers.cloudflare.com/hyperdrive/configuration/local-development/)

## Prérequis

- Un compte Cloudflare et un Worker.
- Une instance PostgreSQL accessible depuis Cloudflare, avec un hôte joignable publiquement et TLS correctement configuré. Une base sur `localhost` ou sur un PC éteint ne sera pas accessible en production.
- Node.js **22.12 ou supérieur** recommandé, npm et Git.
- Un compte **Workers Paid recommandé/nécessaire pour ce profil d'application** : le calcul Argon2id conserve les paramètres de sécurité des mots de passe existants (64 MiB, 3 itérations). Le plan Free limite le CPU à 10 ms par invocation ; le plan Paid autorise 30 secondes par défaut. Le Worker configure 30 secondes. Vérifie également le comportement mémoire pendant les tests de connexion.

## 1. Installer les dépendances

Depuis la racine du dépôt :

```bash
npm --prefix backend ci
npm --prefix frontend ci
npm --prefix deployment install
```

Le script de déploiement vérifie le backend TypeScript, puis compile le frontend Vite.

## 2. Préparer PostgreSQL

### Base PostgreSQL neuve

Initialise une base vide avec le bootstrap PostgreSQL :

```bash
npm --prefix backend run db:bootstrap
```

`backend/sql/production-bootstrap.sql` est un **bootstrap PostgreSQL** compatible avec Workers via Hyperdrive. **Ne l'exécute pas avec `wrangler d1 execute` et ne l'utilise pas sur D1.**

### Base PostgreSQL existante

Ne relance pas le bootstrap sur une base contenant des données. Exécute une seule fois, depuis `psql` ou pgAdmin, le script :

```text
deployment/postgresql-hyperdrive-compatibility.sql
```

Il remplace le verrou advisory du trigger de limitation des scénarios par un verrou de ligne, compatible avec le pooling transactionnel Hyperdrive. Les chemins applicatifs et le bootstrap neuf utilisent également des verrous de ligne ou une réservation atomique de capture.

## 3. Créer la configuration Hyperdrive

Depuis `deployment/`, crée une configuration Hyperdrive qui pointe vers la base PostgreSQL :

```bash
npx wrangler hyperdrive create tablanathas-postgres --connection-string="postgresql://UTILISATEUR:MOT_DE_PASSE@HOTE:5432/BASE" --caching-disabled
```

Copie l'identifiant retourné dans `deployment/wrangler.jsonc`, à la place de :

```jsonc
"id": "REPLACE_WITH_HYPERDRIVE_ID"
```

Le cache Hyperdrive est désactivé à la création : l'application effectue de nombreuses lectures juste après des écritures (réglages, scénarios, classements) et doit voir immédiatement les valeurs à jour.

## 4. Configurer les domaines, variables et secrets

Dans `deployment/wrangler.jsonc` :

- Remplace `WEB_ORIGIN` par l'origine exacte utilisée par les visiteurs, sans chemin ni `/api`. Pour le domaine Workers par défaut, utilise `https://<nom-du-worker>.<sous-domaine>.workers.dev`; pour un domaine personnalisé, utilise `https://ton-domaine.fr`.
- Remplace `namespace_id` du binding `LOGIN_RATE_LIMITER` par un entier unique dans ton compte Cloudflare.
- Vérifie la timezone et les réglages `ANATHAS_*`.

Ajoute les secrets depuis `deployment/` :

```bash
npx wrangler secret put SESSION_SECRET
npx wrangler secret put ANATHAS_API_KEY
```

`SESSION_SECRET` doit contenir au moins 32 caractères aléatoires. La clé Anathas reste côté serveur. `DATABASE_URL` n'est pas à renseigner : le Worker la récupère depuis `env.HYPERDRIVE.connectionString`.

## 5. Tester localement

Copie `deployment/.dev.vars.example` vers `deployment/.dev.vars`. Il configure l'origine locale `http://localhost:8787` et les secrets `SESSION_SECRET` et `ANATHAS_API_KEY`. Wrangler définit automatiquement `NODE_ENV=development` avec `wrangler dev` et `NODE_ENV=production` avec `wrangler deploy` ; le cookie de session est donc adapté au HTTP local sans modifier manuellement cette variable.

Pour `wrangler dev` en local, Hyperdrive doit recevoir une chaîne de connexion PostgreSQL directe. La méthode la plus sûre est la variable d'environnement du terminal, qui n'est pas enregistrée dans le dépôt.

**Windows PowerShell**, depuis `deployment/` :

```powershell
$env:CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE = "postgresql://UTILISATEUR:MOT_DE_PASSE@localhost:5432/Tablanathas"
npm run dev
```

**macOS/Linux**, depuis `deployment/` :

```bash
export CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE="postgresql://UTILISATEUR:MOT_DE_PASSE@localhost:5432/Tablanathas"
npm run dev
```

Cette connexion locale passe directement par PostgreSQL : le pooling et le cache Hyperdrive ne sont alors pas actifs. Autre possibilité : `npx wrangler dev --remote` depuis `deployment/`, qui utilise la configuration Hyperdrive distante et la base réelle. Attention : les écritures affectent alors la base distante.

## 6. Vérifier et déployer

Depuis `deployment/` :

```bash
npm run types
npm run dry-run
npm run deploy
```

- `types` génère les types de bindings Wrangler.
- `dry-run` vérifie le backend TypeScript, construit le frontend et prépare un déploiement sans le publier.
- `deploy` répète ces contrôles puis publie le Worker et les assets.

Les routes du frontend React sont servies en mode SPA. Les requêtes `/api` et `/api/*` sont routées vers Express. Les autres ressources (dont `/logo.png`, les SVG des cristaux et le favicon) sont servies depuis `frontend/dist`.

## 7. Compte administrateur

La création initiale du compte administrateur reste une commande Node exécutée depuis ton poste, avec `backend/.env` configuré sur la même base PostgreSQL :

```bash
npm --prefix backend run user:create -- --username admin
```

Le module Argon2 natif a été remplacé par `hash-wasm` (WASM) afin de fonctionner dans Workers. Les empreintes Argon2id existantes restent vérifiables avec les mêmes paramètres cryptographiques. Les opérations de hash/vérification sont sérialisées à l’intérieur d’un isolate pour éviter plusieurs allocations Argon2 de 64 Mio en parallèle.

## 8. Captures Anathas (Cron)

Le Worker reçoit un Cron toutes les cinq minutes (`*/5 * * * *`). Il appelle `schedulerTick()`, qui ne déclenche une capture qu'aux créneaux du service dans `Europe/Paris` (00:00, 05:05, 18:00 et 20:05). Le calcul horaire continue de gérer le passage été/hiver.

Le Worker n'utilise pas de `setInterval` pour les captures : le déclenchement est fait par `scheduled()`. La réservation du créneau utilise la contrainte unique `schedule_key` et un `INSERT ... ON CONFLICT` atomique, afin d'éviter deux captures concurrentes sans advisory lock.

## 9. Limites et points d'attention

- Hyperdrive utilise un pooling transactionnel ; les advisory locks PostgreSQL ne sont pas pris en charge. Le code Worker n'en utilise plus. Sur une base existante, applique le script de compatibilité de l'étape 2 avant de basculer le Worker.
- Le Worker utilise `AsyncLocalStorage` (`nodejs_als`) pour isoler un pool `pg` par requête HTTP et par déclenchement Cron, puis ferme ce pool à la fin de l'exécution. Il est limité à 5 connexions simultanées ; Hyperdrive mutualise les connexions vers PostgreSQL.
- Le binding Cloudflare `LOGIN_RATE_LIMITER` complète le limiteur Express. Les limites Cloudflare simples sont approximatives et localisées par région ; elles ne remplacent pas un contrôle global strict de type Durable Object/WAF.
- Le hash Argon2id utilise 64 MiB et 3 itérations afin de rester compatible avec les mots de passe existants. Le plan Free (10 ms CPU) ne convient pas à ce calcul ; teste les connexions sur ton plan et surveille les limites CPU/mémoire.
- `backend/sql/production-bootstrap.sql` est destiné exclusivement à une base PostgreSQL neuve. Pour une base existante, appliquer uniquement les scripts de migration/compatibilité requis. Aucun schéma D1 n'est livré pour cette version.
