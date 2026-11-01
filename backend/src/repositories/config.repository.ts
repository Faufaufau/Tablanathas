import type { PoolClient } from "pg";
import { pool } from "../db.js";

export type EconomicParameters = {
  mixed_agriculture_industry_agriculture_population_pct: number;
  mixed_agriculture_industry_industry_population_pct: number;
  military_industry_population_pct: number;
  military_commerce_population_pct: number;
  militarized_agro_industry_agriculture_population_pct: number;
  militarized_agro_industry_industry_population_pct: number;
  custom_scenario_enabled: boolean;
  custom_scenario_name: string;
  custom_agriculture_population_pct: number;
  custom_industry_population_pct: number;
  custom_commerce_population_pct: number;
};

export type PersonalSettings = {
  default_agricultural_zones_pct: number;
  default_habitable_zones_pct: number;
  default_industrial_zones_pct: number;
  default_commercial_zones_pct: number;
  population_in_economy_pct: number;
  default_budget_200_enabled: boolean;
  default_dense_residential_zones_enabled: boolean;
  default_social_integration_pact_enabled: boolean;
  default_reduced_holidays_enabled: boolean;
  default_forest_exploitation_enabled: boolean;
  default_industrial_zone_housing_enabled: boolean;
};

const DEFAULT_ECONOMIC_PARAMETERS: EconomicParameters = {
  mixed_agriculture_industry_agriculture_population_pct: 70,
  mixed_agriculture_industry_industry_population_pct: 30,
  military_industry_population_pct: 30,
  military_commerce_population_pct: 70,
  militarized_agro_industry_agriculture_population_pct: 70,
  militarized_agro_industry_industry_population_pct: 30,
  custom_scenario_enabled: false,
  custom_scenario_name: "Scénario personnalisé",
  custom_agriculture_population_pct: 33.33333,
  custom_industry_population_pct: 33.33333,
  custom_commerce_population_pct: 33.33334,
};

async function resolveGameId(client: PoolClient, preferredGameId?: string): Promise<string> {
  if (preferredGameId) return preferredGameId;
  const result = await client.query<{ game_id: string | null }>(
    `SELECT COALESCE(
       (SELECT game_id FROM public.anathas_game_state WHERE singleton = true),
       (SELECT game_id FROM public.games ORDER BY game_id LIMIT 1)
     ) AS game_id`,
  );
  const gameId = result.rows[0]?.game_id;
  if (!gameId) throw new Error("Aucune partie n'est configurée dans public.games.");
  return gameId;
}

async function ensureUserContext(client: PoolClient, userId: string, preferredGameId?: string) {
  const gameId = await resolveGameId(client, preferredGameId);
  await client.query(
    `INSERT INTO public.user_game_settings (user_id, game_id)
     VALUES ($1, $2) ON CONFLICT (user_id, game_id) DO NOTHING`,
    [userId, gameId],
  );
  // Verrouille la ligne de réglages de cette partie pour sérialiser la création
  // du scénario par défaut et le respect de la limite de 20 scénarios.
  await client.query(
    `SELECT 1 FROM public.user_game_settings
     WHERE user_id = $1 AND game_id = $2 FOR UPDATE`,
    [userId, gameId],
  );

  const defaultResult = await client.query<{ scenario_id: string }>(
    `SELECT scenario_id FROM public.user_scenarios
     WHERE user_id = $1 AND game_id = $2 AND is_default = true
     LIMIT 1`,
    [userId, gameId],
  );
  if (!defaultResult.rowCount) {
    const anyScenario = await client.query<{ scenario_id: string }>(
      `SELECT scenario_id FROM public.user_scenarios
       WHERE user_id = $1 AND game_id = $2 ORDER BY scenario_id LIMIT 1`,
      [userId, gameId],
    );
    if (anyScenario.rowCount) {
      await client.query(
        `UPDATE public.user_scenarios SET is_default = (scenario_id = $3), updated_at = now()
         WHERE user_id = $1 AND game_id = $2`,
        [userId, gameId, anyScenario.rows[0].scenario_id],
      );
    } else {
      await client.query(
        `INSERT INTO public.user_scenarios (user_id, game_id, scenario_name, description, is_default)
         VALUES ($1, $2, 'Par défaut', 'Scénario personnel de référence', true)`,
        [userId, gameId],
      );
    }
  }
  return gameId;
}

