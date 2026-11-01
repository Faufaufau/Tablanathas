import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Save, UserRound, SlidersHorizontal } from 'lucide-react'
import { getPlayerDetails, savePlayerOverrides, type PersonalSettings, type PlayerDetailResponse, type UserScenario } from '../api/config'
import { getPlayerHistory } from '../api/dashboard'
import type { DashboardPlayer } from '../types/dashboard'
import type { PlayerHistoryPoint } from '../types/history'
import PlayerHistoryCharts from '../components/PlayerHistoryCharts'
import { formatNumber } from '../utils/numberFormat'

function value(input: unknown, suffix = ''): string {
  if (input === null || input === undefined || input === '') return '—'
  const source = String(input)
  const num = Number(source)
  if (source.trim() !== '' && Number.isFinite(num)) return `${formatNumber(num, { maximumFractionDigits: 3 })}${suffix}`
  return `${source}${suffix}`
}
function exact(input: unknown): string {
  if (input === null || input === undefined || input === '') return '—'
  const source = String(input)
  return formatNumber(source)
}
const WONDER_CATEGORY_LABELS: Record<string, string> = {
  x: 'Scientifique',
  c: 'Écologique',
  e: 'Économique',
  h: 'Humaniste',
  g: 'Guerrière',
  d: 'Diplomatique',
}

function wonderDisplayName(input: unknown): string {
  if (input === null || input === undefined || input === '') return '—'
  const code = String(input).trim().toLowerCase()
  const match = code.match(/^([xcehgd])([+*])?$/)
  if (!match) return String(input)

  const [, categoryCode, suffix = ''] = match
  const category = WONDER_CATEGORY_LABELS[categoryCode]
  const type = suffix === '*' ? 'Grande Merveille' : suffix === '+' ? 'Merveille' : 'Monument'
  return `${type} ${category}`
}

const MILITARY_STATUS_LABELS: Record<string, string> = {
  none: 'Aucun',
  newbie: 'Débutant',
  inexperienced: 'Inexpérimenté',
  experienced: 'Expérimenté',
}

function militaryStatusLabel(input: unknown): string {
  if (input === null || input === undefined || input === '') return '—'
  const raw = String(input).trim()
  const key = raw.toLowerCase().replace(/[\s-]+/g, '_')
  return MILITARY_STATUS_LABELS[key] ?? raw
}

function scoreDisplay(input: unknown): ReactNode {
  if (input === null || input === undefined || input === '') return '—'
  const score = Number(input)
  if (!Number.isFinite(score)) return String(input)

  const completeScore = exact(input)
  let divisions = 0
  let divisor = 1

  // Chaque cristal représente une division supplémentaire par 1 000.
  // On tient compte de l'arrondi pour garantir un résultat sur trois chiffres maximum.
  while (Math.round(Math.abs(score) / divisor) >= 1_000) {
    divisor *= 1_000
    divisions += 1
  }

  const shortenedScore = Math.round(score / divisor)
  return (
    <span
      className="score-display"
      title={`Score complet : ${completeScore}`}
      aria-label={`Score complet : ${completeScore}`}
    >
      <span>{formatNumber(shortenedScore)}</span>
      <span aria-hidden="true">×</span>
      <img
        src={`/cristal_${divisions}.svg`}
        alt=""
        aria-hidden="true"
        onError={(event) => {
          event.currentTarget.hidden = true
          const fallback = event.currentTarget.nextElementSibling
          if (fallback instanceof HTMLElement) fallback.hidden = false
        }}
      />
      <span className="score-display__fallback" hidden aria-hidden="true">💎</span>
    </span>
  )
}

function roundedWonderSize(input: unknown): ReactNode {
  if (input === null || input === undefined || input === '') return '—'
  const number = Number(input)
  if (!Number.isFinite(number)) return String(input)
  return (
    <span title={`Valeur exacte : ${exact(input)}`}>
      {formatNumber(Math.round(number))}
    </span>
  )
}

function humanizeDescriptionKey(input: string): string {
  return input
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\p{L}/u, (letter) => letter.toLocaleUpperCase('fr-FR'))
}

