import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import type { PlayerHistoryPoint } from '../types/history'
import { formatNumber } from '../utils/numberFormat'

type ChartPoint = { tour: number } & Record<string, number | null>
type Series = { key: string; label: string; color: string }

interface PlayerHistoryChartsProps {
  history: PlayerHistoryPoint[]
  playerName: string
  selectedTurn: string
  scenarioName: string
}

function numeric(input: unknown): number | null {
  if (input === null || input === undefined || input === '') return null
  const parsed = Number(input)
  return Number.isFinite(parsed) ? parsed : null
}

function formatValue(input: unknown, fractionDigits = 2): string {
  const parsed = numeric(input)
  if (parsed === null) return '—'
  return formatNumber(parsed, { maximumFractionDigits: fractionDigits })
}

function formatGiga(input: unknown): string {
  const parsed = numeric(input)
  return parsed === null ? '—' : `${formatNumber(parsed, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} G`
}

function compactAxis(input: number, maximumFractionDigits = 1): string {
  return formatNumber(input, { maximumFractionDigits })
}

// Les valeurs économiques source sont déjà exprimées en milliards : 1 000 G = 1 T.
function economicAxis(input: number): string {
  const scaled = Math.abs(input) >= 1_000 ? input / 1_000 : input
  const unit = Math.abs(input) >= 1_000 ? ' T' : ' G'
  return `${formatNumber(scaled, { maximumFractionDigits: 1 })}${unit}`
}

function cleanScenarioName(input: string | null | undefined): string {
  return (input ?? '—').trim() || '—'
}