export async function getUserConfig(userId: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const gameId = await ensureUserContext(client, userId);
    const settingsResult = await client.query(
      `SELECT default_agricultural_zones_pct, default_habitable_zones_pct,
              default_industrial_zones_pct, default_commercial_zones_pct,
              population_in_economy_pct, default_budget_200_enabled, default_dense_residential_zones_enabled,
              default_social_integration_pact_enabled, default_reduced_holidays_enabled,
              default_forest_exploitation_enabled, default_industrial_zone_housing_enabled, updated_at
       FROM public.user_game_settings WHERE user_id = $1 AND game_id = $2`,
      [userId, gameId],
    );
    const scenarioResult = await client.query(
      `SELECT s.scenario_id, s.game_id, s.scenario_name, s.description, s.is_default,
              s.created_at, s.updated_at,
              p.mixed_agriculture_industry_agriculture_population_pct,
              p.mixed_agriculture_industry_industry_population_pct,
              p.military_industry_population_pct,
              p.military_commerce_population_pct,
              p.militarized_agro_industry_agriculture_population_pct,
              p.militarized_agro_industry_industry_population_pct,
              p.custom_scenario_enabled,
              p.custom_scenario_name,
              p.custom_agriculture_population_pct,
              p.custom_industry_population_pct,
              p.custom_commerce_population_pct
       FROM public.user_scenarios s
       LEFT JOIN public.user_scenario_economic_parameters p USING (scenario_id)
       WHERE s.user_id = $1 AND s.game_id = $2
       ORDER BY s.is_default DESC, s.scenario_name`,
      [userId, gameId],
    );
    await client.query("COMMIT");
    return {
      game_id: gameId,
      settings: settingsResult.rows[0],
      scenarios: scenarioResult.rows.map((scenario) => ({
        scenario_id: scenario.scenario_id,
        game_id: scenario.game_id,
        scenario_name: scenario.scenario_name,
        description: scenario.description,
        is_default: scenario.is_default,
        created_at: scenario.created_at,
        updated_at: scenario.updated_at,
        parameters: Object.fromEntries(
          Object.keys(DEFAULT_ECONOMIC_PARAMETERS).map((key) => [
            key,
            scenario[key] ?? DEFAULT_ECONOMIC_PARAMETERS[key as keyof EconomicParameters],
          ]),
        ),
      })),
      max_scenarios: 20,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function updateUserSettings(userId: string, settings: PersonalSettings) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const gameId = await ensureUserContext(client, userId);
    const result = await client.query(
      `UPDATE public.user_game_settings
       SET default_agricultural_zones_pct = $3,
           default_habitable_zones_pct = $4,
           default_industrial_zones_pct = $5,
           default_commercial_zones_pct = $6,
           population_in_economy_pct = $7,
           default_budget_200_enabled = $8,
           default_budget_multiplier_200 = CASE WHEN $8 THEN 1.15 ELSE 1.0 END,
           default_dense_residential_zones_enabled = $9,
           default_social_integration_pact_enabled = $10,
           default_reduced_holidays_enabled = $11,
           default_forest_exploitation_enabled = $12,
           default_industrial_zone_housing_enabled = $13,
           updated_at = now()
       WHERE user_id = $1 AND game_id = $2
       RETURNING default_agricultural_zones_pct, default_habitable_zones_pct,
                 default_industrial_zones_pct, default_commercial_zones_pct,
                 population_in_economy_pct, default_budget_200_enabled, default_dense_residential_zones_enabled,
                 default_social_integration_pact_enabled, default_reduced_holidays_enabled,
                 default_forest_exploitation_enabled, default_industrial_zone_housing_enabled, updated_at`,
      [userId, gameId, settings.default_agricultural_zones_pct, settings.default_habitable_zones_pct,
        settings.default_industrial_zones_pct, settings.default_commercial_zones_pct, settings.population_in_economy_pct,
        settings.default_budget_200_enabled, settings.default_dense_residential_zones_enabled,
        settings.default_social_integration_pact_enabled, settings.default_reduced_holidays_enabled,
        settings.default_forest_exploitation_enabled, settings.default_industrial_zone_housing_enabled],
    );
    await client.query("COMMIT");
    return result.rows[0];
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function createScenario(
  userId: string,
  input: { scenario_name: string; description: string | null; parameters: EconomicParameters },
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const gameId = await ensureUserContext(client, userId);
    const countResult = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM public.user_scenarios WHERE user_id = $1 AND game_id = $2`,
      [userId, gameId],
    );
    if (Number(countResult.rows[0]?.count ?? 0) >= 20) {
      throw Object.assign(new Error("La limite de 20 scénarios par partie est atteinte."), { statusCode: 409 });
    }
    const insert = await client.query<{ scenario_id: string }>(
      `INSERT INTO public.user_scenarios (user_id, game_id, scenario_name, description, is_default)
       VALUES ($1, $2, $3, $4, false) RETURNING scenario_id`,
      [userId, gameId, input.scenario_name.trim(), input.description?.trim() || null],
    );
    const scenarioId = insert.rows[0].scenario_id;
    await client.query(
      `UPDATE public.user_scenario_economic_parameters SET
         mixed_agriculture_industry_agriculture_population_pct = $2,
         mixed_agriculture_industry_industry_population_pct = $3,
         military_industry_population_pct = $4,
         military_commerce_population_pct = $5,
         militarized_agro_industry_agriculture_population_pct = $6,
         militarized_agro_industry_industry_population_pct = $7,
         custom_scenario_enabled = $8,
         custom_scenario_name = $9,
         custom_agriculture_population_pct = $10,
         custom_industry_population_pct = $11,
         custom_commerce_population_pct = $12,
         updated_at = now()
       WHERE scenario_id = $1`,
      [
        scenarioId,
        input.parameters.mixed_agriculture_industry_agriculture_population_pct,
        input.parameters.mixed_agriculture_industry_industry_population_pct,
        input.parameters.military_industry_population_pct,
        input.parameters.military_commerce_population_pct,
        input.parameters.militarized_agro_industry_agriculture_population_pct,
        input.parameters.militarized_agro_industry_industry_population_pct,
        input.parameters.custom_scenario_enabled,
        input.parameters.custom_scenario_name.trim() || "Scénario personnalisé",
        input.parameters.custom_agriculture_population_pct,
        input.parameters.custom_industry_population_pct,
        input.parameters.custom_commerce_population_pct,
      ],
    );
    await client.query("COMMIT");
    return { scenario_id: scenarioId, game_id: gameId };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function updateScenario(
  userId: string,
  scenarioId: string,
  input: { scenario_name: string; description: string | null; parameters: EconomicParameters },
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const scenario = await client.query<{ scenario_id: string }>(
      `UPDATE public.user_scenarios SET scenario_name = $3, description = $4, updated_at = now()
       WHERE scenario_id = $1 AND user_id = $2 RETURNING scenario_id`,
      [scenarioId, userId, input.scenario_name.trim(), input.description?.trim() || null],
    );
    if (!scenario.rowCount) throw Object.assign(new Error("Scénario introuvable."), { statusCode: 404 });
    await client.query(
      `UPDATE public.user_scenario_economic_parameters SET
         mixed_agriculture_industry_agriculture_population_pct = $2,
         mixed_agriculture_industry_industry_population_pct = $3,
         military_industry_population_pct = $4,
         military_commerce_population_pct = $5,
         militarized_agro_industry_agriculture_population_pct = $6,
         militarized_agro_industry_industry_population_pct = $7,
         custom_scenario_enabled = $8,
         custom_scenario_name = $9,
         custom_agriculture_population_pct = $10,
         custom_industry_population_pct = $11,
         custom_commerce_population_pct = $12,
         updated_at = now()
       WHERE scenario_id = $1`,
      [
        scenarioId,
        input.parameters.mixed_agriculture_industry_agriculture_population_pct,
        input.parameters.mixed_agriculture_industry_industry_population_pct,
        input.parameters.military_industry_population_pct,
        input.parameters.military_commerce_population_pct,
        input.parameters.militarized_agro_industry_agriculture_population_pct,
        input.parameters.militarized_agro_industry_industry_population_pct,
        input.parameters.custom_scenario_enabled,
        input.parameters.custom_scenario_name.trim() || "Scénario personnalisé",
        input.parameters.custom_agriculture_population_pct,
        input.parameters.custom_industry_population_pct,
        input.parameters.custom_commerce_population_pct,
      ],
    );
    await client.query("COMMIT");
    return { scenario_id: scenarioId };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function setDefaultScenario(userId: string, scenarioId: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const scenario = await client.query<{ game_id: string }>(
      `SELECT game_id FROM public.user_scenarios WHERE scenario_id = $1 AND user_id = $2 FOR UPDATE`,
      [scenarioId, userId],
    );
    if (!scenario.rowCount) throw Object.assign(new Error("Scénario introuvable."), { statusCode: 404 });
    await client.query(
      `UPDATE public.user_scenarios SET is_default = false, updated_at = now()
       WHERE user_id = $1 AND game_id = $2`,
      [userId, scenario.rows[0].game_id],
    );
    await client.query(
      `UPDATE public.user_scenarios SET is_default = true, updated_at = now()
       WHERE scenario_id = $1 AND user_id = $2`,
      [scenarioId, userId],
    );
    await client.query("COMMIT");
    return { scenario_id: scenarioId, is_default: true };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteScenario(userId: string, scenarioId: string) {
  const result = await pool.query(
    `DELETE FROM public.user_scenarios
     WHERE scenario_id = $1 AND user_id = $2 AND is_default = false
     RETURNING scenario_id`,
    [scenarioId, userId],
  );
  if (!result.rowCount) {
    throw Object.assign(new Error("Scénario introuvable ou scénario par défaut : définis d'abord un autre scénario par défaut."), { statusCode: 409 });
  }
  return { scenario_id: scenarioId, deleted: true };
}

export async function getPlayerDetail(userId: string, playerId: string, requestedTurn?: number, requestedScenarioId?: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const playerResult = await client.query(
      `SELECT p.player_id, p.player_name, p.external_player_id,
              s.game_id, s.game_turn, s.seniority_turns, s.research_points,
              s.agriculture_tech, s.industry_tech, s.commerce_tech, s.population,
              s.education_primary_pct, s.education_secondary_pct, s.education_higher_pct,
              s.total_zones, s.habitable_zones, s.agricultural_zones, s.pollution,
              s.gms_multiplier, s.science_wonder_multiplier, s.research_funding_multiplier,
              s.gmh_multiplier, s.economic_wonder_multiplier,
              s.rank, s.score, s.happiness, s.land_size, s.habitable_regions, s.carbon_credits,
              s.education_primary_ratio, s.education_secondary_ratio, s.education_higher_ratio,
              s.wonder_type, s.wonder_score, s.military_status, s.military_victories, s.military_defeats,
              s.research_budget_estimate_billion
       FROM public.players p
       JOIN LATERAL (
         SELECT pts.* FROM public.player_turn_state pts
         WHERE pts.player_id = p.player_id
           AND ($2::integer IS NULL OR pts.game_turn = $2)
         ORDER BY pts.game_turn DESC LIMIT 1
       ) s ON true
       WHERE p.player_id = $1
       LIMIT 1`,
      [playerId, requestedTurn ?? null],
    );
    if (!playerResult.rowCount) throw Object.assign(new Error("Joueur ou tour introuvable."), { statusCode: 404 });
    const player = playerResult.rows[0];
    const gameId = String(player.game_id);
    await ensureUserContext(client, userId, gameId);
    let scenarioId: string | null = null;
    if (requestedScenarioId) {
      const chosenScenario = await client.query<{ scenario_id: string }>(
        `SELECT scenario_id FROM public.user_scenarios
         WHERE scenario_id = $1 AND user_id = $2 AND game_id = $3 LIMIT 1`,
        [requestedScenarioId, userId, gameId],
      );
      if (!chosenScenario.rowCount) throw Object.assign(new Error("Scénario introuvable pour cette partie."), { statusCode: 403 });
      scenarioId = chosenScenario.rows[0].scenario_id;
    } else {
      const defaultScenario = await client.query<{ scenario_id: string }>(
        `SELECT scenario_id FROM public.user_scenarios
         WHERE user_id = $1 AND game_id = $2 AND is_default = true LIMIT 1`,
        [userId, gameId],
      );
      scenarioId = defaultScenario.rows[0]?.scenario_id ?? null;
    }
    const snapshotResult = await client.query(
      `SELECT c.*, r.game_turn AS snapshot_game_turn, r.snapshot_phase,
              r.scheduled_local_at, r.completed_at
       FROM public.anathas_country_snapshots c
       JOIN public.anathas_snapshot_runs r ON r.snapshot_id = c.snapshot_id
       WHERE c.country_id::text = $1::text
         AND r.game_turn = $2
         AND r.status = 'completed'
       ORDER BY r.completed_at DESC NULLS LAST, c.snapshot_id DESC
       LIMIT 1`,
      [player.external_player_id == null ? "" : String(player.external_player_id), player.game_turn],
    );
    const snapshot = snapshotResult.rows[0] ?? null;
    let scoreModel = null;
    if (snapshot?.snapshot_id != null && snapshot.score != null) {
      const scoreModelResult = await client.query(
        `WITH source AS (
           SELECT c.score::numeric AS actual_score,
                  c.population::numeric AS population,
                  c.land_size::numeric AS land_size,
                  c.agriculture_tech::numeric AS agriculture_tech,
                  c.industry_tech::numeric AS industry_tech,
                  c.commerce_tech::numeric AS commerce_tech,
                  COALESCE(c.wonder_score, 0)::numeric AS wonder_score,
                  COALESCE(c.military_victories, 0)::numeric AS victories,
                  COALESCE(c.military_defeats, 0)::numeric AS defeats
           FROM public.anathas_country_snapshots c
           WHERE c.snapshot_id = $1
             AND c.country_id::text = $2::text
             AND c.score IS NOT NULL AND c.score > 0
             AND c.population IS NOT NULL
             AND c.land_size IS NOT NULL
             AND c.agriculture_tech IS NOT NULL
             AND c.industry_tech IS NOT NULL
             AND c.commerce_tech IS NOT NULL
         ), base AS (
           SELECT source.*,
                  GREATEST(0.5::numeric, 1::numeric + 0.025::numeric * (victories - defeats)) AS victory_defeat_ratio,
                  GREATEST(0::numeric, 4000::numeric * (land_size - 270000::numeric))
                    + 0.5::numeric * population
                    + 600000::numeric * agriculture_tech
                    + 1200000::numeric * industry_tech
                    + 3000000::numeric * commerce_tech
                    + 100000::numeric * wonder_score AS potential_without_tech_sup
           FROM source
         ), inverse AS (
           SELECT base.*,
                  ((500000::numeric + 20000::numeric * POWER(actual_score * 1000::numeric, 0.25::numeric))
                    / NULLIF(victory_defeat_ratio, 0)) AS potential_required_by_real_score
           FROM base
         ), estimate AS (
           SELECT inverse.*,
                  ((potential_required_by_real_score - potential_without_tech_sup) / 10000000::numeric) AS inferred_tech_sup_raw
           FROM inverse
         ), candidates AS (
           SELECT estimate.*,
                  GREATEST(0::numeric, FLOOR(inferred_tech_sup_raw)) AS lower_tech_sup_level,
                  GREATEST(0::numeric, CEIL(inferred_tech_sup_raw)) AS upper_tech_sup_level
           FROM estimate
         ), candidate_scores AS (
           SELECT candidates.*,
             ROUND(GREATEST(1::numeric,
               POWER(GREATEST(1::numeric,
                 (potential_without_tech_sup + 10000000::numeric * lower_tech_sup_level)
                   * victory_defeat_ratio - 500000::numeric) / 20000::numeric, 4::numeric) / 1000::numeric
             )) AS lower_candidate_score,
             ROUND(GREATEST(1::numeric,
               POWER(GREATEST(1::numeric,
                 (potential_without_tech_sup + 10000000::numeric * upper_tech_sup_level)
                   * victory_defeat_ratio - 500000::numeric) / 20000::numeric, 4::numeric) / 1000::numeric
             )) AS upper_candidate_score
           FROM candidates
         ), chosen_level AS (
           SELECT candidate_scores.*,
             CASE
               WHEN ABS(lower_candidate_score - actual_score) <= ABS(upper_candidate_score - actual_score)
                 THEN lower_tech_sup_level
               ELSE upper_tech_sup_level
             END AS tech_sup_level
           FROM candidate_scores
         ), score_calc AS (
           SELECT chosen_level.*,
                  potential_without_tech_sup + 10000000::numeric * tech_sup_level AS calculated_potential,
                  ROUND(GREATEST(
                    1::numeric,
                    POWER(GREATEST(1::numeric,
                      (potential_without_tech_sup + 10000000::numeric * tech_sup_level)
                        * victory_defeat_ratio - 500000::numeric) / 20000::numeric, 4::numeric) / 1000::numeric
                  )) AS calculated_score
           FROM chosen_level
         )
         SELECT actual_score::text AS actual_score,
                victory_defeat_ratio::text AS victory_defeat_ratio,
                potential_without_tech_sup::text AS potential_without_tech_sup,
                potential_required_by_real_score::text AS potential_required_by_real_score,
                inferred_tech_sup_raw::text AS inferred_tech_sup_raw,
                tech_sup_level::text AS tech_sup_level,
                calculated_potential::text AS calculated_potential,
                calculated_score::text AS calculated_score,
                (calculated_score - actual_score)::text AS score_difference,
                CASE WHEN actual_score <> 0
                  THEN (100::numeric * (calculated_score - actual_score) / actual_score)::text
                  ELSE NULL END AS score_difference_percent
         FROM score_calc`,
        [snapshot.snapshot_id, String(player.external_player_id ?? "")],
      );
      scoreModel = scoreModelResult.rows[0] ?? null;
    }

    let override = null;
    if (scenarioId) {
      const overrideResult = await client.query(
        `SELECT agricultural_zones, habitable_zones, industrial_zones, commercial_zones, budget_200_enabled,
                dense_residential_zones_enabled, social_integration_pact_enabled, reduced_holidays_enabled,
                forest_exploitation_enabled, industrial_zone_housing_enabled, updated_at
         FROM public.user_scenario_player_overrides
         WHERE scenario_id = $1 AND game_id = $2 AND player_id = $3 AND base_game_turn = $4`,
        [scenarioId, gameId, playerId, player.game_turn],
      );
      override = overrideResult.rows[0] ?? null;
    }
    const settingsResult = await client.query(
      `SELECT default_agricultural_zones_pct, default_habitable_zones_pct, default_industrial_zones_pct, default_commercial_zones_pct,
              population_in_economy_pct,
              default_budget_200_enabled, default_dense_residential_zones_enabled,
              default_social_integration_pact_enabled, default_reduced_holidays_enabled,
              default_forest_exploitation_enabled, default_industrial_zone_housing_enabled
       FROM public.user_game_settings WHERE user_id = $1 AND game_id = $2`,
      [userId, gameId],
    );
    await client.query("COMMIT");
    return {
      player,
      snapshot,
      score_model: scoreModel,
      game_turn: player.game_turn,
      scenario_id: scenarioId,
      settings: settingsResult.rows[0] ?? null,
      override,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function savePlayerOverrides(
  userId: string,
  playerId: string,
  input: {
    game_turn: number;
    scenario_id: string;
    agricultural_zones: number;
    habitable_zones: number;
    industrial_zones: number;
    commercial_zones: number;
    budget_200_enabled: boolean;
    dense_residential_zones_enabled: boolean;
    social_integration_pact_enabled: boolean;
    reduced_holidays_enabled: boolean;
    forest_exploitation_enabled: boolean;
    industrial_zone_housing_enabled: boolean;
  },
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const state = await client.query<{ game_id: string; habitable_regions: string | number | null; total_zones: string | number | null }>(
      `SELECT game_id, habitable_regions, total_zones
       FROM public.player_turn_state WHERE player_id = $1 AND game_turn = $2 LIMIT 1`,
      [playerId, input.game_turn],
    );
    if (!state.rowCount) throw Object.assign(new Error("Aucun état joueur enregistré pour ce tour."), { statusCode: 404 });
    const stateRow = state.rows[0];
    const habitableRegions = Number(stateRow.habitable_regions);
    const storedTotalZones = Number(stateRow.total_zones);
    const availableZones = Number.isFinite(habitableRegions) && stateRow.habitable_regions !== null
      ? Math.max(0, Math.floor(habitableRegions / 20_000))
      : Number.isFinite(storedTotalZones) ? Math.max(0, Math.floor(storedTotalZones)) : 0;
    const requestedZones = input.habitable_zones + input.agricultural_zones + input.industrial_zones + input.commercial_zones;
    if (requestedZones > availableZones) {
      throw Object.assign(
        new Error(`La répartition compte ${requestedZones.toLocaleString("fr-FR")} zones, mais ce joueur ne dispose que de ${availableZones.toLocaleString("fr-FR")} zones au total (floor(habitable_regions / 20 000)).`),
        { statusCode: 400 },
      );
    }
    const gameId = stateRow.game_id;
    const scenario = await client.query(
      `SELECT 1 FROM public.user_scenarios
       WHERE scenario_id = $1 AND user_id = $2 AND game_id = $3`,
      [input.scenario_id, userId, gameId],
    );
    if (!scenario.rowCount) throw Object.assign(new Error("Le scénario ne t'appartient pas ou concerne une autre partie."), { statusCode: 403 });
    const result = await client.query(
      `INSERT INTO public.user_scenario_player_overrides
         (scenario_id, game_id, player_id, base_game_turn, agricultural_zones, habitable_zones, industrial_zones, commercial_zones,
          budget_multiplier_200, budget_200_enabled, dense_residential_zones_enabled, social_integration_pact_enabled,
          reduced_holidays_enabled, forest_exploitation_enabled, industrial_zone_housing_enabled, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CASE WHEN $9 THEN 1.15 ELSE 1.0 END, $9, $10, $11, $12, $13, $14, now())
       ON CONFLICT (scenario_id, game_id, player_id, base_game_turn)
       DO UPDATE SET agricultural_zones = EXCLUDED.agricultural_zones,
                     habitable_zones = EXCLUDED.habitable_zones,
                     industrial_zones = EXCLUDED.industrial_zones,
                     commercial_zones = EXCLUDED.commercial_zones,
                     budget_multiplier_200 = EXCLUDED.budget_multiplier_200,
                     budget_200_enabled = EXCLUDED.budget_200_enabled,
                     dense_residential_zones_enabled = EXCLUDED.dense_residential_zones_enabled,
                     social_integration_pact_enabled = EXCLUDED.social_integration_pact_enabled,
                     reduced_holidays_enabled = EXCLUDED.reduced_holidays_enabled,
                     forest_exploitation_enabled = EXCLUDED.forest_exploitation_enabled,
                     industrial_zone_housing_enabled = EXCLUDED.industrial_zone_housing_enabled,
                     updated_at = now()
       RETURNING agricultural_zones, habitable_zones, industrial_zones, commercial_zones, budget_200_enabled,
                 dense_residential_zones_enabled, social_integration_pact_enabled, reduced_holidays_enabled,
                 forest_exploitation_enabled, industrial_zone_housing_enabled, updated_at`,
      [input.scenario_id, gameId, playerId, input.game_turn, input.agricultural_zones, input.habitable_zones,
        input.industrial_zones, input.commercial_zones, input.budget_200_enabled, input.dense_residential_zones_enabled,
        input.social_integration_pact_enabled, input.reduced_holidays_enabled, input.forest_exploitation_enabled,
        input.industrial_zone_housing_enabled],
    );
    await client.query("COMMIT");
    return { game_id: gameId, game_turn: input.game_turn, scenario_id: input.scenario_id, ...result.rows[0] };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
