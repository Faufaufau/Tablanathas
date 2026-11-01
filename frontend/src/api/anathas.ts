import { API_URL } from './base'

export type AnathasSnapshotRun = {
  snapshot_id: string | number
  schedule_key: string
  scheduled_local_at: string
  scheduled_for: string
  snapshot_phase: 'start' | 'end'
  game_turn: number | string | null
  status: 'running' | 'completed' | 'partial' | 'failed'
  expected_country_count: number
  captured_country_count: number
  details_failed_count: number
  failures: Array<{ countryId: string | null; countryName: string | null; error: string }> | unknown
  error_message: string | null
  attempt_count: number
  started_at: string
  completed_at: string | null
}

export type AnathasSnapshotCountry = {
  country_id: string | number
  player_id: string | number | null
  country_name: string
  ruler_name: string | null
  particule: string | null
  rank: string | number | null
  registered_timestamp: string | number | null
  seniority_cycles: string | number | null
  score: string | number | null
  population: string | number | null
  happiness: string | number | null
  land_size: string | number | null
  habitable_regions: string | number | null
  total_zones: number
  habitable_zones: number
  agricultural_zones: number
  agriculture_tech: string | number | null
  industry_tech: string | number | null
  commerce_tech: string | number | null
  research_points: string | number | null
  education_primary_pct: string | number | null
  education_secondary_pct: string | number | null
  education_higher_pct: string | number | null
  pollution: string | number | null
  carbon_credits: string | number | null
  education_primary_ratio: string | number | null
  education_secondary_ratio: string | number | null
  education_higher_ratio: string | number | null
  alliance_id: string | number | null
  alliance_name: string | null
  alliance_status: string | null
  alliance_game_id: string | number | null
  wonder_type: string | null
  wonder_score: string | number | null
  gms_multiplier: string | number
  science_wonder_multiplier: string | number
  gmh_multiplier: string | number
  economic_wonder_multiplier: string | number
  research_budget_estimate_billion: string | number | null
  military_status: string | null
  military_victories: string | number | null
  military_defeats: string | number | null
  is_on_vacation: boolean | null
  vacation_until: string | null
  captured_at: string
  baseline_snapshot_id: string | number | null
  delta_score: string | number | null
  delta_population: string | number | null
  delta_research_points: string | number | null
  delta_agriculture_tech: string | number | null
  delta_industry_tech: string | number | null
  delta_commerce_tech: string | number | null
}

export type LatestAnathasSnapshot = {
  run: AnathasSnapshotRun | null
  countries: AnathasSnapshotCountry[]
}

/** Fiche historisée complète d'un pays, avec la réponse JSON originale de l'API. */
export type AnathasCountrySnapshotDetails = AnathasSnapshotCountry & {
  snapshot_id: string | number
  snapshot_phase: 'start' | 'end'
  scheduled_local_at: string
  completed_at: string | null
  agriculture_tech: string | number | null
  description: string | null
  raw_ranking: Record<string, unknown>
  raw_details: Record<string, unknown> | null
  details_synced_at: string | null
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    credentials: 'include',
    headers: { Accept: 'application/json' },
    signal,
  })
  if (!response.ok) {
    let message = `Erreur API : ${response.status} ${response.statusText}`
    try {
      const body = (await response.json()) as { error?: string }
      if (body.error) message = body.error
    } catch {
      // Réponse non JSON.
    }
    throw new Error(message)
  }
  return (await response.json()) as T
}

export function getLatestAnathasSnapshot(signal?: AbortSignal): Promise<LatestAnathasSnapshot> {
  return getJson<LatestAnathasSnapshot>('/api/anathas/snapshots/latest', signal)
}

export function getAnathasSnapshotRuns(signal?: AbortSignal): Promise<{ runs: AnathasSnapshotRun[] }> {
  return getJson<{ runs: AnathasSnapshotRun[] }>('/api/anathas/snapshots?limit=100', signal)
}


export function getAnathasSnapshotById(snapshotId: string | number, signal?: AbortSignal): Promise<LatestAnathasSnapshot> {
  if (!/^\d{1,20}$/.test(String(snapshotId)) || /^0+$/.test(String(snapshotId))) {
    return Promise.reject(new Error('L’identifiant de capture doit être un entier positif.'))
  }
  return getJson<LatestAnathasSnapshot>(`/api/anathas/snapshots/${encodeURIComponent(String(snapshotId))}`, signal)
}

export function getLatestAnathasCountrySnapshot(
  countryId: string | number,
  signal?: AbortSignal,
): Promise<{ country: AnathasCountrySnapshotDetails }> {
  if (!/^\d{1,20}$/.test(String(countryId)) || /^0+$/.test(String(countryId))) {
    return Promise.reject(new Error('L’identifiant du pays doit être un entier positif.'))
  }
  return getJson<{ country: AnathasCountrySnapshotDetails }>(
    `/api/anathas/snapshots/latest/countries/${encodeURIComponent(String(countryId))}`,
    signal,
  )
}
