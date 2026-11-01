import "dotenv/config";

function nonNegativeInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;
}

function pollIntervalMs(): number {
  const raw = process.env.ANATHAS_SNAPSHOT_POLL_MS;
  if (raw === undefined || raw.trim() === "") return 30_000;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(10_000, Math.floor(value)) : 30_000;
}

const nodeEnv = process.env.NODE_ENV ?? "development";
const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret || sessionSecret.length < 32) {
  throw new Error("SESSION_SECRET est obligatoire et doit contenir au moins 32 caractères.");
}

// En production, ne démarre pas avec une origine CORS locale par défaut :
// cela cacherait une mauvaise configuration du déploiement.
const webOrigin = process.env.WEB_ORIGIN?.trim()
  || (nodeEnv === "production" ? "" : "http://localhost:5173");
if (!webOrigin) {
  throw new Error("WEB_ORIGIN est obligatoire en production (ex. https://app.example.com).");
}
let parsedWebOrigin: URL;
try {
  parsedWebOrigin = new URL(webOrigin);
} catch {
  throw new Error("WEB_ORIGIN doit être une URL d'origine valide, sans chemin applicatif.");
}
if (nodeEnv === "production" && ["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsedWebOrigin.hostname.toLowerCase())) {
  throw new Error("WEB_ORIGIN pointe vers localhost en production. Configure l'origine publique du frontend.");
}
if (!["http:", "https:"].includes(parsedWebOrigin.protocol)) {
  throw new Error("WEB_ORIGIN doit utiliser http:// ou https://.");
}
if (parsedWebOrigin.pathname !== "/" || parsedWebOrigin.search || parsedWebOrigin.hash) {
  throw new Error("WEB_ORIGIN doit contenir uniquement le schéma, l'hôte et éventuellement le port.");
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL,
  nodeEnv,
  sessionSecret,
  webOrigin: parsedWebOrigin.origin,
  // Clé gardée côté serveur : ne jamais utiliser un préfixe VITE_ pour ce secret.
  anathasApiKey: process.env.ANATHAS_API_KEY?.trim() ?? "",
  anathasApiBaseUrl: (process.env.ANATHAS_API_BASE_URL ?? "https://www.anathas.com/api/v2").replace(/\/+$/, ""),
  anathasTimezone: process.env.ANATHAS_TIMEZONE ?? "Europe/Paris",
  anathasSnapshotPollMs: pollIntervalMs(),
  anathasDefaultAgriculturalZones: nonNegativeInteger("ANATHAS_DEFAULT_AGRICULTURAL_ZONES", 0),
  anathasDefaultHabitableZones: nonNegativeInteger("ANATHAS_DEFAULT_HABITABLE_ZONES", 0),
  anathasGameId: process.env.ANATHAS_GAME_ID ? Number(process.env.ANATHAS_GAME_ID) : null,
};

if (!config.databaseUrl) {
  throw new Error("DATABASE_URL est obligatoire.");
}
