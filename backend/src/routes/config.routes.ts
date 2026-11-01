import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/require-auth.js";
import {
  createScenario,
  deleteScenario,
  getUserConfig,
  setDefaultScenario,
  updateScenario,
  updateUserSettings,
} from "../repositories/config.repository.js";

export const configRouter = Router();
configRouter.use(requireAuth);

const settingsSchema = z.object({
  default_agricultural_zones_pct: z.coerce.number().min(0).max(100),
  default_habitable_zones_pct: z.coerce.number().min(0).max(100),
  default_industrial_zones_pct: z.coerce.number().min(0).max(100),
  default_commercial_zones_pct: z.coerce.number().min(0).max(100),
  population_in_economy_pct: z.coerce.number().min(0).max(100),
  default_budget_200_enabled: z.boolean(),
  default_dense_residential_zones_enabled: z.boolean(),
  default_social_integration_pact_enabled: z.boolean(),
  default_reduced_holidays_enabled: z.boolean(),
  default_forest_exploitation_enabled: z.boolean(),
  default_industrial_zone_housing_enabled: z.boolean(),
}).refine((settings) => settings.default_habitable_zones_pct
  + settings.default_agricultural_zones_pct
  + settings.default_industrial_zones_pct
  + settings.default_commercial_zones_pct <= 100.000001, {
  message: "La somme des quatre pourcentages de zones ne doit pas dépasser 100 %.",
  path: ["default_habitable_zones_pct"],
});

const parametersSchema = z.object({
  mixed_agriculture_industry_agriculture_population_pct: z.coerce.number().min(0).max(100),
  mixed_agriculture_industry_industry_population_pct: z.coerce.number().min(0).max(100),
  military_industry_population_pct: z.coerce.number().min(0).max(100),
  military_commerce_population_pct: z.coerce.number().min(0).max(100),
  militarized_agro_industry_agriculture_population_pct: z.coerce.number().min(0).max(100),
  militarized_agro_industry_industry_population_pct: z.coerce.number().min(0).max(100),
  custom_scenario_enabled: z.boolean(),
  custom_scenario_name: z.string().trim().min(1).max(80),
  custom_agriculture_population_pct: z.coerce.number().min(0).max(100),
  custom_industry_population_pct: z.coerce.number().min(0).max(100),
  custom_commerce_population_pct: z.coerce.number().min(0).max(100),
})
  .refine((p) => Math.abs(p.mixed_agriculture_industry_agriculture_population_pct
    + p.mixed_agriculture_industry_industry_population_pct - 100) <= 0.00001, {
    message: "Le scénario Agro-industrie doit répartir exactement 100 % de la population investie en économie.",
    path: ["mixed_agriculture_industry_agriculture_population_pct"],
  })
  .refine((p) => Math.abs(p.military_industry_population_pct + p.military_commerce_population_pct - 100) <= 0.00001, {
    message: "Le scénario Guerre doit répartir exactement 100 % de la population investie en économie.",
    path: ["military_industry_population_pct"],
  })
  .refine((p) => Math.abs(p.militarized_agro_industry_agriculture_population_pct
    + p.militarized_agro_industry_industry_population_pct - 100) <= 0.00001, {
    message: "Le scénario Agro-industrie militarisée doit répartir exactement 100 % de la population investie en économie.",
    path: ["militarized_agro_industry_agriculture_population_pct"],
  })
  .refine((p) => Math.abs(p.custom_agriculture_population_pct
    + p.custom_industry_population_pct + p.custom_commerce_population_pct - 100) <= 0.00001, {
    message: "Le scénario personnalisé doit répartir exactement 100 % de la population investie en économie.",
    path: ["custom_agriculture_population_pct"],
  });

const scenarioSchema = z.object({
  scenario_name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).nullable().optional(),
  parameters: parametersSchema,
});

configRouter.get("/", async (req, res, next) => {
  try {
    return res.json(await getUserConfig(req.session.userId!));
  } catch (error) {
    next(error);
  }
});

configRouter.put("/settings", async (req, res, next) => {
  try {
    const settings = settingsSchema.parse(req.body);
    return res.json({ settings: await updateUserSettings(req.session.userId!, settings) });
  } catch (error) {
    next(error);
  }
});

configRouter.post("/scenarios", async (req, res, next) => {
  try {
    const input = scenarioSchema.parse(req.body);
    const created = await createScenario(req.session.userId!, {
      ...input,
      description: input.description ?? null,
    });
    return res.status(201).json({ scenario: created });
  } catch (error) {
    next(error);
  }
});

configRouter.put("/scenarios/:scenarioId", async (req, res, next) => {
  try {
    const scenarioId = z.coerce.number().int().positive().transform(String).parse(req.params.scenarioId);
    const input = scenarioSchema.parse(req.body);
    return res.json({ scenario: await updateScenario(req.session.userId!, scenarioId, {
      ...input,
      description: input.description ?? null,
    }) });
  } catch (error) {
    next(error);
  }
});

configRouter.put("/scenarios/:scenarioId/default", async (req, res, next) => {
  try {
    const scenarioId = z.coerce.number().int().positive().transform(String).parse(req.params.scenarioId);
    return res.json({ scenario: await setDefaultScenario(req.session.userId!, scenarioId) });
  } catch (error) {
    next(error);
  }
});

configRouter.delete("/scenarios/:scenarioId", async (req, res, next) => {
  try {
    const scenarioId = z.coerce.number().int().positive().transform(String).parse(req.params.scenarioId);
    return res.json(await deleteScenario(req.session.userId!, scenarioId));
  } catch (error) {
    next(error);
  }
});
