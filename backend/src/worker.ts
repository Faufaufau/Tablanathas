import { httpServerHandler } from "cloudflare:node";
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
}

interface WorkerExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

interface WorkerScheduledController {
  cron: string;
  scheduledTime: number;
}

let apiHandlerPromise: Promise<ReturnType<typeof httpServerHandler>> | null = null;

function applyWorkerEnvironment(env: CloudflareEnv): void {
  // Les modules historiques lisent leur configuration via process.env.
  // Les valeurs Cloudflare sont injectées avant leur import dynamique.
  // Wrangler définit NODE_ENV automatiquement : development avec wrangler dev,
  // production avec wrangler deploy. Ne pas le modifier depuis les bindings.
  process.env.PORT = "8787";
  process.env.DATABASE_URL = env.HYPERDRIVE.connectionString;
  process.env.PG_POOL_MAX = "5";
  process.env.WORKER_RUNTIME = "cloudflare";
  process.env.SESSION_SECRET = env.SESSION_SECRET;
  process.env.WEB_ORIGIN = env.WEB_ORIGIN;
  process.env.ANATHAS_API_KEY = env.ANATHAS_API_KEY ?? "";
  process.env.ANATHAS_API_BASE_URL = env.ANATHAS_API_BASE_URL ?? "https://www.anathas.com/api/v2";
  process.env.ANATHAS_TIMEZONE = env.ANATHAS_TIMEZONE ?? "Europe/Paris";
  process.env.ANATHAS_SNAPSHOT_POLL_MS = env.ANATHAS_SNAPSHOT_POLL_MS ?? "30000";
  process.env.ANATHAS_DEFAULT_AGRICULTURAL_ZONES = env.ANATHAS_DEFAULT_AGRICULTURAL_ZONES ?? "0";
  process.env.ANATHAS_DEFAULT_HABITABLE_ZONES = env.ANATHAS_DEFAULT_HABITABLE_ZONES ?? "0";
  if (env.ANATHAS_GAME_ID) process.env.ANATHAS_GAME_ID = env.ANATHAS_GAME_ID;
  else delete process.env.ANATHAS_GAME_ID;
}

async function createApiHandler(env: CloudflareEnv): Promise<ReturnType<typeof httpServerHandler>> {
  applyWorkerEnvironment(env);
  const { app } = await import("./app.js");
  app.listen(8787);
  return httpServerHandler({ port: 8787 });
}

async function getApiHandler(env: CloudflareEnv): Promise<ReturnType<typeof httpServerHandler>> {
  if (!apiHandlerPromise) {
    apiHandlerPromise = createApiHandler(env);
  }
  try {
    return await apiHandlerPromise;
  } catch (error) {
    apiHandlerPromise = null;
    throw error;
  }
}

export default {
  async fetch(request: Request, env: CloudflareEnv, ctx: WorkerExecutionContext): Promise<Response> {
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

    const handler = await getApiHandler(env);
    const { withFreshPool } = await import("./db.js");
    return withFreshPool(() => handler(request, env, ctx));
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
