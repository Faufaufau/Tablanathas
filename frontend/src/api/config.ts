import { API_URL } from './base'

export type PersonalSettings = {
  default_agricultural_zones_pct: number | string
  default_habitable_zones_pct: number | string
  default_industrial_zones_pct: number | string
  default_commercial_zones_pct: number | string
  population_in_economy_pct: number | string
  default_budget_200_enabled: boolean
  default_dense_residential_zones_enabled: boolean
  default_social_integration_pact_enabled: boolean
  default_reduced_holidays_enabled: boolean
  default_forest_exploitation_enabled: boolean
  default_industrial_zone_housing_enabled: boolean
  updated_at?: string
}

export type EconomicParameters = {
  mixed_agriculture_industry_agriculture_population_pct: number | string
  mixed_agriculture_industry_industry_population_pct: number | string
  military_industry_population_pct: number | string
  military_commerce_population_pct: number | string
  militarized_agro_industry_agriculture_population_pct: number | string
  militarized_agro_industry_industry_population_pct: number | string
  custom_scenario_enabled: boolean
  custom_scenario_name: string
  custom_agriculture_population_pct: number | string
  custom_industry_population_pct: number | string
  custom_commerce_population_pct: number | string
}

export type UserScenario = {
  scenario_id: string | number
  game_id: string | number
  scenario_name: string
  description: string | null
  is_default: boolean
  parameters: EconomicParameters
  created_at: string
  updated_at: string
}

export type UserConfig = {
  game_id: string | number
  settings: PersonalSettings
  scenarios: UserScenario[]
  max_scenarios: number
}

export type PlayerDetailResponse = {
  player: Record<string, unknown> & {
    player_id: string | number
    player_name: string
    game_id: string | number
    game_turn: number | string
  }
  snapshot: (Record<string, unknown> & {
    country_name: string
    ruler_name: string | null
    rank: number | string | null
    score: number | string | null
    population: number | string | null
    happiness: number | string | null
    land_size: number | string | null
    habitable_regions: number | string | null
    carbon_credits: number | string | null
    alliance_name: string | null
    alliance_status: string | null
    wonder_type: string | null
    wonder_score: number | string | null
    military_status: string | null
    military_victories: number | string | null
    military_defeats: number | string | null
    is_on_vacation: boolean | null
    vacation_until: string | null
    raw_details: Record<string, unknown> | null
    raw_ranking: Record<string, unknown>
  }) | null
  score_model: {
    actual_score: string | null
    victory_defeat_ratio: string | null
    potential_without_tech_sup: string | null
    potential_required_by_real_score: string | null
    inferred_tech_sup_raw: string | null
    tech_sup_level: string | null
    calculated_potential: string | null
    calculated_score: string | null
    score_difference: string | null
    score_difference_percent: string | null
  } | null
  game_turn: number | string
  scenario_id: string | number | null
  settings: PersonalSettings | null
  override: {
    agricultural_zones: number | string | null
    habitable_zones: number | string | null
    industrial_zones: number | string | null
    commercial_zones: number | string | null
    budget_200_enabled: boolean | null
    dense_residential_zones_enabled: boolean | null
    social_integration_pact_enabled: boolean | null
    reduced_holidays_enabled: boolean | null
    forest_exploitation_enabled: boolean | null
    industrial_zone_housing_enabled: boolean | null
    updated_at: string
  } | null
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    credentials: 'include',
    headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
    ...init,
  })
  if (!response.ok) {
    let message = `Erreur API : ${response.status} ${response.statusText}`
    try {
      const body = (await response.json()) as { error?: string }
      if (body.error) message = body.error
    } catch { /* Réponse sans JSON. */ }
    throw new Error(message)
  }
  return response.json() as Promise<T>
}

export function getUserConfig(signal?: AbortSignal) {
  return request<UserConfig>('/api/config', { signal })
}

