import { query } from "../db.js";
import { getUserConfig } from "./config.repository.js";

async function getDashboardRows(userId: string, gameTurn?: number, allTurns = false, playerIdFilter?: number, scenarioIdFilter?: string): Promise<Record<string, any>[]> {
  // Initialise le scénario et les hypothèses privés si l'utilisateur n'a encore jamais ouvert Config.
  await getUserConfig(userId);
  const rows = await query<Record<string, any>>(`
    WITH selected_scenario AS (
      SELECT s.scenario_id, s.game_id,
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
      JOIN public.user_scenario_economic_parameters p USING (scenario_id)
      WHERE s.user_id = $1
        AND (($5::bigint IS NULL AND s.is_default = true)
          OR ($5::bigint IS NOT NULL AND s.scenario_id = $5::bigint))
    ), base_source AS (
      SELECT d.*,
             GREATEST(CASE WHEN st.habitable_regions IS NOT NULL
               THEN FLOOR(GREATEST(st.habitable_regions::numeric, 0) / 20000)
               ELSE GREATEST(COALESCE(d.total_zones, 0)::numeric, 0)
             END, 0) AS calc_total_zones,
             o.agricultural_zones AS override_agricultural_zones,
             o.habitable_zones AS override_habitable_zones,
             o.industrial_zones AS override_industrial_zones,
             o.commercial_zones AS override_commercial_zones,
             COALESCE(settings.default_agricultural_zones_pct, 0) AS default_agricultural_zones_pct,
             COALESCE(settings.default_habitable_zones_pct, 0) AS default_habitable_zones_pct,
             COALESCE(settings.default_industrial_zones_pct, 0) AS default_industrial_zones_pct,
             COALESCE(settings.default_commercial_zones_pct, 0) AS default_commercial_zones_pct,
             COALESCE(settings.population_in_economy_pct, 80)::numeric AS calc_population_in_economy_pct,
             COALESCE(o.budget_200_enabled, settings.default_budget_200_enabled, false) AS calc_budget_200_enabled,
             COALESCE(o.dense_residential_zones_enabled, settings.default_dense_residential_zones_enabled, true) AS calc_dense_residential_zones_enabled,
             COALESCE(o.social_integration_pact_enabled, settings.default_social_integration_pact_enabled, false) AS calc_social_integration_pact_enabled,
             COALESCE(o.reduced_holidays_enabled, settings.default_reduced_holidays_enabled, false) AS calc_reduced_holidays_enabled,
             COALESCE(o.forest_exploitation_enabled, settings.default_forest_exploitation_enabled, false) AS calc_forest_exploitation_enabled,
             COALESCE(o.industrial_zone_housing_enabled, settings.default_industrial_zone_housing_enabled, false) AS calc_industrial_zone_housing_enabled,
             CASE WHEN COALESCE(o.reduced_holidays_enabled, settings.default_reduced_holidays_enabled, false) THEN 1.3::numeric ELSE 1.0::numeric END AS calc_industry_commerce_gross_multiplier,
             CASE WHEN COALESCE(o.forest_exploitation_enabled, settings.default_forest_exploitation_enabled, false) THEN 1.4::numeric ELSE 1.0::numeric END AS calc_forest_exploitation_multiplier,
             CASE WHEN COALESCE(o.dense_residential_zones_enabled, settings.default_dense_residential_zones_enabled, true) THEN 1.2::numeric ELSE 1.0::numeric END AS calc_dense_residential_multiplier,
             CASE WHEN COALESCE(o.social_integration_pact_enabled, settings.default_social_integration_pact_enabled, false) THEN 1.2::numeric ELSE 1.0::numeric END AS calc_social_integration_multiplier,
             CASE WHEN COALESCE(o.industrial_zone_housing_enabled, settings.default_industrial_zone_housing_enabled, false) THEN 1.4::numeric ELSE 1.0::numeric END AS calc_industrial_housing_multiplier,
             CASE WHEN COALESCE(o.budget_200_enabled, settings.default_budget_200_enabled, false)
               THEN 1.15::numeric ELSE 1.0::numeric END AS calc_budget_productivity_multiplier,
             COALESCE(
               NULLIF(st.research_budget_estimate_billion, 0),
               NULLIF(d.research_budget_estimate_billion, 0),
               NULLIF(
                 POWER(GREATEST(COALESCE(d.research_points, 0), 0), 4)
                 * POWER(GREATEST(
                     COALESCE(d.agriculture_tech, 0) * 10
                     + COALESCE(d.industry_tech, 0) * 20
                     + COALESCE(d.commerce_tech, 0) * 30, 0
                   ), 0.11) / 195000000::numeric,
                 0
               )
             ) AS calc_research_budget_estimate_billion,
             sc.scenario_id AS calc_scenario_id,
             sc.mixed_agriculture_industry_agriculture_population_pct,
             sc.mixed_agriculture_industry_industry_population_pct,
             sc.military_industry_population_pct,
             sc.military_commerce_population_pct,
             sc.militarized_agro_industry_agriculture_population_pct,
             sc.militarized_agro_industry_industry_population_pct,
             sc.custom_scenario_enabled,
             sc.custom_scenario_name,
             sc.custom_agriculture_population_pct,
             sc.custom_industry_population_pct,
             sc.custom_commerce_population_pct
      FROM public.v_player_dashboard d
      JOIN selected_scenario sc ON sc.game_id = d.game_id
       AND ($3::boolean OR (($2::integer IS NULL AND d.game_turn = d.current_game_turn)
         OR ($2::integer IS NOT NULL AND d.game_turn = $2::integer)))
      LEFT JOIN public.user_game_settings settings
        ON settings.user_id = $1 AND settings.game_id = d.game_id
      LEFT JOIN public.user_scenario_player_overrides o
        ON o.scenario_id = sc.scenario_id
       AND o.game_id = d.game_id AND o.player_id = d.player_id AND o.base_game_turn = d.game_turn
      LEFT JOIN public.player_turn_state st
        ON st.player_id = d.player_id AND st.game_id = d.game_id AND st.game_turn = d.game_turn
    ), base_habitable AS (
      SELECT b.*,
             LEAST(
               GREATEST(COALESCE(b.calc_total_zones, 0), 0)::numeric,
               GREATEST(COALESCE(
                 b.override_habitable_zones,
                 ROUND(GREATEST(COALESCE(b.calc_total_zones, 0), 0)::numeric * b.default_habitable_zones_pct / 100)
               ), 0)::numeric
             ) AS calc_habitable_zones
      FROM base_source b
    ), base_agricultural AS (
      SELECT h.*,
             LEAST(
               GREATEST(COALESCE(h.calc_total_zones, 0), 0)::numeric - h.calc_habitable_zones,
               GREATEST(COALESCE(
                 h.override_agricultural_zones,
                 ROUND(GREATEST(COALESCE(h.calc_total_zones, 0), 0)::numeric * h.default_agricultural_zones_pct / 100)
               ), 0)::numeric
             ) AS calc_agricultural_zones
      FROM base_habitable h
    ), base_industrial AS (
      SELECT a.*,
             GREATEST(
               LEAST(
                 GREATEST(COALESCE(a.calc_total_zones, 0), 0)::numeric
                   - a.calc_habitable_zones - a.calc_agricultural_zones,
                 GREATEST(COALESCE(
                   a.override_industrial_zones,
                   ROUND(GREATEST(COALESCE(a.calc_total_zones, 0), 0)::numeric * a.default_industrial_zones_pct / 100)
                 ), 0)::numeric
               ), 0
             ) AS calc_industrial_zones
      FROM base_agricultural a
    ), base AS (
      SELECT i.*,
             GREATEST(
               LEAST(
                 GREATEST(COALESCE(i.calc_total_zones, 0), 0)::numeric
                   - i.calc_habitable_zones - i.calc_agricultural_zones - i.calc_industrial_zones,
                 GREATEST(COALESCE(
                   i.override_commercial_zones,
                   ROUND(GREATEST(COALESCE(i.calc_total_zones, 0), 0)::numeric * i.default_commercial_zones_pct / 100)
                 ), 0)::numeric
               ), 0
             ) AS calc_commercial_zones
      FROM base_industrial i
    ), economics AS (
      SELECT b.*,
             GREATEST(COALESCE(b.population, 0)::numeric, 0)
               * b.calc_population_in_economy_pct / 100 AS calc_economic_population,
             (0.5 + b.calc_agricultural_zones * 0.8) AS calc_agriculture_revenue_multiplier,
             b.agriculture_gross_per_capita * b.calc_forest_exploitation_multiplier AS calc_agriculture_gross_per_capita,
             ROUND(
               b.agriculture_pollution_penalty * b.agriculture_gross_per_capita
               * b.calc_forest_exploitation_multiplier
               * (0.5 + b.calc_agricultural_zones * 0.8) * b.economic_wonder_multiplier
             ) AS calc_agriculture_net_per_capita,
             b.industry_gross_per_capita * b.calc_industry_commerce_gross_multiplier AS calc_industry_gross_per_capita,
             b.commerce_gross_per_capita * b.calc_industry_commerce_gross_multiplier AS calc_commerce_gross_per_capita,
             b.industry_net_per_capita * b.calc_industry_commerce_gross_multiplier AS calc_industry_net_per_capita,
             b.commerce_net_per_capita * b.calc_industry_commerce_gross_multiplier AS calc_commerce_net_per_capita,
             (5000000 + b.gmh_multiplier * b.calc_habitable_zones * 18000000
                * (1 + CASE WHEN b.calc_dense_residential_zones_enabled THEN 0.2::numeric ELSE 0::numeric END
                     + CASE WHEN b.calc_social_integration_pact_enabled THEN 0.2::numeric ELSE 0::numeric END)) AS calc_population_floor,
             (20000000 + b.calc_industrial_zones * 20000000 * b.calc_industrial_housing_multiplier) AS calc_industrial_population_cap,
             (5000000 + b.calc_commercial_zones * 30000000) AS calc_commercial_population_cap
      FROM base b
    ), scenario_values AS (
      -- Les scénarios mono-branche investissent toute la population retenue par le multiplicateur économique.
      SELECT e.*,
             e.calc_economic_population AS calc_agriculture_productive_population,
             LEAST(e.calc_economic_population, e.calc_industrial_population_cap) AS calc_industry_productive_population,
             LEAST(e.calc_economic_population, e.calc_commercial_population_cap) AS calc_commerce_productive_population,
             ROUND(e.calc_economic_population * e.calc_agriculture_net_per_capita / 1000000000, 1) AS calc_agriculture_scenario_billion,
             ROUND(LEAST(e.calc_economic_population, e.calc_industrial_population_cap) * e.calc_industry_net_per_capita / 1000000000, 1) AS calc_industry_scenario_billion,
             ROUND(LEAST(e.calc_economic_population, e.calc_commercial_population_cap) * e.calc_commerce_net_per_capita / 1000000000, 1) AS calc_commerce_scenario_billion
      FROM economics e
    ), mixed_values AS (
      SELECT v.*,
             ROUND((
               (v.calc_economic_population * v.mixed_agriculture_industry_agriculture_population_pct / 100) * v.calc_agriculture_net_per_capita
               + LEAST(v.calc_economic_population * v.mixed_agriculture_industry_industry_population_pct / 100, v.calc_industrial_population_cap) * v.calc_industry_net_per_capita
             ) / 1000000000, 1) AS calc_mixed_agriculture_industry_billion,
             ROUND((
               LEAST(v.calc_economic_population * v.military_industry_population_pct / 100 * 0.1, v.calc_industrial_population_cap) * v.calc_industry_net_per_capita
               + LEAST(v.calc_economic_population * v.military_commerce_population_pct / 100, v.calc_commercial_population_cap) * v.calc_commerce_net_per_capita
             ) / 1000000000, 1) AS calc_war_billion,
             ROUND((
               (v.calc_economic_population * v.militarized_agro_industry_agriculture_population_pct / 100) * v.calc_agriculture_net_per_capita
               + LEAST(v.calc_economic_population * v.militarized_agro_industry_industry_population_pct / 100 * 0.1, v.calc_industrial_population_cap) * v.calc_industry_net_per_capita
             ) / 1000000000, 1) AS calc_militarized_agro_industry_billion,
             ROUND((
               (v.calc_economic_population * v.custom_agriculture_population_pct / 100) * v.calc_agriculture_net_per_capita
               + LEAST(v.calc_economic_population * v.custom_industry_population_pct / 100, v.calc_industrial_population_cap) * v.calc_industry_net_per_capita
               + LEAST(v.calc_economic_population * v.custom_commerce_population_pct / 100, v.calc_commercial_population_cap) * v.calc_commerce_net_per_capita
             ) / 1000000000, 1) AS calc_custom_scenario_billion,
             (v.population + (v.calc_population_floor - v.population) * 0.2) AS calc_population_after_20pct_floor_move
      FROM scenario_values v
    ), economic_max AS (
      SELECT m.*,
             GREATEST(m.calc_war_billion, m.calc_militarized_agro_industry_billion,
                      m.calc_commerce_scenario_billion, m.calc_mixed_agriculture_industry_billion,
                      m.calc_industry_scenario_billion, m.calc_agriculture_scenario_billion,
                      CASE WHEN m.custom_scenario_enabled THEN m.calc_custom_scenario_billion ELSE NULL END) AS calc_max_economic_potential_billion
      FROM mixed_values m
    ), projected_cost AS (
      SELECT e.*,
             ROUND(
               e.gms_multiplier * (e.education_primary_pct / 100)
                 * (1 + POWER(e.calc_population_after_20pct_floor_move::numeric, 0.4) / 120)
               + e.gms_multiplier * (e.education_secondary_pct / 100)
                 * (5 + POWER(e.calc_population_after_20pct_floor_move::numeric, 0.5) / 230)
               + e.gms_multiplier * (e.education_higher_pct / 100)
                 * (10 + POWER(e.calc_population_after_20pct_floor_move::numeric, 0.7) / 2050)
             ) AS calc_projected_education_cost
      FROM economic_max e
    ), personalized AS (
      SELECT p.*,
             (p.research_points * p.science_wonder_multiplier * p.calc_budget_productivity_multiplier
                - p.education_cost) AS calc_next_turn_tech_production,
             ROUND(
               (p.total_tech_points
                 + p.research_points * p.science_wonder_multiplier * p.calc_budget_productivity_multiplier
                 - p.education_cost
               ) / (p.seniority_turns + 1), 1
             ) AS calc_projected_profitability,
             CASE
               -- La racine carrée n'est définie que si le budget est strictement positif
               -- et si le potentiel économique est positif ou nul. Dans les autres cas,
               -- la projection est indisponible (NULL), jamais remplacée par un faux 0.
               WHEN p.seniority_turns + 10 > 0
                 AND p.population > 0
                 AND COALESCE(p.calc_research_budget_estimate_billion, 0) > 0
                 AND p.calc_max_economic_potential_billion IS NOT NULL
                 AND p.calc_max_economic_potential_billion >= 0
               THEN ROUND(
                 (
                   p.total_tech_points + (
                     p.research_points * p.science_wonder_multiplier * p.calc_budget_productivity_multiplier
                     - p.calc_projected_education_cost
                   )
                   * SQRT(
                       GREATEST(p.calc_max_economic_potential_billion, 0)
                       / p.calc_research_budget_estimate_billion
                     )
                   * (p.population + (p.calc_population_floor - p.population) * 0.4)
                   / p.population
                   * 0.5 * 10
                 ) / (p.seniority_turns + 10), 1
               )
               ELSE NULL
             END AS calc_profitability_10_turns,
             CASE
               WHEN p.custom_scenario_enabled AND p.calc_custom_scenario_billion = p.calc_max_economic_potential_billion THEN p.custom_scenario_name
               WHEN p.calc_war_billion = p.calc_max_economic_potential_billion THEN 'Guerre (Industrie + Commerce + Complexe militaro-industriel)'
               WHEN p.calc_militarized_agro_industry_billion = p.calc_max_economic_potential_billion THEN 'Agro-industrie militarisée (Agriculture + Industrie + Complexe militaro-industriel)'
               WHEN p.calc_commerce_scenario_billion = p.calc_max_economic_potential_billion THEN 'Commerce'
               WHEN p.calc_mixed_agriculture_industry_billion = p.calc_max_economic_potential_billion THEN 'Agro-industrie (Agriculture + Industrie)'
               WHEN p.calc_industry_scenario_billion = p.calc_max_economic_potential_billion THEN 'Industrie'
               WHEN p.calc_agriculture_scenario_billion = p.calc_max_economic_potential_billion THEN 'Agriculture'
               ELSE NULL
             END AS calc_economic_best_scenario
      FROM projected_cost p
    ), ranked AS (
      SELECT p.*,
             RANK() OVER (PARTITION BY p.game_id, p.game_turn ORDER BY p.calc_projected_profitability DESC) AS calc_projected_profitability_rank,
             CASE WHEN p.calc_profitability_10_turns IS NULL THEN NULL
                  ELSE RANK() OVER (PARTITION BY p.game_id, p.game_turn ORDER BY p.calc_profitability_10_turns DESC NULLS LAST)
             END AS calc_profitability_10_turn_rank,
             RANK() OVER (PARTITION BY p.game_id, p.game_turn ORDER BY p.calc_max_economic_potential_billion DESC) AS calc_economic_potential_rank
      FROM personalized p
    )
    SELECT ranked.*, ranked.calc_research_budget_estimate_billion AS snapshot_research_budget_estimate_billion
    FROM ranked
    WHERE ($4::bigint IS NULL OR ranked.player_id = $4::bigint)
    ORDER BY ranked.game_turn, ranked.player_name
  `, [userId, gameTurn ?? null, allTurns, playerIdFilter ?? null, scenarioIdFilter ?? null]);

  return rows.map((row) => {
    const {
      snapshot_research_budget_estimate_billion,
      calc_agricultural_zones,
      calc_habitable_zones,
      calc_total_zones,
      calc_industrial_zones,
      calc_commercial_zones,
      calc_budget_200_enabled,
      calc_dense_residential_zones_enabled,
      calc_social_integration_pact_enabled,
      calc_reduced_holidays_enabled,
      calc_forest_exploitation_enabled,
      calc_industrial_zone_housing_enabled,
      calc_industry_commerce_gross_multiplier,
      calc_forest_exploitation_multiplier,
      calc_dense_residential_multiplier,
      calc_social_integration_multiplier,
      calc_industrial_housing_multiplier,
      calc_budget_productivity_multiplier,
      calc_next_turn_tech_production,
      calc_projected_profitability,
      calc_projected_profitability_rank,
      calc_research_budget_estimate_billion,
      calc_scenario_id,
      calc_agriculture_revenue_multiplier,
      calc_agriculture_gross_per_capita,
      calc_agriculture_net_per_capita,
      calc_industry_gross_per_capita,
      calc_commerce_gross_per_capita,
      calc_industry_net_per_capita,
      calc_commerce_net_per_capita,
      calc_population_floor,
      calc_industrial_population_cap,
      calc_commercial_population_cap,
      calc_custom_scenario_billion,
      calc_agriculture_scenario_billion,
      calc_industry_scenario_billion,
      calc_commerce_scenario_billion,
      calc_mixed_agriculture_industry_billion,
      calc_war_billion,
      calc_militarized_agro_industry_billion,
      calc_max_economic_potential_billion,
      calc_profitability_10_turns,
      calc_profitability_10_turn_rank,
      calc_economic_potential_rank,
      calc_economic_best_scenario,
      calc_population_after_20pct_floor_move,
      calc_projected_education_cost,
      mixed_agriculture_industry_agriculture_population_pct,
      mixed_agriculture_industry_industry_population_pct,
      military_industry_population_pct,
      military_commerce_population_pct,
      militarized_agro_industry_agriculture_population_pct,
      militarized_agro_industry_industry_population_pct,
      custom_scenario_enabled,
      custom_scenario_name,
      custom_agriculture_population_pct,
      custom_industry_population_pct,
      custom_commerce_population_pct,
      calc_agriculture_productive_population,
      calc_industry_productive_population,
      calc_commerce_productive_population,
      ...dashboard
    } = row;
    // Les deux colonnes de l'ancien modèle restent dans la vue SQL pour compatibilité,
    // mais ne font plus partie des données applicatives.
    delete dashboard.mixed_commerce_industry_scenario_billion;
    delete dashboard.military_mixed_scenario_billion;
    return {
      ...dashboard,
      game_id: row.game_id,
      game_turn: row.game_turn,
      current_game_turn: row.current_game_turn,
      player_id: row.player_id,
      player_name: row.player_name,
      total_zones: calc_total_zones,
      scenario_id: calc_scenario_id,
      budget_200_enabled: calc_budget_200_enabled,
      budget_productivity_multiplier: calc_budget_productivity_multiplier,
      next_turn_tech_production: calc_next_turn_tech_production,
      projected_profitability: calc_projected_profitability,
      projected_profitability_rank: calc_projected_profitability_rank,
      agricultural_zones: calc_agricultural_zones,
      habitable_zones: calc_habitable_zones,
      industrial_zones: calc_industrial_zones,
      commercial_zones: calc_commercial_zones,
      dense_residential_zones_enabled: calc_dense_residential_zones_enabled,
      social_integration_pact_enabled: calc_social_integration_pact_enabled,
      reduced_holidays_enabled: calc_reduced_holidays_enabled,
      forest_exploitation_enabled: calc_forest_exploitation_enabled,
      industrial_zone_housing_enabled: calc_industrial_zone_housing_enabled,
      agriculture_revenue_multiplier: calc_agriculture_revenue_multiplier,
      agriculture_gross_per_capita: calc_agriculture_gross_per_capita,
      agriculture_net_per_capita: calc_agriculture_net_per_capita,
      industry_gross_per_capita: calc_industry_gross_per_capita,
      commerce_gross_per_capita: calc_commerce_gross_per_capita,
      industry_net_per_capita: calc_industry_net_per_capita,
      commerce_net_per_capita: calc_commerce_net_per_capita,
      industry_commerce_gross_multiplier: calc_industry_commerce_gross_multiplier,
      forest_exploitation_multiplier: calc_forest_exploitation_multiplier,
      dense_residential_multiplier: calc_dense_residential_multiplier,
      social_integration_multiplier: calc_social_integration_multiplier,
      industrial_housing_multiplier: calc_industrial_housing_multiplier,
      industrial_population_cap: calc_industrial_population_cap,
      commercial_population_cap: calc_commercial_population_cap,
      agriculture_productive_population: calc_agriculture_productive_population,
      industry_productive_population: calc_industry_productive_population,
      commerce_productive_population: calc_commerce_productive_population,
      population_floor: calc_population_floor,
      agriculture_scenario_billion: calc_agriculture_scenario_billion,
      industry_scenario_billion: calc_industry_scenario_billion,
      commerce_scenario_billion: calc_commerce_scenario_billion,
      mixed_agriculture_industry_scenario_billion: calc_mixed_agriculture_industry_billion,
      war_scenario_billion: calc_war_billion,
      militarized_agro_industry_scenario_billion: calc_militarized_agro_industry_billion,
      custom_scenario_enabled,
      custom_scenario_name,
      mixed_agriculture_industry_agriculture_population_pct,
      mixed_agriculture_industry_industry_population_pct,
      military_industry_population_pct,
      military_commerce_population_pct,
      militarized_agro_industry_agriculture_population_pct,
      militarized_agro_industry_industry_population_pct,
      custom_agriculture_population_pct,
      custom_industry_population_pct,
      custom_commerce_population_pct,
      custom_economic_scenario_billion: calc_custom_scenario_billion,
      max_economic_potential_billion: calc_max_economic_potential_billion,
      profitability_10_turns: calc_profitability_10_turns,
      profitability_10_turn_rank: calc_profitability_10_turn_rank,
      economic_potential_rank: calc_economic_potential_rank,
      economic_best_scenario: calc_economic_best_scenario,
      research_budget_estimate_billion: snapshot_research_budget_estimate_billion ?? calc_research_budget_estimate_billion,
    };
  });
}


