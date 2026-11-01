import { AsyncLocalStorage } from "node:async_hooks";
import pg from "pg";
import { config } from "./config.js";

const { Pool } = pg;
type PgPool = InstanceType<typeof Pool>;

const poolContext = new AsyncLocalStorage<PgPool>();
const configuredPoolSize = Number(process.env.PG_POOL_MAX ?? 10);
const maxPoolSize = Number.isFinite(configuredPoolSize)
  ? Math.max(1, Math.min(10, Math.floor(configuredPoolSize)))
  : 10;

function createPoolInstance(): PgPool {
  return new Pool({
    connectionString: config.databaseUrl,
    max: maxPoolSize,
  });
}

// En environnement Node classique, le serveur et les scripts CLI conservent
// un pool partagé. Dans un Worker, chaque requête utilise son propre pool local
// (Hyperdrive mutualise les connexions vers PostgreSQL sous-jacent).
let defaultPool: PgPool | null = null;

function getCurrentPool(): PgPool {
  const scopedPool = poolContext.getStore();
  if (scopedPool) return scopedPool;

  if (process.env.WORKER_RUNTIME === "cloudflare") {
    throw new Error("Accès PostgreSQL hors du contexte d'une requête Cloudflare.");
  }

  if (!defaultPool) defaultPool = createPoolInstance();
  return defaultPool;
}

export async function withFreshPool<T>(callback: () => Promise<T>): Promise<T> {
  const scopedPool = createPoolInstance();
  try {
    return await poolContext.run(scopedPool, callback);
  } finally {
    await scopedPool.end();
  }
}

// Proxy conservant l'interface Pool déjà utilisée par les repositories et
// connect-pg-simple, tout en résolvant le pool correspondant à la requête.
export const pool = new Proxy({} as PgPool, {
  get(_target, property) {
    const currentPool = getCurrentPool();
    const value = Reflect.get(currentPool, property, currentPool) as unknown;
    return typeof value === "function" ? value.bind(currentPool) : value;
  },
});

export async function query<T extends pg.QueryResultRow>(
  text: string,
  values: unknown[] = []
): Promise<T[]> {
  const result = await getCurrentPool().query<T>(text, values);
  return result.rows;
}