function renderDescriptionValue(input: unknown, keyPrefix = 'description'): ReactNode {
  if (input === null || input === undefined) return <span className="description-empty">—</span>
  if (typeof input === 'boolean') return input ? 'Oui' : 'Non'
  if (typeof input === 'number') return formatNumber(input)
  if (Array.isArray(input)) {
    if (input.length === 0) return <span className="description-empty">Aucun élément</span>
    return <ul className="raw-description-list">{input.map((item, index) => <li key={`${keyPrefix}-${index}`}>{renderDescriptionValue(item, `${keyPrefix}-${index}`)}</li>)}</ul>
  }
  if (typeof input === 'object') {
    const entries = Object.entries(input as Record<string, unknown>)
    if (entries.length === 0) return <span className="description-empty">Aucune information</span>
    return <dl className="raw-description-fields">{entries.map(([key, nestedValue]) => (
      <div className="raw-description-field" key={`${keyPrefix}-${key}`}>
        <dt>{humanizeDescriptionKey(key)}</dt>
        <dd>{renderDescriptionValue(nestedValue, `${keyPrefix}-${key}`)}</dd>
      </div>
    ))}</dl>
  }
  if (typeof input === 'string') {
    const lines = input.split(/\r?\n/).filter((line) => line.length > 0)
    if (lines.length > 1) return <div className="raw-description-text">{lines.map((line, index) => <p key={`${keyPrefix}-${index}`}>{line}</p>)}</div>
    return input || '—'
  }
  return String(input)
}

function readableDescription(input: unknown): ReactNode {
  if (typeof input === 'string') {
    try {
      const parsed: unknown = JSON.parse(input)
      if (parsed !== null && typeof parsed === 'object') return renderDescriptionValue(parsed)
    } catch {
      // La description n'est pas du JSON : elle sera affichée comme du texte lisible.
    }
    return renderDescriptionValue(input)
  }
  return renderDescriptionValue(input)
}
function registeredDate(input: unknown): string {
  if (input === null || input === undefined || input === '') return '—'
  const seconds = Number(input)
  if (!Number.isFinite(seconds)) return String(input)
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeZone: 'Europe/Paris' }).format(new Date(seconds * 1000))
}
function dayMonthDate(input: unknown): string {
  if (input === null || input === undefined || input === '') return '—'
  const source = String(input).trim()
  let date: Date
  if (/^\d{9,10}(?:\.0+)?$/.test(source)) date = new Date(Number(source) * 1000)
  else if (/^\d{13}(?:\.0+)?$/.test(source)) date = new Date(Number(source))
  else {
    // Une date ISO sans heure est lue comme une date de calendrier, sans conversion de fuseau.
    const isoDate = source.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    date = isoDate ? new Date(Number(isoDate[1]), Number(isoDate[2]) - 1, Number(isoDate[3])) : new Date(source)
  }
  if (Number.isNaN(date.getTime())) return source
  return new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Paris' }).format(date)
}
function educationRatio(input: unknown): string {
  if (input === null || input === undefined || input === '') return '—'
  const ratio = Number(input)
  return Number.isFinite(ratio)
    ? `${formatNumber(ratio * 100, { maximumFractionDigits: 2 })} %`
    : String(input)
}

type Assumptions = { agricultural_zones: string; habitable_zones: string; industrial_zones: string; commercial_zones: string; budget_200_enabled: boolean; dense_residential_zones_enabled: boolean; social_integration_pact_enabled: boolean; reduced_holidays_enabled: boolean; forest_exploitation_enabled: boolean; industrial_zone_housing_enabled: boolean }

type ZoneCountKey = 'habitable_zones' | 'agricultural_zones' | 'industrial_zones' | 'commercial_zones'
const zoneCountKeys: ZoneCountKey[] = ['habitable_zones', 'agricultural_zones', 'industrial_zones', 'commercial_zones']

function availableZoneCount(detail: PlayerDetailResponse): number {
  const regionsValue = detail.snapshot?.habitable_regions ?? detail.player.habitable_regions
  const regions = Number(regionsValue)
  if (regionsValue !== null && regionsValue !== undefined && Number.isFinite(regions) && regions >= 0) {
    return Math.floor(regions / 20_000)
  }
  const storedTotal = Number(detail.player.total_zones)
  return Number.isFinite(storedTotal) && storedTotal >= 0 ? Math.floor(storedTotal) : 0
}

function defaultZoneCounts(total: number, settings: PersonalSettings | null | undefined): Record<ZoneCountKey, number> {
  const percentages: Record<ZoneCountKey, number> = {
    habitable_zones: Number(settings?.default_habitable_zones_pct ?? 40),
    agricultural_zones: Number(settings?.default_agricultural_zones_pct ?? 10),
    industrial_zones: Number(settings?.default_industrial_zones_pct ?? 20),
    commercial_zones: Number(settings?.default_commercial_zones_pct ?? 30),
  }
  const counts = {} as Record<ZoneCountKey, number>
  let remaining = Math.max(0, total)
  // Arrondi au plus proche, puis plafonnement séquentiel pour absorber les éventuels dépassements d'arrondi.
  for (const key of zoneCountKeys) {
    const raw = Math.max(0, Math.round(Math.max(0, percentages[key]) * total / 100))
    counts[key] = Math.min(raw, remaining)
    remaining -= counts[key]
  }
  return counts
}

