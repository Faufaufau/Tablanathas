
export interface PlayerHistoryPoint {
  game_id: string
  game_turn: number
  player_id: string
  player_name: string
  seniority_turns: number

  research_points: string
  agriculture_tech: string | number | null
  industry_tech: string | number | null
  commerce_tech: string | number | null
  total_tech_points: string

  tech_profitability: string
  next_turn_tech_production: string
  projected_profitability: string
  profitability_10_turns: string | number | null

  population: string
  population_floor: string
  education_primary_pct: string
  education_secondary_pct: string
  education_higher_pct: string
  happiness: string | number | null
  land_size: string | number | null
  pollution: string | number | null

  max_economic_potential_billion: string
  economic_potential_rank: string
  economic_best_scenario?: string | null
  agriculture_scenario_billion?: string | number | null
  industry_scenario_billion?: string | number | null
  mixed_agriculture_industry_scenario_billion?: string | number | null
  commerce_scenario_billion?: string | number | null
  war_scenario_billion?: string | number | null
  militarized_agro_industry_scenario_billion?: string | number | null
  custom_scenario_enabled?: boolean
  custom_scenario_name?: string
  custom_economic_scenario_billion?: string | number | null
  profitability_rank: string
  projected_profitability_rank: string
  profitability_10_turn_rank: string | number | null
}
