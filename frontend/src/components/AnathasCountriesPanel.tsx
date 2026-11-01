import { useCallback, useEffect, useState } from 'react'
import { Activity, Clock3, Database, RefreshCw, TriangleAlert } from 'lucide-react'
import {
  getAnathasSnapshotRuns,
  getLatestAnathasSnapshot,
  type AnathasSnapshotRun,
  type AnathasSnapshotCountry,
  type LatestAnathasSnapshot,
} from '../api/anathas'
import { formatNumber } from '../utils/numberFormat'

function formatExact(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  return formatNumber(value)
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'short', timeStyle: 'medium', timeZone: 'Europe/Paris',
  }).format(date)
}

function formatDelta(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  const text = String(value)
  if (text === '0' || text === '0.000') return '0'
  return text.startsWith('-') ? `−${formatExact(text.slice(1))}` : `+${formatExact(text)}`
}

function wonderLabel(country: AnathasSnapshotCountry): string {
  if (!country.wonder_type && country.wonder_score == null) return '—'
  const type = country.wonder_type ?? 'Type inconnu'
  const size = country.wonder_score == null ? '' : ` · taille ${formatExact(country.wonder_score)}`
  return `${type}${size}`
}

function phaseLabel(run: AnathasSnapshotRun): string {
  if (run.snapshot_phase === 'start') return 'Début de tour'
  return 'Fin de tour'
}

function statusLabel(status: AnathasSnapshotRun['status']): string {
  switch (status) {
    case 'completed': return 'Complète'
    case 'partial': return 'Partielle'
    case 'failed': return 'Échec'
    default: return 'En cours'
  }
}

