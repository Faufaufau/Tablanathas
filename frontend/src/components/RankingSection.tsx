
import { useEffect, useMemo, useState } from 'react'
import type { DashboardPlayer } from '../types/dashboard'
import Pagination from './Pagination'
import { formatFixedNumber, formatNumber } from '../utils/numberFormat'

type RankingKey = 'technology' | 'projected' | 'tenTurns' | 'economic'

function numericOrNull(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function formatRankingValue(value: string | number | null | undefined, digits = 1): string {
  const parsed = numericOrNull(value)
  return parsed === null ? '—' : formatFixedNumber(parsed, digits)
}

interface RankingSectionProps {
  players: DashboardPlayer[]
  onSelectPlayer: (playerId: string) => void
}

const rankingOptions: { key: RankingKey; label: string }[] = [
  { key: 'technology', label: 'Rentabilité tech.' },
  { key: 'projected', label: 'Projection prochain tour' },
  { key: 'tenTurns', label: 'Rentabilité à 10 tours' },
  { key: 'economic', label: 'Potentiel économique' },
]

const rankingConfig = {
  technology: {
    rank: (p: DashboardPlayer) => numericOrNull(p.profitability_rank),
    value: (p: DashboardPlayer) => numericOrNull(p.tech_profitability),
    format: (p: DashboardPlayer) => formatRankingValue(p.tech_profitability),
    description: 'Rentabilité technologique actuelle',
  },
  projected: {
    rank: (p: DashboardPlayer) => numericOrNull(p.projected_profitability_rank),
    value: (p: DashboardPlayer) => numericOrNull(p.projected_profitability),
    format: (p: DashboardPlayer) => formatRankingValue(p.projected_profitability),
    description: 'Rentabilité technologique projetée au prochain tour',
  },
  tenTurns: {
    rank: (p: DashboardPlayer) => numericOrNull(p.profitability_10_turn_rank),
    value: (p: DashboardPlayer) => numericOrNull(p.profitability_10_turns),
    format: (p: DashboardPlayer) => formatRankingValue(p.profitability_10_turns),
    description: 'Rentabilité projetée sur dix tours',
  },
  economic: {
    rank: (p: DashboardPlayer) => numericOrNull(p.economic_potential_rank),
    value: (p: DashboardPlayer) =>
      numericOrNull(p.max_economic_potential_billion),
    format: (p: DashboardPlayer) => {
      const value = numericOrNull(p.max_economic_potential_billion)
      return value === null ? '—' : `${formatFixedNumber(value, 1)} G`
    },
    description: 'Meilleur potentiel économique estimé',
  },
}

export default function RankingSection({ players, onSelectPlayer }: RankingSectionProps) {
  const [selected, setSelected] = useState<RankingKey>('technology')
  const [page, setPage] = useState(1)
  useEffect(() => setPage(1), [selected, players.length])
  const pageSize = 20
  const config = rankingConfig[selected]

  const rankedPlayers = useMemo(
    () =>
      [...players].sort((a, b) => {
        const rankA = config.rank(a)
        const rankB = config.rank(b)
        if (rankA === null && rankB !== null) return 1
        if (rankA !== null && rankB === null) return -1
        if (rankA !== null && rankB !== null && rankA !== rankB) return rankA - rankB
        return b.player_name.localeCompare(a.player_name)
      }),
    [players, config],
  )

  const pageCount = Math.max(1, Math.ceil(rankedPlayers.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const visiblePlayers = rankedPlayers.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  return (
    <section className="panel ranking-panel">
      <div className="panel-header">
        <div>
          <h2>Classements détaillés</h2>
          <p>{config.description}</p>
        </div>
      </div>

      <div className="ranking-tabs" role="tablist" aria-label="Type de classement">
        {rankingOptions.map((option) => (
          <button
            key={option.key}
            type="button"
            role="tab"
            aria-selected={selected === option.key}
            className={`ranking-tab ${selected === option.key ? 'active' : ''}`}
            onClick={() => { setSelected(option.key); setPage(1) }}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="table-container">
        <table className="player-table">
          <thead>
            <tr>
              <th>Rang</th>
              <th>Joueur</th>
              <th>Ancienneté</th>
              <th>Valeur</th>
            </tr>
          </thead>
          <tbody>
            {visiblePlayers.map((player) => (
              <tr key={`${player.game_id}-${player.player_id}`}>
                <td>
                  <span className="rank-number">
                    {config.rank(player) === null ? '—' : formatNumber(config.rank(player))}
                  </span>
                </td>
                <td className="player-name"><button type="button" className="player-link" onClick={() => onSelectPlayer(String(player.player_id))}>{player.player_name}</button></td>
                <td>{formatNumber(player.seniority_turns)} tours</td>
                <td className="ranking-value">{config.format(player)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={currentPage} pageSize={pageSize} totalItems={rankedPlayers.length} onPageChange={setPage} />
    </section>
  )
}
