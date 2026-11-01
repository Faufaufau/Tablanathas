import { app } from "./app.js";
import { config } from "./config.js";
import { pool } from "./db.js";
import { startAnathasSnapshotScheduler } from "./services/anathas-snapshot.service.js";

const server = app.listen(config.port, () => {
  console.log(`Tablanathas API démarrée sur le port ${config.port} (${config.nodeEnv}).`);
});
const stopSnapshotScheduler = startAnathasSnapshotScheduler();

async function shutdown(signal: string) {
  console.log(`\n${signal} reçu, arrêt du serveur...`);
  stopSnapshotScheduler();
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
