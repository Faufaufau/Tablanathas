import { handleAsNodeRequest } from "cloudflare:node";
import process from "node:process";

type HyperdriveBinding = { connectionString: string };
type AssetsBinding = { fetch(request: Request): Promise<Response> };
type RateLimitBinding = { limit(input: { key: string }): Promise<{ success: boolean }> };

interface CloudflareEnv {
  HYPERDRIVE: HyperdriveBinding;
  ASSETS: AssetsBinding;
  LOGIN_RATE_LIMITER: RateLimitBinding;
  SESSION_SECRET: string;
  WEB_ORIGIN: string;
  ANATHAS_API_KEY?: string;
  ANATHAS_API_BASE_URL?: string;
  ANATHAS_TIMEZONE?: string;
  ANATHAS_SNAPSHOT_POLL_MS?: string;
  ANATHAS_DEFAULT_AGRICULTURAL_ZONES?: string;
  ANATHAS_DEFAULT_HABITABLE_ZONES?: string;
  ANATHAS_GAME_ID?: string;
  PASSWORD_SERVICE_URL?: string;
  PASSWORD_SERVICE_TOKEN?: string;
}

interface WorkerExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

interface WorkerScheduledController {
  cron: string;
  scheduledTime: number;
}

// Express est initialisé une seule fois par instance Worker. Les valeurs de
// process.env doivent être posées avant l'import dynamique de app.ts/config.ts.
let apiServerPromise: Promise<void> | null = null;
const API_PORT = 8787;

function applyWorkerEnvironment(env: CloudflareEnv): void {
  // Les modules historiques lisent leur configuration via process.env.
  // Les valeurs Cloudflare sont injectées avant leur import dynamique.
  // Wrangler définit NODE_ENV automatiquement : development avec wrangler dev,
  // production avec wrangler deploy. Ne pas le modifier depuis les bindings.
  process.env.PORT = String(API_PORT);
  process.env.DATABASE_URL = env.HYPERDRIVE.connectionString;
  process.env.PG_POOL_MAX = "5";
  process.env.WORKER_RUNTIME = "cloudflare";
  process.env.SESSION_SECRET = env.SESSION_SECRET;
  process.env.WEB_ORIGIN = env.WEB_ORIGIN;
  process.env.PASSWORD_SERVICE_URL = env.PASSWORD_SERVICE_URL ?? "";
  process.env.PASSWORD_SERVICE_TOKEN = env.PASSWORD_SERVICE_TOKEN ?? "";
  process.env.ANATHAS_API_KEY = env.ANATHAS_API_KEY ?? "";
  process.env.ANATHAS_API_BASE_URL = env.ANATHAS_API_BASE_URL ?? "https://www.anathas.com/api/v2";
  process.env.ANATHAS_TIMEZONE = env.ANATHAS_TIMEZONE ?? "Europe/Paris";
  process.env.ANATHAS_SNAPSHOT_POLL_MS = env.ANATHAS_SNAPSHOT_POLL_MS ?? "30000";
  process.env.ANATHAS_DEFAULT_AGRICULTURAL_ZONES = env.ANATHAS_DEFAULT_AGRICULTURAL_ZONES ?? "0";
  process.env.ANATHAS_DEFAULT_HABITABLE_ZONES = env.ANATHAS_DEFAULT_HABITABLE_ZONES ?? "0";
  if (env.ANATHAS_GAME_ID) process.env.ANATHAS_GAME_ID = env.ANATHAS_GAME_ID;
  else delete process.env.ANATHAS_GAME_ID;
}

async function startApiServer(env: CloudflareEnv): Promise<void> {
  applyWorkerEnvironment(env);
  const { app } = await import("./app.js");
  app.listen(API_PORT);
}

async function ensureApiServer(env: CloudflareEnv): Promise<void> {
  if (!apiServerPromise) {
    apiServerPromise = startApiServer(env);
  }

  try {
    await apiServerPromise;
  } catch (error) {
    // Autorise une nouvelle tentative si l'initialisation du serveur échoue.
    apiServerPromise = null;
    throw error;
  }
}

export default {
  async fetch(request: Request, env: CloudflareEnv, _ctx: WorkerExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const isApiRequest = url.pathname === "/api" || url.pathname.startsWith("/api/");
    if (!isApiRequest) return env.ASSETS.fetch(request);

    if (url.pathname === "/api/auth/login" && request.method === "POST") {
      const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
      const { success } = await env.LOGIN_RATE_LIMITER.limit({ key: `login:${ip}` });
      if (!success) {
        return Response.json(
          { error: "Trop de tentatives de connexion. Réessaie dans une minute." },
          {
            status: 429,
            headers: {
              "Cache-Control": "no-store",
              "Access-Control-Allow-Origin": env.WEB_ORIGIN,
              "Access-Control-Allow-Credentials": "true",
              Vary: "Origin",
            },
          },
        );
      }
    }

    await ensureApiServer(env);
    const { withFreshPool } = await import("./db.js");

    // API Cloudflare directe et documentée : elle route la requête Worker
    // vers le serveur Node/Express qui écoute sur API_PORT.
    return withFreshPool(() => handleAsNodeRequest(API_PORT, request));
  },

  async scheduled(_controller: WorkerScheduledController, env: CloudflareEnv, _ctx: WorkerExecutionContext): Promise<void> {
    applyWorkerEnvironment(env);
    const { withFreshPool, pool } = await import("./db.js");
    await withFreshPool(async () => {
      const { schedulerTick } = await import("./services/anathas-snapshot.service.js");
      await schedulerTick();

      // connect-pg-simple n'utilise pas de timer de purge dans un Worker.
      // Le Cron supprime donc périodiquement les sessions déjà expirées.
      try {
        const result = await pool.query("DELETE FROM public.user_sessions WHERE expire < now()::timestamp");
        if ((result.rowCount ?? 0) > 0) {
          console.info(`[Sessions] ${result.rowCount} session(s) expirée(s) supprimée(s).`);
        }
      } catch (error) {
        // La purge ne doit pas empêcher les captures Anathas ni faire échouer le Cron.
        console.error("[Sessions] Impossible de purger les sessions expirées.", error);
      }
    });
  },
};