function HistoryChart({
  title,
  data,
  series,
  reversedRank = false,
  compact = false,
  compactFractionDigits = 1,
  yAxisFormatter,
  valueFormatter,
}: {
  title: string
  data: ChartPoint[]
  series: Series[]
  reversedRank?: boolean
  compact?: boolean
  compactFractionDigits?: number
  yAxisFormatter?: (value: number) => string
  valueFormatter?: (value: number) => string
}) {
  const hasValues = series.some((item) => data.some((point) => typeof point[item.key] === 'number'))
  return (
    <article className="history-chart">
      <h3>{title}</h3>
      {!hasValues ? <p className="history-empty">Aucune donnée historique pour ce graphique.</p> : (
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={data} margin={{ top: 12, right: 18, bottom: 8, left: 4 }}>
            <CartesianGrid stroke="#293550" strokeDasharray="3 3" />
            <XAxis dataKey="tour" stroke="#98a5c1" tickFormatter={(v) => `C${formatNumber(v)}`} />
            <YAxis
              stroke="#98a5c1"
              reversed={reversedRank}
              allowDecimals={!reversedRank}
              domain={reversedRank ? [1, 'auto'] : ['auto', 'auto']}
              tickFormatter={yAxisFormatter ?? (compact ? (v) => compactAxis(v, compactFractionDigits) : undefined)}
              width={compact || yAxisFormatter ? 104 : 72}
            />
            <Tooltip
              contentStyle={{ background: '#141c30', border: '1px solid #34415f' }}
              labelFormatter={(v) =>
  `C${formatNumber(
    typeof v === "string" || typeof v === "number" ? v : null
  )}`
}
              formatter={(v, name) => [v === null || v === undefined ? '—' : valueFormatter ? valueFormatter(Number(v)) : formatValue(v, 3), name]}
            />
            {series.map((item) => (
              <Line
                key={item.key}
                type="monotone"
                dataKey={item.key}
                name={item.label}
                stroke={item.color}
                strokeWidth={2}
                dot={{ r: 3 }}
                connectNulls
                activeDot={{ r: 5 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
    </article>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="detail-stat history-stat"><span>{label}</span><strong>{value}</strong></div>
}

export default function PlayerHistoryCharts({ history, playerName, selectedTurn, scenarioName }: PlayerHistoryChartsProps) {
  const orderedHistory = [...history].sort((a, b) => Number(a.game_turn) - Number(b.game_turn))
  const data: ChartPoint[] = orderedHistory.map((point) => ({
    tour: Number(point.game_turn),
    rentabilite: numeric(point.tech_profitability),
    rangRentabilite: numeric(point.profitability_rank),
    rangRentabilitePlus1: numeric(point.projected_profitability_rank),
    rangRentabilitePlus10: numeric(point.profitability_10_turn_rank),
    potentielEco: numeric(point.max_economic_potential_billion),
    rangEco: numeric(point.economic_potential_rank),
    agricultureTech: numeric(point.agriculture_tech),
    industrieTech: numeric(point.industry_tech),
    commerceTech: numeric(point.commerce_tech),
    educationPrimaire: numeric(point.education_primary_pct),
    educationSecondaire: numeric(point.education_secondary_pct),
    educationSuperieure: numeric(point.education_higher_pct),
    population: numeric(point.population),
    bonheur: numeric(point.happiness),
    territoire: numeric(point.land_size),
    pollution: numeric(point.pollution),
  }))
  const selectedPoint = orderedHistory.find((point) => String(point.game_turn) === selectedTurn)
    ?? orderedHistory[orderedHistory.length - 1]

  const scenarioValues = selectedPoint ? [
    { label: 'Agriculture', value: selectedPoint.agriculture_scenario_billion },
    { label: 'Industrie', value: selectedPoint.industry_scenario_billion },
    { label: 'Agro-industrie (Agriculture + Industrie)', value: selectedPoint.mixed_agriculture_industry_scenario_billion },
    { label: 'Commerce', value: selectedPoint.commerce_scenario_billion },
    { label: 'Guerre (Industrie + Commerce + Complexe militaro-industriel)', value: selectedPoint.war_scenario_billion },
    { label: 'Agro-industrie militarisée (Agriculture + Industrie + Complexe militaro-industriel)', value: selectedPoint.militarized_agro_industry_scenario_billion },
    ...(selectedPoint.custom_scenario_enabled ? [{ label: selectedPoint.custom_scenario_name || 'Scénario personnalisé', value: selectedPoint.custom_economic_scenario_billion }] : []),
  ] : []

  return (
    <>
      <section className="panel history-panel history-section">
        <div className="panel-header">
          <div>
            <p className="eyebrow">POTENTIEL ÉCONOMIQUE</p>
            <h2>Économie</h2>
            <p>{playerName} · tour sélectionné : {selectedTurn ? formatNumber(selectedTurn) : '—'} · hypothèses : {scenarioName || 'scénario par défaut'}</p>
          </div>
        </div>
        <div className="detail-stat-grid history-summary-grid">
          <Stat label="Potentiel économique maximal" value={formatGiga(selectedPoint?.max_economic_potential_billion)} />
          <Stat label="Rang économique" value={formatValue(selectedPoint?.economic_potential_rank, 0)} />
          <Stat label="Meilleur scénario" value={cleanScenarioName(selectedPoint?.economic_best_scenario)} />
        </div>
        <div className="economic-scenario-list">
          <div className="economic-scenario-list__header"><h3>Scénarios économiques du tour {selectedTurn ? formatNumber(selectedTurn) : '—'}</h3><span>Valeurs en G</span></div>
          {scenarioValues.every((scenario) => numeric(scenario.value) === null) ? <p className="history-empty">Les résultats détaillés des scénarios ne sont pas disponibles pour ce tour.</p> : (
            <div className="economic-scenario-list__grid">
              {scenarioValues.map((scenario) => {
                const bestLabel = cleanScenarioName(selectedPoint?.economic_best_scenario)
                const isBest = bestLabel === scenario.label
                return <div className={`economic-scenario-value ${isBest ? 'economic-scenario-value--best' : ''}`} key={scenario.label}>
                  <span>{scenario.label}{isBest ? ' · meilleur' : ''}</span>
                  <strong>{formatGiga(scenario.value)}</strong>
                </div>
              })}
            </div>
          )}
        </div>
        {orderedHistory.length === 0 ? <p className="history-empty">Aucune donnée historique disponible.</p> : (
          <div className="history-grid">
            <HistoryChart title="Évolution du potentiel économique" data={data} series={[{ key: 'potentielEco', label: 'Potentiel économique (G)', color: '#ffbd69' }]} yAxisFormatter={economicAxis} valueFormatter={economicAxis} />
            <HistoryChart title="Évolution du rang économique" data={data} series={[{ key: 'rangEco', label: 'Rang économique', color: '#c49bff' }]} reversedRank />
          </div>
        )}
      </section>

      <section className="panel history-panel history-section">
        <div className="panel-header">
          <div>
            <p className="eyebrow">RENDEMENT ET RECHERCHE</p>
            <h2>Technologie</h2>
            <p>Rentabilité et rangs, avec les trois branches technologiques.</p>
          </div>
        </div>
        <div className="detail-stat-grid history-summary-grid">
          <Stat label="Rentabilité actuelle" value={formatValue(selectedPoint?.tech_profitability, 1)} />
          <Stat label="Rang technologique" value={formatValue(selectedPoint?.profitability_rank, 0)} />
          <Stat label="Rang projeté à +1 tour" value={formatValue(selectedPoint?.projected_profitability_rank, 0)} />
          <Stat label="Rang projeté à +10 tours" value={formatValue(selectedPoint?.profitability_10_turn_rank, 0)} />
        </div>
        {orderedHistory.length === 0 ? <p className="history-empty">Aucune donnée historique disponible.</p> : (
          <div className="history-grid">
            <HistoryChart title="Évolution de la rentabilité" data={data} series={[{ key: 'rentabilite', label: 'Rentabilité', color: '#8da8ff' }]} />
            <HistoryChart title="Évolution du classement par rentabilité" data={data} series={[{ key: 'rangRentabilite', label: 'Rang par rentabilité', color: '#67d6b3' }]} reversedRank />
            <HistoryChart title="Évolution des trois niveaux technologiques" data={data} series={[
              { key: 'agricultureTech', label: 'Agriculture', color: '#78cf8a' },
              { key: 'industrieTech', label: 'Industrie', color: '#8da8ff' },
              { key: 'commerceTech', label: 'Commerce', color: '#ffbd69' },
            ]} compact />
          </div>
        )}
      </section>

      <section className="panel history-panel history-section">
        <div className="panel-header">
          <div>
            <p className="eyebrow">INDICATEURS DU PAYS</p>
            <h2>Général</h2>
            <p>Évolution des paramètres démographiques, sociaux et territoriaux.</p>
          </div>
        </div>
        {orderedHistory.length === 0 ? <p className="history-empty">Aucune donnée historique disponible.</p> : (
          <div className="history-grid">
            <HistoryChart title="Évolution des taux d’éducation" data={data} series={[
              { key: 'educationPrimaire', label: 'Primaire (%)', color: '#8da8ff' },
              { key: 'educationSecondaire', label: 'Secondaire (%)', color: '#67d6b3' },
              { key: 'educationSuperieure', label: 'Supérieure (%)', color: '#ffbd69' },
            ]} />
            <HistoryChart title="Évolution de la population" data={data} series={[{ key: 'population', label: 'Population', color: '#8da8ff' }]} compact />
            <HistoryChart title="Évolution du bonheur" data={data} series={[{ key: 'bonheur', label: 'Bonheur', color: '#ffbd69' }]} />
            <HistoryChart title="Évolution du territoire" data={data} series={[{ key: 'territoire', label: 'Superficie', color: '#67d6b3' }]} compact />
            <HistoryChart title="Évolution de la pollution" data={data} series={[{ key: 'pollution', label: 'Pollution', color: '#c49bff' }]} compact compactFractionDigits={2} />
          </div>
        )}
      </section>
    </>
  )
}