export async function getCurrentDashboard(userId: string, gameTurn?: number, scenarioId?: string) {
  return getDashboardRows(userId, gameTurn, false, undefined, scenarioId);
}



export async function getAvailableDashboardTurns(userId: string) {
  // Créé le scénario par défaut pour les nouveaux utilisateurs avant de lister leurs tours.
  await getUserConfig(userId);
  const rows = await query<{ current_turn: number | string | null; available_turns: Array<number | string> | null }>(
    `SELECT
       MAX(g.current_turn) AS current_turn,
       COALESCE(ARRAY_AGG(DISTINCT d.game_turn ORDER BY d.game_turn DESC), ARRAY[]::integer[]) AS available_turns
     FROM public.user_scenarios s
     JOIN public.v_player_dashboard d ON d.game_id = s.game_id
     JOIN public.games g ON g.game_id = d.game_id
     WHERE s.user_id = $1 AND s.is_default = true`,
    [userId],
  );
  return {
    current_turn: Number(rows[0]?.current_turn ?? 0),
    turns: (rows[0]?.available_turns ?? []).map((turn) => Number(turn)),
  };
}

export async function getTechnologyRanking() {
  return query("SELECT * FROM v_tech_ranking ORDER BY game_turn DESC, profitability_rank, player_name");
}

