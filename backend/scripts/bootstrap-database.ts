import "dotenv/config";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  throw new Error("DATABASE_URL est obligatoire pour initialiser la base.");
}

const sqlPath = fileURLToPath(new URL("../sql/production-bootstrap.sql", import.meta.url));
const source = await readFile(sqlPath, "utf8");
// \set est une commande psql, pas une instruction SQL. Le script Node gère les erreurs
// via les exceptions du driver et envoie le reste comme un unique lot transactionnel.
const sql = source.replace(/^\\set\s+ON_ERROR_STOP\s+on\s*$/m, "");
const client = new pg.Client({ connectionString: databaseUrl });

try {
  await client.connect();
  console.log("Initialisation du schéma Tablanathas dans la base configurée...");
  await client.query(sql);
  console.log("Schéma Tablanathas initialisé. Crée ensuite le compte admin via npm run user:create.");
} catch (error) {
  console.error("Échec du bootstrap SQL. Aucune étape partielle ne doit être considérée comme déployée.");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
