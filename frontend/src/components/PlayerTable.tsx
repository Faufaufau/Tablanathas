import { useEffect, useMemo, useState } from 'react'
import type { DashboardPlayer } from '../types/dashboard'
import Pagination from './Pagination'
import { formatFixedNumber, formatNumber } from '../utils/numberFormat'

interface PlayerTableProps {
  players: DashboardPlayer[]
  onSelectPlayer: (playerId: string) => void
}

const PAGE_SIZE = 20

function cleanScenarioName(input: string | null | undefined): string {
  const name = (input ?? '').trim().replace(/\s*\([^()]*\)\s*$/, '').trim()
  return name || '—'
}

export default function PlayerTable({ players, onSelectPlayer }: PlayerTableProps) {
  const [page, setPage] = useState(1)
  const sortedPlayers = useMemo(() => [...players].sort(
    (a, b) => Number(b.tech_profitability) - Number(a.tech_profitability)
  ), [players])

  useEffect(() => setPage(1), [players.length])
  const pageCount = Math.max(1, Math.ceil(sortedPlayers.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const visiblePlayers = sortedPlayers.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  return (
    <>
      <div className="table-container">
        <table className="player-table">
          <thead><tr><th>Rang</th><th>Joueur</th><th>Ancienneté</th><th>PTech investis</th><th>Rentabilité tech.</th><th>Rentabilité à + 10 cycles</th><th>Potentiel économique</th><th>Meilleur scénario</th></tr></thead>
          <tbody>
            {visiblePlayers.map((player) => (
              <tr key={`${player.game_id}-${player.player_id}`}>
                <td>{formatNumber(player.profitability_rank)}</td>
                <td className="player-name"><button type="button" className="player-link" onClick={() => onSelectPlayer(String(player.player_id))}>{player.player_name}</button></td>
                <td>{formatNumber(player.seniority_turns)}</td>
                <td>{formatNumber(player.total_tech_points, { maximumFractionDigits: 0 })}</td>
                <td>{formatFixedNumber(player.tech_profitability, 1)}</td>
                <td>{formatFixedNumber(player.profitability_10_turns, 1)}</td>
                <td>{formatFixedNumber(player.max_economic_potential_billion, 1)} G</td>
                <td>{cleanScenarioName(player.economic_best_scenario)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={currentPage} pageSize={PAGE_SIZE} totalItems={sortedPlayers.length} onPageChange={setPage} />
    </>
  )
}
