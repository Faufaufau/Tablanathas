import { Router } from "express";
import { z } from "zod";
import * as repository from "../repositories/dashboard.repository.js";
import { requireAuth } from "../middleware/require-auth.js";
import { getPlayerDetail, savePlayerOverrides } from "../repositories/config.repository.js";

export const dashboardRouter = Router();

// Toutes les données applicatives sont privées aux utilisateurs connectés.
dashboardRouter.use(requireAuth);

dashboardRouter.get("/dashboard/turns", async (req, res, next) => {
  try {
    res.json(await repository.getAvailableDashboardTurns(req.session.userId!));
  } catch (error) {
    next(error);
  }
});

dashboardRouter.get("/dashboard/current", async (req, res, next) => {
  try {
    const gameTurn = req.query.game_turn === undefined
      ? undefined
      : z.coerce.number().int().nonnegative().parse(req.query.game_turn);
    const scenarioId = req.query.scenario_id === undefined
      ? undefined
      : z.coerce.number().int().positive().transform(String).parse(req.query.scenario_id);
    res.json(await repository.getCurrentDashboard(req.session.userId!, gameTurn, scenarioId));
  } catch (error) {
    next(error);
  }
});

dashboardRouter.get("/rankings/technology", async (_req, res, next) => {
  try {
    res.json(await repository.getTechnologyRanking());
  } catch (error) {
    next(error);
  }
});

dashboardRouter.get("/rankings/economic", async (req, res, next) => {
  try {
    res.json(await repository.getEconomicRanking(req.session.userId!));
  } catch (error) {
    next(error);
  }
});

dashboardRouter.get("/players", async (_req, res, next) => {
  try {
    res.json(await repository.getPlayers());
  } catch (error) {
    next(error);
  }
});

dashboardRouter.get("/players/:id/details", async (req, res, next) => {
  try {
    const id = z.coerce.number().int().positive().transform(String).parse(req.params.id);
    const gameTurn = req.query.game_turn === undefined
      ? undefined
      : z.coerce.number().int().nonnegative().parse(req.query.game_turn);
    const scenarioId = req.query.scenario_id === undefined
      ? undefined
      : z.coerce.number().int().positive().transform(String).parse(req.query.scenario_id);
    res.setHeader("Cache-Control", "no-store");
    res.json(await getPlayerDetail(req.session.userId!, id, gameTurn, scenarioId));
  } catch (error) {
    next(error);
  }
});

dashboardRouter.put("/players/:id/overrides", async (req, res, next) => {
  try {
    const id = z.coerce.number().int().positive().transform(String).parse(req.params.id);
    const input = z.object({
      game_turn: z.coerce.number().int().nonnegative(),
      scenario_id: z.coerce.number().int().positive().transform(String),
      agricultural_zones: z.coerce.number().int().min(0).max(2_000_000),
      habitable_zones: z.coerce.number().int().min(0).max(2_000_000),
      industrial_zones: z.coerce.number().int().min(0).max(2_000_000),
      commercial_zones: z.coerce.number().int().min(0).max(2_000_000),
      budget_200_enabled: z.boolean(),
      dense_residential_zones_enabled: z.boolean(),
      social_integration_pact_enabled: z.boolean(),
      reduced_holidays_enabled: z.boolean(),
      forest_exploitation_enabled: z.boolean(),
      industrial_zone_housing_enabled: z.boolean(),
    }).parse(req.body);
    res.json({ override: await savePlayerOverrides(req.session.userId!, id, input) });
  } catch (error) {
    next(error);
  }
});

dashboardRouter.get("/players/:id/history", async (req, res, next) => {
  try {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const scenarioId = req.query.scenario_id === undefined
      ? undefined
      : z.coerce.number().int().positive().transform(String).parse(req.query.scenario_id);
    res.json(await repository.getPlayerHistory(req.session.userId!, id, scenarioId));
  } catch (error) {
    next(error);
  }
});

dashboardRouter.get("/parameters", async (_req, res, next) => {
  try {
    res.json(await repository.getParameters());
  } catch (error) {
    next(error);
  }
});

// Important : l'ancien endpoint modifiait game_player_parameters, partagé par tous.
// On le désactive jusqu'à ce que l'édition passe par user_scenarios et leurs overrides privés.
dashboardRouter.put("/parameters/:playerId", (_req, res) => {
  return res.status(410).json({
    error: "Cette modification est temporairement désactivée : les paramètres doivent être enregistrés dans un scénario privé.",
  });
});
