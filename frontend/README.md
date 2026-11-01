# Tablanathas — frontend

React + TypeScript + Vite. Le frontend utilise `VITE_API_URL` comme origine facultative de l'API.

## Développement local

```powershell
Copy-Item .env.example .env.local
npm ci
npm run dev
```

Par défaut, le frontend appelle `http://localhost:3000/api`. Aucun fichier `.env` n'est nécessaire si le backend tourne sur son port local par défaut : `src/api/base.ts` utilise localhost uniquement lorsque Vite est en mode développement.

## Build de production

Avec un reverse proxy qui transmet `/api` vers le backend Express sur la même origine, utilise `.env.production.example` (ou ne crée aucun fichier d'environnement pour le build). `VITE_API_URL` doit être vide : les appels seront relatifs, par exemple `https://app.example.com/api/auth/me`.

Si l'API est sur une origine séparée, définis `VITE_API_URL=https://api.example.com` **avant** `npm run build` (il s'agit de l'origine, sans `/api`). La configuration de build refuse une URL localhost en mode production. Les variables `VITE_*` étant intégrées aux fichiers statiques au moment du build, changer `.env` après le build ne modifiera pas les fichiers déjà générés.

```powershell
npm ci
npm run build
```

Le contenu publiable se trouve dans `dist/`.