function fitZoneCountsToTotal(values: Record<ZoneCountKey, unknown>, total: number): Record<ZoneCountKey, number> {
  const counts = {} as Record<ZoneCountKey, number>
  let remaining = Math.max(0, total)
  for (const key of zoneCountKeys) {
    const parsed = Number(values[key])
    const requested = Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0
    counts[key] = Math.min(requested, remaining)
    remaining -= counts[key]
  }
  return counts
}

function DetailsLoadingSkeleton() {
  return (
    <section className="details-loading" role="status" aria-live="polite" aria-label="Chargement des données du joueur" aria-busy="true">
      <div className="details-loading__status">
        <span className="details-loading__spinner" aria-hidden="true" />
        <div>
          <strong>Préparation de la fiche…</strong>
          <p>Chargement des données, des hypothèses et de l’historique.</p>
        </div>
      </div>
      <div className="details-loading__grid">
        <div className="details-loading__card">
          <span className="details-loading__line details-loading__line--heading" />
          {Array.from({ length: 5 }, (_, index) => <span className="details-loading__line" key={`basic-${index}`} />)}
        </div>
        <div className="details-loading__card">
          <span className="details-loading__line details-loading__line--heading" />
          {Array.from({ length: 5 }, (_, index) => <span className="details-loading__line" key={`economy-${index}`} />)}
        </div>
      </div>
      <div className="details-loading__card details-loading__card--wide">
        <span className="details-loading__line details-loading__line--heading" />
        <div className="details-loading__chart" />
      </div>
    </section>
  )
}