function AnathasCountriesPanel() {
  const [snapshot, setSnapshot] = useState<LatestAnathasSnapshot | null>(null)
  const [runs, setRuns] = useState<AnathasSnapshotRun[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (signal?: AbortSignal, manual = false) => {
    if (manual) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      const [latest, history] = await Promise.all([
        getLatestAnathasSnapshot(signal),
        getAnathasSnapshotRuns(signal),
      ])
      if (signal?.aborted) return
      setSnapshot(latest)
      setRuns(history.runs)
    } catch (err: unknown) {
      if (signal?.aborted) return
      setError(err instanceof Error ? err.message : 'Impossible de charger les snapshots Anathas.')
    } finally {
      if (!signal?.aborted) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    const initialLoad = window.setTimeout(() => void load(controller.signal), 0)
    const interval = window.setInterval(() => void load(undefined, true), 60_000)
    return () => {
      controller.abort()
      window.clearTimeout(initialLoad)
      window.clearInterval(interval)
    }
  }, [load])

  const latestRun = runs[0]
  const current = snapshot?.run
  const showDeltas = current?.snapshot_phase === 'end'

  return (
    <section className="panel anathas-panel">
      <div className="panel-header">
        <div>
          <h2>Captures automatiques Anathas</h2>
          <p>
            Historique partagé · 05:05, 18:00, 20:05 et 00:00 (heure de Paris)
          </p>
        </div>
        <button
          className="secondary-button"
          type="button"
          onClick={() => void load(undefined, true)}
          disabled={loading || refreshing}
        >
          <RefreshCw size={15} className={refreshing ? 'spin' : undefined} />
          {refreshing ? 'Actualisation…' : 'Actualiser l’affichage'}
        </button>
      </div>

      {latestRun && latestRun.status !== 'completed' && (
        <div className="anathas-message anathas-message--error" role="status">
          <TriangleAlert size={16} />
          La capture programmée la plus récente est {statusLabel(latestRun.status).toLowerCase()} :
          {' '}{formatNumber(latestRun.captured_country_count)}/{formatNumber(latestRun.expected_country_count)} fiches enregistrées.
          {latestRun.error_message ? ` ${latestRun.error_message}` : ''}
          {' '}Le tableau ci-dessous conserve la dernière capture complète.
        </div>
      )}

      {loading && <p className="anathas-message">Chargement de la dernière capture…</p>}
      {error && <p className="anathas-message anathas-message--error" role="alert">{error}</p>}

      {!loading && !error && !current && (
        <div className="anathas-message">
          <Database size={16} />
          Aucune capture complète n’existe encore. Vérifie la migration SQL, la clé API du backend et son journal de démarrage.
        </div>
      )}

      {!loading && !error && current && (
        <>
          <div className="anathas-snapshot-summary">
            <div>
              <span><Activity size={15} /> Tour global</span>
              <strong>{formatExact(current.game_turn)}</strong>
            </div>
            <div>
              <span><Clock3 size={15} /> Capture enregistrée</span>
              <strong>{formatDate(current.completed_at)}</strong>
            </div>
            <div>
              <span><Database size={15} /> Pays détaillés</span>
              <strong>{formatNumber(current.captured_country_count)}/{formatNumber(current.expected_country_count)}</strong>
            </div>
            <div>
              <span>Phase</span>
              <strong>{phaseLabel(current)}</strong>
            </div>
          </div>

          {showDeltas && (
            <p className="anathas-message">
              Les colonnes « Δ » comparent la capture de fin de tour avec celle du début du même tour.
              Les grands scores sont gardés et affichés en texte exact, sans conversion en nombre flottant JavaScript.
            </p>
          )}

          <div className="anathas-table-wrap">
            <table className="anathas-table anathas-storage-table">
              <thead>
                <tr>
                  <th>Rang</th>
                  <th>Pays</th>
                  <th>Score</th>
                  {showDeltas && <th>Δ score</th>}
                  <th>Population</th>
                  {showDeltas && <th>Δ pop.</th>}
                  <th>Agriculture</th>
                  {showDeltas && <th>Δ agri.</th>}
                  <th>Industrie</th>
                  {showDeltas && <th>Δ indus.</th>}
                  <th>Commerce</th>
                  {showDeltas && <th>Δ comm.</th>}
                  <th>Recherche</th>
                  {showDeltas && <th>Δ rech.</th>}
                  <th>Budget rech. (G)</th>
                  <th>Territoire</th>
                  <th>Zones</th>
                  <th>Merveille</th>
                  <th>Éducation sup.</th>
                  <th>Pollution</th>
                </tr>
              </thead>
              <tbody>
                {snapshot?.countries.map((country) => (
                  <tr key={String(country.country_id)}>
                    <td><span className="anathas-rank">{formatExact(country.rank)}</span></td>
                    <td className="anathas-country-name">
                      <strong>{country.country_name}</strong>
                      {country.ruler_name && <small>{country.ruler_name}</small>}
                    </td>
                    <td>{formatExact(country.score)}</td>
                    {showDeltas && <td>{formatDelta(country.delta_score)}</td>}
                    <td>{formatExact(country.population)}</td>
                    {showDeltas && <td>{formatDelta(country.delta_population)}</td>}
                    <td>{formatExact(country.agriculture_tech)}</td>
                    {showDeltas && <td>{formatDelta(country.delta_agriculture_tech)}</td>}
                    <td>{formatExact(country.industry_tech)}</td>
                    {showDeltas && <td>{formatDelta(country.delta_industry_tech)}</td>}
                    <td>{formatExact(country.commerce_tech)}</td>
                    {showDeltas && <td>{formatDelta(country.delta_commerce_tech)}</td>}
                    <td>{formatExact(country.research_points)}</td>
                    {showDeltas && <td>{formatDelta(country.delta_research_points)}</td>}
                    <td>{formatExact(country.research_budget_estimate_billion)}</td>
                    <td>{formatExact(country.land_size)}</td>
                    <td>{formatExact(country.total_zones)}</td>
                    <td>{wonderLabel(country)}</td>
                    <td>{country.education_higher_pct == null ? '—' : `${formatExact(country.education_higher_pct)} %`}</td>
                    <td>{formatExact(country.pollution)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="anathas-storage-caption">
            Zones totales = floor(habitable_regions / 20'000). Les zones agricoles sont initialisées à{' '}
            {formatNumber(snapshot?.countries[0]?.agricultural_zones ?? 0)} par défaut, valeur configurable côté backend car absente de l’API.
            Le territoire (land_size) et la taille/type de merveille restent stockés séparément.
          </p>
        </>
      )}

      {runs.length > 0 && (
        <details className="anathas-raw-details anathas-run-history">
          <summary>Historique récent des captures</summary>
          <div className="anathas-table-wrap">
            <table className="anathas-table">
              <thead><tr><th>Créneau</th><th>Tour</th><th>Phase</th><th>État</th><th>Fiches</th><th>Tentatives</th><th>Terminé</th></tr></thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={String(run.snapshot_id)}>
                    <td>{run.scheduled_local_at}</td>
                    <td>{formatExact(run.game_turn)}</td>
                    <td>{phaseLabel(run)}</td>
                    <td><span className={`anathas-status anathas-status--${run.status}`}>{statusLabel(run.status)}</span></td>
                    <td>{formatNumber(run.captured_country_count)}/{formatNumber(run.expected_country_count)}</td>
                    <td>{formatNumber(run.attempt_count)}</td>
                    <td>{formatDate(run.completed_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  )
}

export default AnathasCountriesPanel
