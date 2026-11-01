
import type { DashboardPlayer } from '../types/dashboard'
import type { PlayerHistoryPoint } from '../types/history'

import { API_URL } from './base'

export async function getAvailableDashboardTurns(): Promise<{ current_turn: number; turns: number[] }> {
  const response = await fetch(`${API_URL}/api/dashboard/turns`, { credentials: 'include' })
  if (!response.ok) throw new Error(`Impossible de charger les tours disponibles (${response.status}).`)
  return response.json() as Promise<{ current_turn: number; turns: number[] }>
}

export async function getCurrentDashboard(
  gameTurn?: number,
  scenarioId?: string,
  signal?: AbortSignal,
): Promise<DashboardPlayer[]> {
  const query = new URLSearchParams()
  if (gameTurn !== undefined) query.set('game_turn', String(gameTurn))
  if (scenarioId) query.set('scenario_id', scenarioId)
  const queryString = query.toString()
  const suffix = queryString ? `?${queryString}` : ''
  const response = await fetch(`${API_URL}/api/dashboard/current${suffix}`, {
    credentials: 'include',
    signal,
  })

  if (!response.ok) {
    throw new Error(`Erreur API : ${response.status} ${response.statusText}`)
  }

  return response.json() as Promise<DashboardPlayer[]>
}



export async function getPlayerHistory(
  playerId: string,
  signal?: AbortSignal,
  scenarioId?: string,
): Promise<PlayerHistoryPoint[]> {
  const query = scenarioId ? `?scenario_id=${encodeURIComponent(scenarioId)}` : ''
  const response = await fetch(
    `${API_URL}/api/players/${encodeURIComponent(playerId)}/history${query}`,
    { signal, credentials: 'include' },
  )

  if (!response.ok) {
    throw new Error(
      `Impossible de charger l'historique (${response.status})`,
    )
  }

  return (await response.json()) as PlayerHistoryPoint[]
}
