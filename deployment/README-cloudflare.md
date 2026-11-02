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
- Le projet Neon secondaire `tablanathas-password-compute` avec Neon Functions Node.js 24 pour les opérations Argon2id. Le plan Workers Free est pris en charge par la collecte Anathas progressive ; les limites de 10 ms CPU et 50 sous-requêtes externes par invocation restent à respecter.

## 1. Installer les dépendances

Depuis la racine du dépôt :

```bash
npm --prefix backend ci
npm --prefix frontend ci
npm --prefix deployment install
```

Le script de déploiement vérifie le backend TypeScript, puis compile le frontend Vite.

## 2. Préparer PostgreSQL

### Base PostgreSQL existante

Ne relance pas le bootstrap sur une base contenant des données. Sur la branche de production `main`, exécute une seule fois depuis le SQL Editor Neon, `psql` ou pgAdmin :

1. `deployment/postgresql-hyperdrive-compatibility.sql` si le verrou advisory du trigger n'a pas encore été remplacé.
2. `deployment/anathas-snapshot-batching-migration.sql` pour ajouter la file persistante de collecte et son bail anti-concurrence.

Ces scripts sont additifs. Ils ne suppriment ni ne réinitialisent les captures historiques. La nouvelle version peut reprendre les anciennes captures partielles à partir des `raw_ranking` et `raw_details` encore présents dans `anathas_country_snapshots`.

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

Le Worker reçoit un Cron chaque minute (`* * * * *`). Il appelle `schedulerTick()`, qui ne démarre ou ne reprend une capture qu'aux créneaux du service dans `Europe/Paris` (00:00, 05:05, 18:00 et 20:05). Le calcul horaire continue de gérer le passage été/hiver.

Cloudflare Workers Free autorise 50 sous-requêtes externes par invocation (les redirections comptent également). Une capture ne tente donc jamais de charger toutes les fiches pays dans une seule invocation : le classement est conservé dans `anathas_snapshot_country_queue`, puis chaque invocation traite au plus 40 fiches (concurrence 4), en gardant une marge de 10 sous-requêtes. Le nombre de lots est calculé à partir du nombre réel de pays, sans plafond fixe : 116 pays donnent 3 lots, 121 pays donnent 4 lots (40 + 40 + 40 + 1), 161 pays en donnent 5, etc. Chaque déclenchement Cron traite un seul lot ; les lots suivants reprennent automatiquement au déclenchement de la minute suivante. Les succès sont conservés, les échecs sont retentés individuellement jusqu’à 3 fois, et une capture n’est publiée au dashboard que lorsque toutes les fiches attendues sont valides.

La table de file conserve le classement, les réponses brutes, les tentatives et les prochaines dates de reprise. Une fiche réussie n'est pas redemandée lors d'une reprise ; seules les fiches échouées sont retentées. Une capture ne devient `completed` et ne met à jour le dashboard qu'une fois toutes les fiches détaillées validées. Les anciennes captures partielles sont reprises à partir de `anathas_country_snapshots` lorsque leurs données brutes sont disponibles.

Sur une base existante, appliquer une seule fois `deployment/anathas-snapshot-batching-migration.sql` avant de déployer cette version. Le script ajoute le bail de traitement et la table de file sans supprimer de capture historique. Le bootstrap des bases neuves crée également ces objets.

La première invocation après migration peut reprendre une capture partielle antérieure : elle initialise la file depuis les lignes déjà présentes dans `anathas_country_snapshots` et ne redemande que les fiches dont `raw_details` est absent. Pour suivre la progression, consulter `anathas_snapshot_runs` et joindre `anathas_snapshot_country_queue` par `snapshot_id`.

Avant le déploiement, le calcul du nombre de lots peut être vérifié avec `npm --prefix backend run test:anathas-batching`. Les cas testés incluent 116 pays → 3 lots, 121 → 4 lots et 161 → 5 lots.

Le Worker n'utilise pas de `setInterval` pour les captures : le déclenchement est fait par `scheduled()`. La réservation du créneau utilise la contrainte unique `schedule_key` et un bail `worker_lease_until` attribué atomiquement, afin d'éviter deux captures concurrentes sans advisory lock.

## 9. Limites et points d'attention

- Hyperdrive utilise un pooling transactionnel ; les advisory locks PostgreSQL ne sont pas pris en charge. Le code Worker n'en utilise plus. Sur une base existante, applique le script de compatibilité de l'étape 2 avant de basculer le Worker.
- Le Worker utilise `AsyncLocalStorage` (`nodejs_als`) pour isoler un pool `pg` par requête HTTP et par déclenchement Cron, puis ferme ce pool à la fin de l'exécution. Il est limité à 5 connexions simultanées ; Hyperdrive mutualise les connexions vers PostgreSQL.
- Le binding Cloudflare `LOGIN_RATE_LIMITER` complète le limiteur Express. Les limites Cloudflare simples sont approximatives et localisées par région ; elles ne remplacent pas un contrôle global strict de type Durable Object/WAF.
- Le calcul Argon2id (64 MiB, 3 itérations) est déporté vers Neon Functions Node.js 24 ; les empreintes existantes restent compatibles. Le Worker Cloudflare Free conserve néanmoins une limite de 10 ms CPU par invocation et 50 sous-requêtes externes. Le client Anathas est donc limité à 40 fiches détaillées par invocation, avec reprise persistante au tick Cron suivant.
- `backend/sql/production-bootstrap.sql` est destiné exclusivement à une base PostgreSQL neuve. Pour une base existante, appliquer uniquement les scripts de migration/compatibilité requis. Aucun schéma D1 n'est livré pour cette version.
