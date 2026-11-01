import { useEffect, useState } from 'react'
import { Clock3, LayoutDashboard, LogOut, Settings2, ShieldCheck, UserRound, Users } from 'lucide-react'
import { getAvailableDashboardTurns, getCurrentDashboard } from './api/dashboard'
import { getUserConfig, type UserScenario } from './api/config'
import type { AuthUser } from './api/auth'
import type { DashboardPlayer } from './types/dashboard'
import StatCard from './components/StatCard'
import PlayerTable from './components/PlayerTable'
import RankingSection from './components/RankingSection'
import HistoryPage from './pages/HistoryPage'
import ConfigPage from './pages/ConfigPage'
import PlayerDetailsPage from './pages/PlayerDetailsPage'
import AdminPage from './pages/AdminPage'
import { formatFixedNumber, formatNumber } from './utils/numberFormat'

type PageKey = 'index' | 'history' | 'config' | 'details' | 'admin'
const navigation: { key: PageKey; label: string; icon: typeof LayoutDashboard }[] = [
  { key: 'index', label: 'Vue générale', icon: LayoutDashboard },
  { key: 'history', label: 'Historique', icon: Clock3 },
  { key: 'config', label: 'Config', icon: Settings2 },
  { key: 'details', label: 'Détails', icon: UserRound },
  { key: 'admin', label: 'Administration', icon: ShieldCheck },
]

