
export interface DashboardPlayer {
  // Identifiants
  player_id: string
  player_name: string
  game_id: string

  // Tours
  game_turn: number
  current_game_turn: number
  seniority_turns: number

  // Technologie
  budget_multiplier_200: string
  research_points: string
  agriculture_tech: string
  industry_tech: string
  commerce_tech: string
  total_tech_points: string
  tech_profitability: string
  population: string

  // Éducation et rentabilité
  education_primary_pct: string
  education_secondary_pct: string
  education_higher_pct: string
  gms_multiplier: string
  education_cost: string
  science_wonder_multiplier: string
  research_funding_multiplier: string
  next_turn_tech_production: string
  projected_profitability: string
  profitability_rank: string
  projected_profitability_rank: string
  gmh_multiplier: string
  profitability_10_turns: string | null
  profitability_10_turn_rank: string | null

  // Territoire et économie
  total_zones: number
  habitable_zones: number
  population_floor: string
  agricultural_zones: number
  industrial_zones?: number
  commercial_zones?: number
  dense_residential_zones_enabled?: boolean
  social_integration_pact_enabled?: boolean
  reduced_holidays_enabled?: boolean
  forest_exploitation_enabled?: boolean
  industrial_zone_housing_enabled?: boolean
  industry_commerce_gross_multiplier?: string
  forest_exploitation_multiplier?: string
  dense_residential_multiplier?: string
  social_integration_multiplier?: string
  industrial_housing_multiplier?: string
  industrial_population_cap?: string
  commercial_population_cap?: string
  agriculture_productive_population?: string
  industry_productive_population?: string
  commerce_productive_population?: string
  agriculture_revenue_multiplier: string
  industry_revenue_multiplier: string
  commerce_revenue_multiplier: string
  research_budget_estimate_billion: string
  pollution: string
  economic_wonder_multiplier: string
  agriculture_pollution_penalty: string

  // Agriculture
  agriculture_gross_per_capita: string
  agriculture_net_per_capita: string
  agriculture_scenario_billion: string

  // Industrie
  industry_gross_per_capita: string
  industry_net_per_capita: string
  industry_scenario_billion: string
  mixed_agriculture_industry_scenario_billion: string

  // Commerce
  commerce_gross_per_capita: string
  commerce_net_per_capita: string
  commerce_scenario_billion: string

  // Potentiel économique
  war_scenario_billion: string
  militarized_agro_industry_scenario_billion: string
  custom_scenario_enabled?: boolean
  custom_scenario_name?: string
  mixed_agriculture_industry_agriculture_population_pct?: string
  mixed_agriculture_industry_industry_population_pct?: string
  military_industry_population_pct?: string
  military_commerce_population_pct?: string
  militarized_agro_industry_agriculture_population_pct?: string
  militarized_agro_industry_industry_population_pct?: string
  custom_agriculture_population_pct?: string
  custom_industry_population_pct?: string
  custom_commerce_population_pct?: string
  custom_economic_scenario_billion?: string
  economic_best_scenario: string
  max_economic_potential_billion: string
  economic_potential_rank: string
}