export default function PlayerDetailsPage({ players, selectedPlayerId, onSelectPlayer, preferredTurn, onSelectTurn, scenarios, selectedScenarioId, onSelectScenario }: {
  players: DashboardPlayer[]
  selectedPlayerId: string
  onSelectPlayer: (playerId: string) => void
  preferredTurn: string
  onSelectTurn: (turn: string) => void
  scenarios: UserScenario[]
  selectedScenarioId: string
  onSelectScenario: (scenarioId: string) => void
}) {
  const [history, setHistory] = useState<PlayerHistoryPoint[]>([])
  const [selectedTurn, setSelectedTurn] = useState('')
  const [detail, setDetail] = useState<PlayerDetailResponse | null>(null)
  const scenarioId = selectedScenarioId
  const [assumptions, setAssumptions] = useState<Assumptions>({ agricultural_zones: '0', habitable_zones: '0', industrial_zones: '0', commercial_zones: '0', budget_200_enabled: false, dense_residential_zones_enabled: true, social_integration_pact_enabled: false, reduced_holidays_enabled: false, forest_exploitation_enabled: false, industrial_zone_housing_enabled: false })
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [historyLoadedKey, setHistoryLoadedKey] = useState('')
  const [detailLoadedKey, setDetailLoadedKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const historyRequestKey = selectedPlayerId ? `${selectedPlayerId}:${scenarioId || 'default'}` : ''
  const detailRequestKey = selectedPlayerId ? `${selectedPlayerId}:${selectedTurn || 'latest'}:${scenarioId || 'default'}` : ''
  const historyReady = Boolean(selectedPlayerId) && historyLoadedKey === historyRequestKey
  const detailSettled = Boolean(selectedPlayerId) && detailLoadedKey === detailRequestKey
  const detailsLoading = Boolean(selectedPlayerId) && (
    loadingHistory || !historyReady || loadingDetail || !detailSettled
  )
  const detailsReady = detailSettled && !loadingDetail && Boolean(detail)

  useEffect(() => {
    if (!selectedPlayerId) {
      setHistory([])
      setSelectedTurn('')
      setDetail(null)
      setLoadingHistory(false)
      setLoadingDetail(false)
      setHistoryLoadedKey('')
      setDetailLoadedKey('')
      return
    }
    const controller = new AbortController()
    const requestKey = `${selectedPlayerId}:${scenarioId || 'default'}`
    setLoadingHistory(true)
    setHistoryLoadedKey('')
    setDetailLoadedKey('')
    setHistory([])
    setDetail(null)
    setError(null)
    setSuccess(null)
    getPlayerHistory(selectedPlayerId, controller.signal, scenarioId || undefined).then((data) => {
      if (controller.signal.aborted) return
      const sorted = [...data].sort((a, b) => Number(b.game_turn) - Number(a.game_turn))
      setHistory(sorted)
      setSelectedTurn((current) => sorted.some((point) => String(point.game_turn) === current) ? current : String(sorted[0]?.game_turn ?? ''))
    }).catch((err: unknown) => {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Impossible de charger l’historique du joueur.')
    }).finally(() => {
      if (!controller.signal.aborted) {
        setHistoryLoadedKey(requestKey)
        setLoadingHistory(false)
      }
    })
    return () => controller.abort()
  }, [selectedPlayerId, scenarioId])

  useEffect(() => {
    if (!selectedPlayerId) return
    if (historyLoadedKey !== historyRequestKey) {
      setLoadingDetail(false)
      setDetailLoadedKey('')
      return
    }
    const controller = new AbortController()
    const requestKey = `${selectedPlayerId}:${selectedTurn || 'latest'}:${scenarioId || 'default'}`
    setLoadingDetail(true)
    setDetailLoadedKey('')
    setDetail(null)
    setError(null)
    setSuccess(null)
    getPlayerDetails(selectedPlayerId, selectedTurn ? Number(selectedTurn) : undefined, scenarioId || undefined, controller.signal).then((result) => {
      if (controller.signal.aborted) return
      setDetail(result)
      const availableZones = availableZoneCount(result)
      const defaultZones = defaultZoneCounts(availableZones, result.settings)
      const zoneCounts = fitZoneCountsToTotal({
        habitable_zones: result.override?.habitable_zones ?? defaultZones.habitable_zones,
        agricultural_zones: result.override?.agricultural_zones ?? defaultZones.agricultural_zones,
        industrial_zones: result.override?.industrial_zones ?? defaultZones.industrial_zones,
        commercial_zones: result.override?.commercial_zones ?? defaultZones.commercial_zones,
      }, availableZones)
      setAssumptions({
        agricultural_zones: String(zoneCounts.agricultural_zones),
        habitable_zones: String(zoneCounts.habitable_zones),
        industrial_zones: String(zoneCounts.industrial_zones),
        commercial_zones: String(zoneCounts.commercial_zones),
        budget_200_enabled: Boolean(result.override?.budget_200_enabled ?? result.settings?.default_budget_200_enabled ?? false),
        dense_residential_zones_enabled: Boolean(result.override?.dense_residential_zones_enabled ?? result.settings?.default_dense_residential_zones_enabled ?? true),
        social_integration_pact_enabled: Boolean(result.override?.social_integration_pact_enabled ?? result.settings?.default_social_integration_pact_enabled ?? false),
        reduced_holidays_enabled: Boolean(result.override?.reduced_holidays_enabled ?? result.settings?.default_reduced_holidays_enabled ?? false),
        forest_exploitation_enabled: Boolean(result.override?.forest_exploitation_enabled ?? result.settings?.default_forest_exploitation_enabled ?? false),
        industrial_zone_housing_enabled: Boolean(result.override?.industrial_zone_housing_enabled ?? result.settings?.default_industrial_zone_housing_enabled ?? false),
      })
    }).catch((err: unknown) => {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Impossible de charger la fiche du joueur.')
    }).finally(() => {
      if (!controller.signal.aborted) {
        setDetailLoadedKey(requestKey)
        setLoadingDetail(false)
      }
    })
    return () => controller.abort()
  }, [selectedPlayerId, selectedTurn, scenarioId, historyLoadedKey, historyRequestKey])

  useEffect(() => {
    if (!history.length || !preferredTurn) return
    const matchingTurn = history.some((point) => String(point.game_turn) === preferredTurn)
    if (matchingTurn) {
      if (selectedTurn !== preferredTurn) setSelectedTurn(preferredTurn)
      return
    }
    const sortedDescending = [...history].sort((a, b) => Number(b.game_turn) - Number(a.game_turn))
    const fallback = sortedDescending.find((point) => Number(point.game_turn) <= Number(preferredTurn)) ?? sortedDescending[0]
    if (fallback) {
      const fallbackTurn = String(fallback.game_turn)
      if (selectedTurn !== fallbackTurn) setSelectedTurn(fallbackTurn)
      if (preferredTurn !== fallbackTurn) onSelectTurn(fallbackTurn)
    }
  }, [preferredTurn, history, selectedTurn, onSelectTurn])

  const selectedPlayer = players.find((player) => String(player.player_id) === selectedPlayerId)
  const selectedPlayerName = selectedPlayer?.player_name ?? String(detail?.snapshot?.country_name ?? `Joueur ${selectedPlayerId}`)
  const orderedHistory = useMemo(() => [...history].sort((a, b) => Number(a.game_turn) - Number(b.game_turn)), [history])
  const snapshot = detail?.snapshot
  const player = detail?.player
  const availableZones = detail ? availableZoneCount(detail) : 0
  const assumedZoneCount = zoneCountKeys.reduce((sum, key) => sum + Number(assumptions[key] || 0), 0)
  const zoneCountsValid = zoneCountKeys.every((key) => /^\d+$/.test(assumptions[key]))
    && assumedZoneCount <= availableZones
  function updateZoneCount(key: ZoneCountKey, rawValue: string) {
    if (!detail) return
    if (rawValue === '') { setAssumptions((current) => ({ ...current, [key]: '' })); return }
    const parsed = Number(rawValue)
    if (!Number.isFinite(parsed)) return
    const otherTotal = zoneCountKeys.filter((item) => item !== key).reduce((sum, item) => sum + Math.max(0, Number(assumptions[item]) || 0), 0)
    const maxForField = Math.max(0, availableZones - otherTotal)
    const next = Math.min(maxForField, Math.max(0, Math.floor(parsed)))
    setAssumptions((current) => ({ ...current, [key]: String(next) }))
  }
  const basicInformation: { label: string; value: ReactNode }[] = [
    { label: 'Rang', value: exact(snapshot?.rank ?? player?.rank) },
    { label: 'Score', value: scoreDisplay(detail?.score_model?.actual_score ?? snapshot?.score ?? player?.score) },
    { label: 'Ancienneté', value: exact(snapshot?.seniority_cycles ?? player?.seniority_turns) },
    { label: 'Population', value: exact(snapshot?.population ?? player?.population) },
    { label: 'Bonheur', value: value(snapshot?.happiness ?? player?.happiness, ' %') },
    { label: 'Superficie', value: exact(snapshot?.land_size ?? player?.land_size) },
    { label: 'Pollution', value: value(snapshot?.pollution ?? player?.pollution) },
    { label: 'Crédits carbone', value: exact(snapshot?.carbon_credits ?? player?.carbon_credits) },
    { label: 'Merveille', value: wonderDisplayName(snapshot?.wonder_type ?? player?.wonder_type) },
    { label: 'Taille de merveille', value: roundedWonderSize(snapshot?.wonder_score ?? player?.wonder_score) },
    { label: 'Éducation primaire', value: educationRatio(snapshot?.education_primary_ratio ?? player?.education_primary_ratio) },
    { label: 'Éducation secondaire', value: educationRatio(snapshot?.education_secondary_ratio ?? player?.education_secondary_ratio) },
    { label: 'Éducation supérieure', value: educationRatio(snapshot?.education_higher_ratio ?? player?.education_higher_ratio) },
    { label: 'Victoires / Défaites', value: `${exact(snapshot?.military_victories ?? player?.military_victories)} / ${exact(snapshot?.military_defeats ?? player?.military_defeats)}` },
    { label: 'Statut militaire', value: militaryStatusLabel(snapshot?.military_status ?? player?.military_status) },
  ]

  const researchAndEconomy: { label: string; value: ReactNode }[] = [
    { label: 'Zones habitables', value: exact(detail ? availableZoneCount(detail) : snapshot?.total_zones ?? player?.total_zones) },
    { label: 'Zones résidentielles supposées', value: exact(assumptions.habitable_zones) },
    { label: 'Zones agricoles supposées', value: exact(assumptions.agricultural_zones) },
    { label: 'Zones industrielles supposées', value: exact(assumptions.industrial_zones) },
    { label: 'Zones commerciales supposées', value: exact(assumptions.commercial_zones) },
    { label: 'PRech', value: exact(snapshot?.research_points ?? player?.research_points) },
    { label: 'Niveau agricole', value: exact(snapshot?.agriculture_tech ?? player?.agriculture_tech) },
    { label: 'Niveau industriel', value: exact(snapshot?.industry_tech ?? player?.industry_tech) },
    { label: 'Niveau commercial', value: exact(snapshot?.commerce_tech ?? player?.commerce_tech) },
    { label: 'Niveau technologique supérieur cumulé', value: exact(detail?.score_model?.tech_sup_level) },
  ]

  const otherInformation: { label: string; value: ReactNode; wide?: boolean }[] = [
    { label: 'Inscription', value: registeredDate(snapshot?.registered_timestamp) },
    { label: 'Vacances', value: snapshot?.is_on_vacation ? `Oui${snapshot.vacation_until ? ` · jusqu’au ${dayMonthDate(snapshot.vacation_until)}` : ''}` : snapshot?.is_on_vacation === false ? 'Non' : '—' },
    {
      label: 'Description',
      wide: true,
      value: <details className="raw-description-disclosure">
        <summary>Afficher la description</summary>
        <div className="raw-description">{readableDescription(snapshot?.description)}</div>
      </details>,
    },
  ]

  async function saveDayAssumptions() {
    if (!detail) return
    if (!scenarioId) { setError('Aucun scénario disponible. Ouvre Config et vérifie les scénarios.'); return }
    const integers = [assumptions.agricultural_zones, assumptions.habitable_zones, assumptions.industrial_zones, assumptions.commercial_zones]
    if (integers.some((item) => !/^\d+$/.test(item))) { setError('Les nombres de zones doivent être des entiers positifs ou nuls.'); return }
    const requestedZones = integers.reduce((sum, item) => sum + Number(item), 0)
    const totalZones = availableZoneCount(detail)
    if (requestedZones > totalZones) {
      setError(`La somme des quatre types (${formatNumber(requestedZones)}) dépasse le total disponible (${formatNumber(totalZones)}).`)
      return
    }
    setSaving(true); setError(null); setSuccess(null)
    try {
      await savePlayerOverrides(selectedPlayerId, {
        game_turn: Number(detail.game_turn), scenario_id: scenarioId,
        agricultural_zones: Number(assumptions.agricultural_zones),
        habitable_zones: Number(assumptions.habitable_zones),
        industrial_zones: Number(assumptions.industrial_zones),
        commercial_zones: Number(assumptions.commercial_zones),
        budget_200_enabled: assumptions.budget_200_enabled,
        dense_residential_zones_enabled: assumptions.dense_residential_zones_enabled,
        social_integration_pact_enabled: assumptions.social_integration_pact_enabled,
        reduced_holidays_enabled: assumptions.reduced_holidays_enabled,
        forest_exploitation_enabled: assumptions.forest_exploitation_enabled,
        industrial_zone_housing_enabled: assumptions.industrial_zone_housing_enabled,
      })
      setSuccess(`Hypothèses enregistrées pour le tour ${formatNumber(detail.game_turn)}. Actualisation des projections…`)
      try {
        const [result, refreshedHistory] = await Promise.all([
          getPlayerDetails(selectedPlayerId, Number(detail.game_turn), scenarioId),
          getPlayerHistory(selectedPlayerId, undefined, scenarioId || undefined),
        ])
        setDetail(result)
        setHistory(refreshedHistory.sort((a, b) => Number(b.game_turn) - Number(a.game_turn)))
        setSuccess(`Hypothèses enregistrées pour le tour ${formatNumber(detail.game_turn)}. Projections actualisées ; le classement sera recalculé sur la page principale.`)
      } catch (refreshError: unknown) {
        setError(`Les hypothèses sont bien enregistrées, mais l’actualisation des projections a échoué : ${refreshError instanceof Error ? refreshError.message : 'erreur inconnue'}. La page principale les recalculera à sa prochaine ouverture.`)
      }
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Impossible d’enregistrer les hypothèses.') }
    finally { setSaving(false) }
  }

  return <div className="page-content">
    <section className="panel page-panel">
      <div className="panel-header page-panel-header"><div><p className="eyebrow">FICHE INDIVIDUELLE</p><h2>Détails du joueur</h2><p>Valeurs brutes, historiques et hypothèses propres à un tour précis.</p></div><UserRound size={24} /></div>
      <div className="detail-toolbar detail-toolbar--four"><label className="form-field"><span>Pays</span><select value={selectedPlayerId} onChange={(e) => onSelectPlayer(e.target.value)}>{selectedPlayerId && !players.some((player) => String(player.player_id) === selectedPlayerId) && <option value={selectedPlayerId}>{selectedPlayerName}</option>}{players.map((player) => <option key={String(player.player_id)} value={String(player.player_id)}>{player.player_name}</option>)}</select></label><label className="form-field"><span>Tour à consulter</span><select value={selectedTurn} onChange={(e) => { setSelectedTurn(e.target.value); onSelectTurn(e.target.value) }} disabled={history.length === 0}>{orderedHistory.slice().reverse().map((point) => <option key={point.game_turn} value={String(point.game_turn)}>Tour {formatNumber(point.game_turn)}</option>)}</select></label><label className="form-field"><span>Groupe de scénarios</span><select value={scenarioId} onChange={(e) => onSelectScenario(e.target.value)}>{scenarios.map((scenario) => <option key={String(scenario.scenario_id)} value={String(scenario.scenario_id)}>{scenario.scenario_name}{scenario.is_default ? ' · défaut' : ''}</option>)}</select></label><div className="detail-toolbar__meta"><span>Tour global courant</span><strong>{selectedPlayer?.current_game_turn == null ? '—' : formatNumber(selectedPlayer.current_game_turn)}</strong></div></div>
      {detailsLoading && <DetailsLoadingSkeleton />}
      {error && <p className="notice notice--error" role="alert">{error}</p>}
      {detailsReady && detail && <>
        <div className="detail-heading-row"><div><h3>{String(detail.snapshot?.country_name ?? selectedPlayer?.player_name ?? 'Joueur')}</h3><p>{detail.snapshot?.ruler_name ? `Dirigeant : ${detail.snapshot.ruler_name} · ` : ''}Tour {formatNumber(detail.game_turn)} · rang {exact(detail.snapshot?.rank)}</p></div><span className="anathas-status anathas-status--completed">Capture historisée</span></div>
        <div className="raw-data-groups" aria-label="Données brutes du joueur">
          <section className="raw-data-group" aria-labelledby="raw-data-basic-title">
            <h3 className="raw-data-group__title" id="raw-data-basic-title">Informations de base</h3>
            <dl className="raw-data-list">
              {basicInformation.map(({ label, value: shown }) => <div className="raw-data-item" key={label}><dt>{label}</dt><dd>{shown}</dd></div>)}
            </dl>
          </section>
          <section className="raw-data-group" aria-labelledby="raw-data-research-title">
            <h3 className="raw-data-group__title" id="raw-data-research-title">Recherche et économie</h3>
            <dl className="raw-data-list">
              {researchAndEconomy.map(({ label, value: shown }) => <div className="raw-data-item" key={label}><dt>{label}</dt><dd>{shown}</dd></div>)}
            </dl>
          </section>
          <section className="raw-data-group raw-data-group--full" aria-labelledby="raw-data-other-title">
            <h3 className="raw-data-group__title" id="raw-data-other-title">Autre</h3>
            <dl className="raw-data-list raw-data-list--other">
              {otherInformation.map(({ label, value: shown, wide }) => <div className={`raw-data-item${wide ? ' raw-data-item--wide' : ''}`} key={label}><dt>{label}</dt><dd>{shown}</dd></div>)}
            </dl>
          </section>
        </div>

        <section className="day-assumptions" aria-label="Hypothèses personnalisées">
          <div className="panel-header page-panel-header">
            <div>
              <p className="eyebrow">SURCHARGES PERSONNELLES</p>
              <h3>Hypothèses pour le tour {formatNumber(detail.game_turn)}</h3>
              <p>
                Ces valeurs sont enregistrées dans « {scenarios.find((scenario) => String(scenario.scenario_id) === scenarioId)?.scenario_name ?? 'le scénario sélectionné'} » pour ce tour, sans altérer la capture Anathas.
              </p>
            </div>
            <SlidersHorizontal size={22} />
          </div>

          <section className="assumption-section" aria-labelledby="assumptions-zones-title">
            <h4 className="assumption-section__title" id="assumptions-zones-title">Zones</h4>
            <p className={`field-note assumption-section__note ${zoneCountsValid ? '' : 'field-note--error'}`} role="status">
              Répartition supposée : {formatNumber(assumedZoneCount)} / {formatNumber(availableZones)} zones disponibles.
              {zoneCountsValid ? ` Il reste ${formatNumber(Math.max(0, availableZones - assumedZoneCount))} zone(s) non affectée(s).` : ' La somme ne doit pas dépasser le total disponible.'}
            </p>
            <div className="form-grid form-grid--three">
              <label className="form-field">
                <span>Zones agricoles supposées</span>
                <input
                  type="number"
                  min="0"
                  max={Math.max(0, availableZones - Number(assumptions.habitable_zones || 0) - Number(assumptions.industrial_zones || 0) - Number(assumptions.commercial_zones || 0))}
                  step="1"
                  value={assumptions.agricultural_zones}
                  onChange={(e) => updateZoneCount('agricultural_zones', e.target.value)}
                />
              </label>
              <label className="form-field">
                <span>Zones habitables / résidentielles supposées</span>
                <input
                  type="number"
                  min="0"
                  max={Math.max(0, availableZones - Number(assumptions.agricultural_zones || 0) - Number(assumptions.industrial_zones || 0) - Number(assumptions.commercial_zones || 0))}
                  step="1"
                  value={assumptions.habitable_zones}
                  onChange={(e) => updateZoneCount('habitable_zones', e.target.value)}
                />
              </label>
              <label className="form-field">
                <span>Zones industrielles supposées</span>
                <input
                  type="number"
                  min="0"
                  max={Math.max(0, availableZones - Number(assumptions.habitable_zones || 0) - Number(assumptions.agricultural_zones || 0) - Number(assumptions.commercial_zones || 0))}
                  step="1"
                  value={assumptions.industrial_zones}
                  onChange={(e) => updateZoneCount('industrial_zones', e.target.value)}
                />
              </label>
              <label className="form-field">
                <span>Zones commerciales supposées</span>
                <input
                  type="number"
                  min="0"
                  max={Math.max(0, availableZones - Number(assumptions.habitable_zones || 0) - Number(assumptions.agricultural_zones || 0) - Number(assumptions.industrial_zones || 0))}
                  step="1"
                  value={assumptions.commercial_zones}
                  onChange={(e) => updateZoneCount('commercial_zones', e.target.value)}
                />
              </label>
            </div>
          </section>

          <section className="assumption-section" aria-labelledby="assumptions-laws-title">
            <h4 className="assumption-section__title" id="assumptions-laws-title">Lois</h4>
            <fieldset className="parameter-group">
              <legend>Multiplicateurs des lois</legend>
              <div className="form-grid form-grid--three">
                <label className="form-field form-field--checkbox">
                  <span>Zones résidentielles denses</span>
                  <div className="checkbox-row">
                    <input type="checkbox" checked={assumptions.dense_residential_zones_enabled} onChange={(e) => setAssumptions({ ...assumptions, dense_residential_zones_enabled: e.target.checked })} />
                    <strong>{assumptions.dense_residential_zones_enabled ? 'Activé · +20 %' : 'Désactivé · +0 %'}</strong>
                  </div>
                  <small>Ajoute +20 % à la capacité des zones résidentielles.</small>
                </label>
                <label className="form-field form-field--checkbox">
                  <span>Pacte d’intégration sociale</span>
                  <div className="checkbox-row">
                    <input type="checkbox" checked={assumptions.social_integration_pact_enabled} onChange={(e) => setAssumptions({ ...assumptions, social_integration_pact_enabled: e.target.checked })} />
                    <strong>{assumptions.social_integration_pact_enabled ? 'Activé · +20 %' : 'Désactivé · +0 %'}</strong>
                  </div>
                  <small>Ajoute +20 % à la capacité des zones résidentielles.</small>
                </label>
                <label className="form-field form-field--checkbox">
                  <span>Réduction des congés</span>
                  <div className="checkbox-row">
                    <input type="checkbox" checked={assumptions.reduced_holidays_enabled} onChange={(e) => setAssumptions({ ...assumptions, reduced_holidays_enabled: e.target.checked })} />
                    <strong>{assumptions.reduced_holidays_enabled ? 'Activé · ×1,3' : 'Désactivé · ×1'}</strong>
                  </div>
                  <small>Revenus industrie + commerce.</small>
                </label>
                <label className="form-field form-field--checkbox">
                  <span>Exploitation des forêts</span>
                  <div className="checkbox-row">
                    <input type="checkbox" checked={assumptions.forest_exploitation_enabled} onChange={(e) => setAssumptions({ ...assumptions, forest_exploitation_enabled: e.target.checked })} />
                    <strong>{assumptions.forest_exploitation_enabled ? 'Activé · ×1,4' : 'Désactivé · ×1'}</strong>
                  </div>
                  <small>Revenus agricoles.</small>
                </label>
                <label className="form-field form-field--checkbox">
                  <span>Logements en zones industrielles</span>
                  <div className="checkbox-row">
                    <input type="checkbox" checked={assumptions.industrial_zone_housing_enabled} onChange={(e) => setAssumptions({ ...assumptions, industrial_zone_housing_enabled: e.target.checked })} />
                    <strong>{assumptions.industrial_zone_housing_enabled ? 'Activé · ×1,4' : 'Désactivé · ×1'}</strong>
                  </div>
                  <small>Ajoute +40 % à la capacité des zones industrielles.</small>
                </label>
              </div>
            </fieldset>
          </section>

          <section className="assumption-section" aria-labelledby="assumptions-other-title">
            <h4 className="assumption-section__title" id="assumptions-other-title">Autres paramètres</h4>
            <fieldset className="parameter-group">
              <legend>Budget et financement</legend>
              <div className="form-grid form-grid--two">
                <label className="form-field form-field--checkbox">
                  <span>Budget 200 %</span>
                  <div className="checkbox-row">
                    <input type="checkbox" checked={assumptions.budget_200_enabled} onChange={(e) => setAssumptions({ ...assumptions, budget_200_enabled: e.target.checked })} />
                    <strong>{assumptions.budget_200_enabled ? 'Activé · ×1,15' : 'Désactivé · ×1'}</strong>
                  </div>
                  <small>Bonus de productivité technologique à 200 % de financement.</small>
                </label>
              </div>
            </fieldset>
          </section>

          <div className="form-actions">
            <button className="primary-button" type="button" disabled={saving || !scenarioId || !zoneCountsValid} onClick={() => void saveDayAssumptions()}>
              <Save size={16} /> {saving ? 'Enregistrement…' : 'Enregistrer pour ce tour'}
            </button>
            {detail.override?.updated_at && (
              <span className="field-note">
                Modifié le {new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(detail.override.updated_at))}
              </span>
            )}
          </div>
        </section>

      </>}
    </section>
    {detailsReady && !detailsLoading && orderedHistory.length > 0 && <PlayerHistoryCharts history={orderedHistory} playerName={selectedPlayerName} selectedTurn={selectedTurn} scenarioName={scenarios.find((scenario) => String(scenario.scenario_id) === scenarioId)?.scenario_name ?? 'scénario par défaut'} />}
    {success && <p className="notice notice--success" role="status">{success}</p>}
    {!detailsLoading && history.length === 0 && selectedPlayerId && <section className="panel page-panel"><p className="page-message">Aucun historique de calcul n’est disponible pour ce joueur.</p></section>}
  </div>
}