export async function getEconomicRanking(userId: string) {
  return getDashboardRows(userId);
}

export async function getPlayers() {
  return query(`
    SELECT
      player_id,
      player_name,
      external_player_id,
      created_at,
      updated_at
    FROM players
    ORDER BY player_name
  `);
}

export async function getPlayerHistory(userId: string, playerId: number, scenarioId?: string) {
  // Le dashboard historique est recalculé avec le scénario choisi dans Détails
  // (ou le scénario par défaut si aucun identifiant n'est fourni).
  if (scenarioId) {
    const access = await query<{ scenario_id: string }>(
      `SELECT scenario_id FROM public.user_scenarios WHERE scenario_id = $1 AND user_id = $2 LIMIT 1`,
      [scenarioId, userId],
    );
    if (!access.length) throw Object.assign(new Error("Scénario introuvable pour cet utilisateur."), { statusCode: 403 });
  }
  const personalizedRows = await getDashboardRows(userId, undefined, true, playerId, scenarioId);
  const personalizedByTurn = new Map(personalizedRows.map((row) => [`${String(row.game_id)}:${String(row.game_turn)}`, row]));
  const historyRows = await query(
    `SELECT history.*,
            state.research_budget_estimate_billion AS snapshot_research_budget_estimate_billion,
            COALESCE(state.agriculture_tech, country_snapshot.agriculture_tech) AS agriculture_tech,
            COALESCE(state.industry_tech, country_snapshot.industry_tech) AS industry_tech,
            COALESCE(state.commerce_tech, country_snapshot.commerce_tech) AS commerce_tech,
            COALESCE(state.happiness, country_snapshot.happiness) AS happiness,
            COALESCE(state.land_size, country_snapshot.land_size) AS land_size
     FROM public.v_player_history history
     LEFT JOIN public.player_turn_state state
       ON state.player_id = history.player_id
      AND state.game_id = history.game_id
      AND state.game_turn = history.game_turn
     LEFT JOIN LATERAL (
       SELECT c.agriculture_tech, c.industry_tech, c.commerce_tech, c.happiness, c.land_size
       FROM public.anathas_country_snapshots c
       JOIN public.anathas_snapshot_runs r ON r.snapshot_id = c.snapshot_id
       WHERE c.player_id = history.player_id
         AND r.game_turn = history.game_turn
         AND r.status = 'completed'
       ORDER BY c.captured_at DESC NULLS LAST, c.snapshot_id DESC
       LIMIT 1
     ) AS country_snapshot ON true
     WHERE history.player_id = $1
     ORDER BY history.game_turn`,
    [playerId]
  );
  return historyRows.map((row) => {
    const snapshotBudget = row.snapshot_research_budget_estimate_billion;
    const { snapshot_research_budget_estimate_billion: _storedBudget, ...history } = row;
    // Ne plus exposer les anciennes séries économiques conservées dans la vue historique.
    delete history.mixed_commerce_industry_scenario_billion;
    delete history.military_mixed_scenario_billion;
    const personalized = personalizedByTurn.get(`${String(row.game_id)}:${String(row.game_turn)}`);
    return {
      ...history,
      ...(personalized ?? {}),
      // Ces champs sont des données Anathas observées, pas des sorties recalculées.
      population: row.population,
      agriculture_tech: row.agriculture_tech,
      industry_tech: row.industry_tech,
      commerce_tech: row.commerce_tech,
      happiness: row.happiness,
      land_size: row.land_size,
      pollution: row.pollution,
      education_primary_pct: row.education_primary_pct,
      education_secondary_pct: row.education_secondary_pct,
      education_higher_pct: row.education_higher_pct,
      research_budget_estimate_billion: snapshotBudget ?? personalized?.research_budget_estimate_billion ?? row.research_budget_estimate_billion,
    };
  });
}

export async function getParameters() {
  return query(`
    SELECT *
    FROM v_manual_player_parameters
    ORDER BY game_turn DESC, player_name
  `);
}

export async function updateParameters(
  playerId: number,
  gameTurn: number,
  values: {
    budget_multiplier_200: number;
    agricultural_zones: number;
    habitable_zones: number;
  }
) {
  return query(
    `INSERT INTO game_player_parameters (
       game_id, player_id, game_turn,
       budget_multiplier_200,
       agricultural_zones,
       habitable_zones,
       updated_at
     )
     SELECT
       pts.game_id,
       pts.player_id,
       pts.game_turn,
       $3,
       $4,
       $5,
       now()
     FROM player_turn_state pts
     WHERE pts.player_id = $1
       AND pts.game_turn = $2
     RETURNING *`,
    [
      playerId,
      gameTurn,
      values.budget_multiplier_200,
      values.agricultural_zones,
      values.habitable_zones,
    ]
  );
}