export function saveUserSettings(settings: PersonalSettings) {
  return request<{ settings: PersonalSettings }>('/api/config/settings', {
    method: 'PUT', body: JSON.stringify({
      default_agricultural_zones_pct: Number(settings.default_agricultural_zones_pct),
      default_habitable_zones_pct: Number(settings.default_habitable_zones_pct),
      default_industrial_zones_pct: Number(settings.default_industrial_zones_pct),
      default_commercial_zones_pct: Number(settings.default_commercial_zones_pct),
      population_in_economy_pct: Number(settings.population_in_economy_pct),
      default_budget_200_enabled: Boolean(settings.default_budget_200_enabled),
      default_dense_residential_zones_enabled: Boolean(settings.default_dense_residential_zones_enabled),
      default_social_integration_pact_enabled: Boolean(settings.default_social_integration_pact_enabled),
      default_reduced_holidays_enabled: Boolean(settings.default_reduced_holidays_enabled),
      default_forest_exploitation_enabled: Boolean(settings.default_forest_exploitation_enabled),
      default_industrial_zone_housing_enabled: Boolean(settings.default_industrial_zone_housing_enabled),
    }),
  })
}

export function createUserScenario(scenario: Omit<UserScenario, 'scenario_id' | 'game_id' | 'created_at' | 'updated_at' | 'is_default'>) {
  return request<{ scenario: { scenario_id: string | number; game_id: string | number } }>('/api/config/scenarios', {
    method: 'POST', body: JSON.stringify({
      scenario_name: scenario.scenario_name,
      description: scenario.description,
      parameters: Object.fromEntries(Object.entries(scenario.parameters).map(([key, value]) => [key, key === 'custom_scenario_enabled' ? Boolean(value) : key === 'custom_scenario_name' ? String(value) : Number(value)])),
    }),
  })
}

export function updateUserScenario(scenario: UserScenario) {
  return request<{ scenario: { scenario_id: string | number } }>(`/api/config/scenarios/${encodeURIComponent(String(scenario.scenario_id))}`, {
    method: 'PUT', body: JSON.stringify({
      scenario_name: scenario.scenario_name,
      description: scenario.description,
      parameters: Object.fromEntries(Object.entries(scenario.parameters).map(([key, value]) => [key, key === 'custom_scenario_enabled' ? Boolean(value) : key === 'custom_scenario_name' ? String(value) : Number(value)])),
    }),
  })
}

export function setUserDefaultScenario(scenarioId: string | number) {
  return request<{ scenario: { scenario_id: string | number; is_default: boolean } }>(`/api/config/scenarios/${encodeURIComponent(String(scenarioId))}/default`, { method: 'PUT' })
}

export function deleteUserScenario(scenarioId: string | number) {
  return request<{ scenario_id: string | number; deleted: boolean }>(`/api/config/scenarios/${encodeURIComponent(String(scenarioId))}`, { method: 'DELETE' })
}

export function getPlayerDetails(playerId: string | number, gameTurn?: number, scenarioId?: string | number, signal?: AbortSignal) {
  const query = new URLSearchParams()
  if (gameTurn !== undefined) query.set('game_turn', String(gameTurn))
  if (scenarioId !== undefined && scenarioId !== '') query.set('scenario_id', String(scenarioId))
  const queryString = query.toString()
  const suffix = queryString ? `?${queryString}` : ''
  return request<PlayerDetailResponse>(`/api/players/${encodeURIComponent(String(playerId))}/details${suffix}`, { signal })
}

export function savePlayerOverrides(
  playerId: string | number,
  values: {
    game_turn: number; scenario_id: string | number; agricultural_zones: number; habitable_zones: number;
    industrial_zones: number; commercial_zones: number; budget_200_enabled: boolean;
    dense_residential_zones_enabled: boolean; social_integration_pact_enabled: boolean;
    reduced_holidays_enabled: boolean; forest_exploitation_enabled: boolean; industrial_zone_housing_enabled: boolean
  },
) {
  return request<{ override: PlayerDetailResponse['override'] }>(`/api/players/${encodeURIComponent(String(playerId))}/overrides`, {
    method: 'PUT', body: JSON.stringify(values),
  })
}
