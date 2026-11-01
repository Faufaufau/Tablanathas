import { useEffect, useState } from 'react'
import { Clock3, Database, RefreshCw } from 'lucide-react'
import { getAnathasSnapshotById, getAnathasSnapshotRuns, type AnathasSnapshotCountry, type AnathasSnapshotRun, type LatestAnathasSnapshot } from '../api/anathas'
import { formatNumber } from '../utils/numberFormat'

function n(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') return '—'
  return formatNumber(value)
}
function date(value: string | null | undefined) {
  if (!value) return '—'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Paris' }).format(parsed)
}
function phase(run: AnathasSnapshotRun) { return run.snapshot_phase === 'start' ? 'Début de tour' : 'Fin de tour' }
function statusLabel(status: AnathasSnapshotRun['status']) { return ({ completed: 'Complète', partial: 'Partielle', failed: 'Échec', running: 'En cours' })[status] }

export default function HistoryPage({ onSelectPlayer }: { onSelectPlayer: (playerId: string) => void }) {
  const [runs, setRuns] = useState<AnathasSnapshotRun[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [snapshot, setSnapshot] = useState<LatestAnathasSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function loadRuns(signal?: AbortSignal, refresh = false) {
    if (refresh) setRefreshing(true); else setLoading(true)
    setError(null)
    try {
      const result = await getAnathasSnapshotRuns(signal)
      if (signal?.aborted) return
      setRuns(result.runs)
      setSelectedId((previous) => result.runs.some((run) => String(run.snapshot_id) === previous && run.status === 'completed')
        ? previous : String(result.runs.find((run) => run.status === 'completed')?.snapshot_id ?? ''))
    } catch (err: unknown) {
      if (!signal?.aborted) setError(err instanceof Error ? err.message : 'Impossible de charger les créneaux enregistrés.')
    } finally { if (!signal?.aborted) { setLoading(false); setRefreshing(false) } }
  }

  useEffect(() => { const controller = new AbortController(); void loadRuns(controller.signal); return () => controller.abort() }, [])
  useEffect(() => {
    if (!selectedId) { setSnapshot(null); return }
    const controller = new AbortController()
    setDetailLoading(true); setError(null)
    getAnathasSnapshotById(selectedId, controller.signal).then((data) => {
      if (!controller.signal.aborted) setSnapshot(data)
    }).catch((err: unknown) => {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Impossible de charger cette capture.')
    }).finally(() => { if (!controller.signal.aborted) setDetailLoading(false) })
    return () => controller.abort()
  }, [selectedId])

  const completedCount = runs.filter((run) => run.status === 'completed').length
  const countryRows: AnathasSnapshotCountry[] = snapshot?.countries ?? []

  return <div className="page-content">
    <section className="panel page-panel">
      <div className="panel-header page-panel-header"><div><p className="eyebrow">CAPTURES AUTOMATIQUES</p><h2>Historique des captures</h2><p>Consulte chaque créneau enregistré, son statut et les valeurs historisées à cet instant.</p></div><button className="secondary-button" type="button" disabled={refreshing} onClick={() => void loadRuns(undefined, true)}><RefreshCw size={15} className={refreshing ? 'spin' : undefined} /> Actualiser</button></div>
      <div className="snapshot-history-stats"><div><span>Créneaux chargés</span><strong>{formatNumber(runs.length)}</strong></div><div><span>Captures complètes</span><strong>{formatNumber(completedCount)}</strong></div><div><span>Dernier créneau connu</span><strong>{runs[0]?.scheduled_local_at ?? '—'}</strong></div></div>
      {loading && <p className="page-message">Chargement des créneaux…</p>}
      {error && <p className="notice notice--error" role="alert">{error}</p>}
      {!loading && runs.length === 0 && <p className="page-message">Aucune capture enregistrée pour le moment.</p>}
      {runs.length > 0 && <div className="history-capture-grid">
        <div className="history-run-list"><h3>Créneaux (heure de Paris)</h3>{runs.map((run) => <button key={String(run.snapshot_id)} type="button" disabled={run.status !== 'completed'} className={`history-run ${selectedId === String(run.snapshot_id) ? 'active' : ''} ${run.status !== 'completed' ? 'disabled' : ''}`} onClick={() => setSelectedId(String(run.snapshot_id))}>
          <span className="history-run__date"><Clock3 size={15} />{run.scheduled_local_at}</span><strong>Tour {n(run.game_turn)} · {phase(run)}</strong><span className={`anathas-status anathas-status--${run.status}`}>{statusLabel(run.status)}</span><small>{n(run.captured_country_count)}/{n(run.expected_country_count)} fiches · {date(run.completed_at)}</small>{run.error_message && <small className="history-run__error">{run.error_message}</small>}
        </button>)}</div>
        <div className="history-capture-detail">
          {detailLoading && <p className="page-message">Chargement de cette capture…</p>}
          {!detailLoading && snapshot?.run && <>
            <div className="history-capture-heading"><div><p className="eyebrow">CAPTURE #{snapshot.run.snapshot_id}</p><h3>Tour {n(snapshot.run.game_turn)} · {phase(snapshot.run)}</h3><p>{date(snapshot.run.completed_at)} · {snapshot.run.scheduled_local_at}</p></div><span className="anathas-status anathas-status--completed">Complète</span></div>
            <div className="anathas-table-wrap"><table className="anathas-table"><thead><tr><th>Rang</th><th>Pays / joueur</th><th>Score</th><th>Population</th><th>Recherche</th><th>Tech. agriculture</th><th>Industrie</th><th>Commerce</th><th>Territoire</th><th>Pollution</th></tr></thead><tbody>{countryRows.map((country) => <tr key={String(country.country_id)}><td><span className="anathas-rank">{n(country.rank)}</span></td><td className="anathas-country-name"><button type="button" className="player-link" disabled={!country.player_id} onClick={() => country.player_id && onSelectPlayer(String(country.player_id))}>{country.country_name}</button>{country.ruler_name && <small>{country.ruler_name}</small>}</td><td>{n(country.score)}</td><td>{n(country.population)}</td><td>{n(country.research_points)}</td><td>{n(country.agriculture_tech)}</td><td>{n(country.industry_tech)}</td><td>{n(country.commerce_tech)}</td><td>{n(country.land_size)}</td><td>{n(country.pollution)}</td></tr>)}</tbody></table></div>
            <p className="page-footnote"><Database size={14} /> {formatNumber(countryRows.length)} pays récupérés pour cette capture. Les valeurs affichées correspondent au créneau sélectionné, pas nécessairement au tour courant du dashboard.</p>
          </>}
          {!detailLoading && !snapshot?.run && !error && <p className="page-message">Choisis une capture complète dans la colonne de gauche.</p>}
        </div>
      </div>}
    </section>
  </div>
}
