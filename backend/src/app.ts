import express from "express";
import cors from "cors";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { config } from "./config.js";
import { pool } from "./db.js";
import { authRouter } from "./routes/auth.routes.js";
import { dashboardRouter } from "./routes/dashboard.routes.js";
import { anathasRouter } from "./routes/anathas.routes.js";
import { configRouter } from "./routes/config.routes.js";
import { adminRouter } from "./routes/admin.routes.js";
import { AnathasApiError } from "./services/anathas.service.js";

export const app = express();
const PgSession = connectPgSimple(session);

if (config.nodeEnv === "production") {
  app.set("trust proxy", 1);
}

app.use(cors({
  origin: config.webOrigin,
  credentials: true,
}));
app.use(express.json({ limit: "100kb" }));
app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
app.use(session({
  name: "tablanathas.sid",
  store: new PgSession({
    pool,
    tableName: "user_sessions",
    createTableIfMissing: false,
    pruneSessionInterval: false,
  }),
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    secure: config.nodeEnv === "production",
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
  },
}));

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "tablanathas-backend" });
});

// Seules les routes d'authentification sont accessibles sans session.
app.use("/api/auth", authRouter);
app.use("/api/admin", adminRouter);
app.use("/api/anathas", anathasRouter);
app.use("/api/config", configRouter);
app.use("/api", dashboardRouter);

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(error);
  const databaseError = typeof error === "object" && error !== null
    ? error as { code?: string; message?: string; statusCode?: number }
    : null;
  if (databaseError?.statusCode && databaseError.statusCode >= 400 && databaseError.statusCode < 600) {
    return res.status(databaseError.statusCode).json({ error: databaseError.message ?? "La requête ne peut pas être exécutée." });
  }
  if (databaseError?.code === "23505") {
    return res.status(409).json({ error: "Cette valeur existe déjà. Vérifie notamment le nom d’utilisateur ou le nom du scénario." });
  }
  if (databaseError?.code === "23514") {
    return res.status(400).json({ error: databaseError.message ?? "Une contrainte de validation a été violée." });
  }
  if (databaseError?.code === "42P01" && databaseError.message?.includes("anathas_")) {
    return res.status(503).json({
      error: "Le schéma des captures Anathas manque. Pour une base neuve, exécute backend/sql/production-bootstrap.sql ; pour une base existante, applique les migrations incrémentales correspondant à cette version.",
    });
  }
  if (databaseError?.code === "42P01" && /user_game_settings|user_scenarios|user_scenario_economic_parameters|user_scenario_player_overrides/.test(databaseError.message ?? "")) {
    return res.status(503).json({
      error: "Le schéma des paramètres personnels manque. Initialise une base neuve avec backend/sql/production-bootstrap.sql ou applique les migrations incrémentales adaptées à la version de ta base.",
    });
  }
  if (error instanceof AnathasApiError) {
    return res.status(error.statusCode).json({ error: error.message });
  }
  if (error instanceof Error && error.name === "ZodError") {
    return res.status(400).json({ error: "Données invalides." });
  }
  return res.status(500).json({ error: "Erreur interne du serveur." });
});