function Dashboard({ onLogout, user }: { onLogout: () => void; user: AuthUser }) {
  const [players, setPlayers] = useState<DashboardPlayer[]>([])
  const [scenarios, setScenarios] = useState<UserScenario[]>([])
  const [selectedScenarioId, setSelectedScenarioId] = useState('')
  const [scenarioLoaded, setScenarioLoaded] = useState(false)
  const [selectedPlayerId, setSelectedPlayerId] = useState('')
  const [page, setPage] = useState<PageKey>('index')
  const [availableTurns, setAvailableTurns] = useState<number[]>([])
  const [selectedTurn, setSelectedTurn] = useState('')
  const [currentGameTurn, setCurrentGameTurn] = useState(0)
  const [turnsLoaded, setTurnsLoaded] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    getUserConfig(controller.signal).then((config) => {
      if (controller.signal.aborted) return
      setScenarios(config.scenarios)
      const defaultScenario = config.scenarios.find((scenario) => scenario.is_default) ?? config.scenarios[0]
      if (defaultScenario) {
        setSelectedScenarioId((current) => config.scenarios.some((scenario) => String(scenario.scenario_id) === current)
          ? current
          : String(defaultScenario.scenario_id))
      } else {
        setError('Aucun scénario économique n’est configuré pour cette partie.')
        setLoading(false)
      }
    }).catch((err: unknown) => {
      if (!controller.signal.aborted) {
        setError(err instanceof Error ? err.message : 'Impossible de charger les scénarios.')
        setLoading(false)
      }
    }).finally(() => {
      if (!controller.signal.aborted) setScenarioLoaded(true)
    })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    getAvailableDashboardTurns().then((data) => {
      if (controller.signal.aborted) return
      const turns = [...new Set(data.turns.map(Number).filter((turn) => Number.isInteger(turn) && turn >= 0))]
        .sort((a, b) => b - a)
      setCurrentGameTurn(Number(data.current_turn) || 0)
      setAvailableTurns(turns)
      setSelectedTurn((current) => turns.some((turn) => String(turn) === current)
        ? current
        : String(turns.includes(Number(data.current_turn)) ? Number(data.current_turn) : turns[0] ?? ''))
    }).catch((err: unknown) => {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Impossible de charger les tours disponibles.')
    }).finally(() => {
      if (!controller.signal.aborted) setTurnsLoaded(true)
    })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (page !== 'index' || !turnsLoaded || !scenarioLoaded || !selectedScenarioId) return
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    const requestedTurn = selectedTurn === '' ? undefined : Number(selectedTurn)
    getCurrentDashboard(requestedTurn, selectedScenarioId, controller.signal).then((data) => {
      if (controller.signal.aborted) return
      setPlayers(data)
      setSelectedPlayerId((current) => data.some((player) => String(player.player_id) === current)
        ? current
        : String(data[0]?.player_id ?? ''))
    }).catch((err: unknown) => {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Erreur lors du chargement du dashboard.')
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [page, selectedTurn, turnsLoaded, scenarioLoaded, selectedScenarioId])

  function showPlayerDetails(playerId: string) {
    setSelectedPlayerId(playerId)
    setPage('details')
  }

  const currentTurn = currentGameTurn || Number(players[0]?.current_game_turn ?? 0)
  const displayedTurn = selectedTurn === '' ? currentTurn : Number(selectedTurn)
  const isHistoricalView = displayedTurn !== currentTurn
  const bestTechPlayer = [...players].sort((a, b) => Number(b.tech_profitability) - Number(a.tech_profitability))[0]
  const bestEconomicPlayer = [...players].sort((a, b) => Number(b.max_economic_potential_billion) - Number(a.max_economic_potential_billion))[0]
  const totalProjectedProduction = players.reduce((sum, player) => sum + Number(player.next_turn_tech_production), 0)
  const activePage = navigation.find((item) => item.key === page)

  if (loading) return <main className="page"><p className="page-message">Chargement de Tablanathas…</p></main>
  if (error) return <main className="page"><p className="notice notice--error">{error}</p></main>

  return <main className="page">
    <header className="app-header">
      <div className="brand-lockup"><div className="brand-mark"><img src="/logo.png" alt="Logo Tablanathas" /></div><div><p className="eyebrow">TABLEAU DE BORD STRATÉGIQUE</p><h1>Tablanathas</h1><p className="subtitle">Analyse de la partie · tour {formatNumber(displayedTurn)}{isHistoricalView ? ' · vue historique' : ''}</p></div></div>
      <div className="header-actions">
        <label className="turn-badge turn-badge--select" htmlFor="dashboard-turn"><span>Tour consulté</span>
          <select id="dashboard-turn" value={selectedTurn || String(currentTurn)} onChange={(event) => setSelectedTurn(event.target.value)} disabled={!availableTurns.length}>
            {availableTurns.length ? availableTurns.map((turn) => <option key={turn} value={String(turn)}>Tour {formatNumber(turn)}{turn === currentTurn ? ' · actuel' : ''}</option>) : <option value={String(currentTurn)}>Tour {formatNumber(currentTurn)} · actuel</option>}
          </select>
        </label>
        <button className="logout-button" type="button" onClick={onLogout}><LogOut size={15} /> Déconnexion</button>
      </div>
    </header>

    <nav className="app-nav" aria-label="Navigation principale">
      {navigation.filter((item) => item.key !== 'admin' || user.role === 'admin').map(({ key, label, icon: Icon }) => <button type="button" key={key} className={`app-nav__item ${page === key ? 'active' : ''}`} aria-current={page === key ? 'page' : undefined} onClick={() => setPage(key)}><Icon size={17} />{label}{key === 'index' && <span className="nav-count">{formatNumber(players.length)}</span>}</button>)}
    </nav>

    <div className="page-title-row"><div><p className="eyebrow">{activePage?.label.toUpperCase()}</p><h2>{({ index: 'Vue générale', history: 'Historique des captures', config: 'Configuration personnelle', details: 'Détails du joueur', admin: 'Administration des utilisateurs' })[page]}</h2></div>{page === 'index' && <span className="page-meta"><Users size={15} /> {formatNumber(players.length)} joueurs · tour {formatNumber(displayedTurn)} · scénario {scenarios.find((scenario) => String(scenario.scenario_id) === selectedScenarioId)?.scenario_name ?? '—'}</span>}</div>

    {page === 'index' && <div className="page-content">
      {isHistoricalView && <p className="notice historical-view-notice" role="status">Tu consultes les données enregistrées au tour {formatNumber(displayedTurn)}. Les calculs personnels sont appliqués aux données historiques de ce tour.</p>}
      <section className="stats-grid">
        <StatCard label="Joueurs" value={players.length} description={`Joueurs présents au tour ${formatNumber(displayedTurn)}`} />
        <StatCard label="Meilleure rentabilité tech." value={bestTechPlayer?.player_name ?? '—'} description={bestTechPlayer ? `${formatFixedNumber(bestTechPlayer.tech_profitability, 1)} points` : undefined} />
        <StatCard label="Meilleur potentiel économique" value={bestEconomicPlayer?.player_name ?? '—'} description={bestEconomicPlayer ? `${formatFixedNumber(bestEconomicPlayer.max_economic_potential_billion, 1)} G` : undefined} />
        <StatCard label="Production tech. projetée" value={formatFixedNumber(totalProjectedProduction, 1)} description="Somme des projections individuelles" />
      </section>
      <section className="panel">
        <div className="panel-header"><div><h2>Joueurs</h2><p>Classement général par rentabilité technologique. Clique sur un nom pour ouvrir sa fiche.</p></div><span className="player-count"><Users size={16} /> {formatNumber(players.length)}</span></div>
        <PlayerTable players={players} onSelectPlayer={showPlayerDetails} />
      </section>
      <RankingSection players={players} onSelectPlayer={showPlayerDetails} />
    </div>}
    {page === 'history' && <HistoryPage onSelectPlayer={showPlayerDetails} />}
    {page === 'config' && <ConfigPage />}
    {page === 'details' && <PlayerDetailsPage
      players={players}
      selectedPlayerId={selectedPlayerId}
      onSelectPlayer={setSelectedPlayerId}
      preferredTurn={selectedTurn}
      onSelectTurn={setSelectedTurn}
      scenarios={scenarios}
      selectedScenarioId={selectedScenarioId}
      onSelectScenario={setSelectedScenarioId}
    />}
    {page === 'admin' && user.role === 'admin' && <AdminPage currentUserId={user.user_id} />}

    <footer className="app-footer"><span>Tablanathas</span><span>Captures automatiques · Fuseau Europe/Paris</span></footer>
  </main>
}

export default Dashboard
