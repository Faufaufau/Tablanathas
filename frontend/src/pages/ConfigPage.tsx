import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Check, KeyRound, Plus, Save, Settings2, Star, Trash2 } from 'lucide-react'
import { createUserScenario, deleteUserScenario, getUserConfig, saveUserSettings, setUserDefaultScenario, updateUserScenario, type EconomicParameters, type PersonalSettings, type UserConfig, type UserScenario } from '../api/config'
import { changeOwnPassword } from '../api/auth'
import { formatNumber } from '../utils/numberFormat'

const initialParameters: EconomicParameters = {
  mixed_agriculture_industry_agriculture_population_pct: 70,
  mixed_agriculture_industry_industry_population_pct: 30,
  military_industry_population_pct: 30,
  military_commerce_population_pct: 70,
  militarized_agro_industry_agriculture_population_pct: 70,
  militarized_agro_industry_industry_population_pct: 30,
  custom_scenario_enabled: false,
  custom_scenario_name: 'Scénario personnalisé',
  custom_agriculture_population_pct: 33.33,
  custom_industry_population_pct: 33.33,
  custom_commerce_population_pct: 33.34,
}
type PopulationAllocationKey =
  | 'mixed_agriculture_industry_agriculture_population_pct'
  | 'mixed_agriculture_industry_industry_population_pct'
  | 'military_industry_population_pct'
  | 'military_commerce_population_pct'
  | 'militarized_agro_industry_agriculture_population_pct'
  | 'militarized_agro_industry_industry_population_pct'
  | 'custom_agriculture_population_pct'
  | 'custom_industry_population_pct'
  | 'custom_commerce_population_pct'
const allocationGroups: { id: string; title: string; description: string; industryPenalty?: boolean; fields: { key: PopulationAllocationKey; label: string }[] }[] = [
  { id: 'agro-industry', title: 'Agro-industrie (Agriculture + Industrie)', description: 'Répartition de la population investie en économie entre agriculture et industrie.', fields: [
    { key: 'mixed_agriculture_industry_agriculture_population_pct', label: 'Population affectée à l’agriculture' },
    { key: 'mixed_agriculture_industry_industry_population_pct', label: 'Population affectée à l’industrie' },
  ] },
  { id: 'war', title: 'Guerre (Industrie + Commerce + Complexe militaro-industriel)', description: 'La contribution de la part industrielle est divisée par 10 dans le calcul du potentiel économique (30 % affichés correspondent à 3 % utilisés).', industryPenalty: true, fields: [
    { key: 'military_industry_population_pct', label: 'Population affectée à l’industrie' },
    { key: 'military_commerce_population_pct', label: 'Population affectée au commerce' },
  ] },
  { id: 'militarized-agro-industry', title: 'Agro-industrie militarisée (Agriculture + Industrie + Complexe militaro-industriel)', description: 'La contribution de la part industrielle est divisée par 10 dans le calcul du potentiel économique (30 % affichés correspondent à 3 % utilisés).', industryPenalty: true, fields: [
    { key: 'militarized_agro_industry_agriculture_population_pct', label: 'Population affectée à l’agriculture' },
    { key: 'militarized_agro_industry_industry_population_pct', label: 'Population affectée à l’industrie' },
  ] },
]
const fixedScenarios = [
  { title: 'Agriculture', branch: 'Agriculture' },
  { title: 'Industrie', branch: 'Industrie' },
  { title: 'Commerce', branch: 'Commerce' },
] as const
const customAllocationFields: { key: PopulationAllocationKey; label: string }[] = [
  { key: 'custom_agriculture_population_pct', label: 'Agriculture' },
  { key: 'custom_industry_population_pct', label: 'Industrie' },
  { key: 'custom_commerce_population_pct', label: 'Commerce' },
]
const allocationTotal = (parameters: EconomicParameters, keys: PopulationAllocationKey[]) =>
  keys.reduce((total, key) => {
    const value = Number(parameters[key])
    return total + (Number.isFinite(value) ? value : 0)
  }, 0)
const cloneScenario = (scenario: UserScenario): UserScenario => ({ ...scenario, parameters: { ...scenario.parameters } })
type ZonePercentageKey = 'default_habitable_zones_pct' | 'default_agricultural_zones_pct' | 'default_industrial_zones_pct' | 'default_commercial_zones_pct'
const zonePercentageFields: { key: ZonePercentageKey; label: string; hint: string }[] = [
  { key: 'default_habitable_zones_pct', label: 'Zones résidentielles / habitables', hint: 'Pourcentage appliqué au total de zones de chaque joueur.' },
  { key: 'default_agricultural_zones_pct', label: 'Zones agricoles', hint: 'Pourcentage appliqué au total de zones de chaque joueur.' },
  { key: 'default_industrial_zones_pct', label: 'Zones industrielles', hint: 'Pourcentage appliqué au total de zones de chaque joueur.' },
  { key: 'default_commercial_zones_pct', label: 'Zones commerciales', hint: 'Pourcentage appliqué au total de zones de chaque joueur.' },
]

export default function ConfigPage() {
  const [config, setConfig] = useState<UserConfig | null>(null)
  const [settings, setSettings] = useState<PersonalSettings>({ default_agricultural_zones_pct: 10, default_habitable_zones_pct: 40, default_industrial_zones_pct: 20, default_commercial_zones_pct: 30, population_in_economy_pct: 80, default_budget_200_enabled: false, default_dense_residential_zones_enabled: true, default_social_integration_pact_enabled: false, default_reduced_holidays_enabled: false, default_forest_exploitation_enabled: false, default_industrial_zone_housing_enabled: false })
  const [selectedId, setSelectedId] = useState('')
  const [draft, setDraft] = useState<UserScenario | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmNewPassword, setConfirmNewPassword] = useState('')
  const [passwordBusy, setPasswordBusy] = useState(false)

  async function loadConfig(preferredId?: string) {
    const data = await getUserConfig()
    setConfig(data); setSettings(data.settings)
    const item = data.scenarios.find((scenario) => String(scenario.scenario_id) === preferredId)
      ?? data.scenarios.find((scenario) => scenario.is_default) ?? data.scenarios[0]
    setSelectedId(item ? String(item.scenario_id) : '')
    setDraft(item ? cloneScenario(item) : null)
    return data
  }
  useEffect(() => {
    let active = true
    getUserConfig().then((data) => {
      if (!active) return
      setConfig(data); setSettings(data.settings)
      const item = data.scenarios.find((scenario) => scenario.is_default) ?? data.scenarios[0]
      if (item) { setSelectedId(String(item.scenario_id)); setDraft(cloneScenario(item)) }
    }).catch((err: unknown) => { if (active) setError(err instanceof Error ? err.message : 'Impossible de charger la configuration.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  async function perform(action: () => Promise<void>, successMessage: string) {
    setError(null); setSuccess(null); setBusy(true)
    try { await action(); setSuccess(successMessage) }
    catch (err: unknown) { setError(err instanceof Error ? err.message : 'L’opération a échoué.') }
    finally { setBusy(false) }
  }
  const allocationChecks = draft ? allocationGroups.map((group) => ({
    title: group.title,
    total: allocationTotal(draft.parameters, group.fields.map((field) => field.key)),
  })) : []
  const customAllocationTotal = draft ? allocationTotal(draft.parameters, customAllocationFields.map((field) => field.key)) : 100
  const allocationsValid = allocationChecks.every((item) => Math.abs(item.total - 100) <= 0.00001)
    && Math.abs(customAllocationTotal - 100) <= 0.00001
  const zonePercentageTotal = zonePercentageFields.reduce((total, field) => total + Number(settings[field.key] || 0), 0)
  const populationInEconomy = Number(settings.population_in_economy_pct)
  const populationInEconomyValid = Number.isFinite(populationInEconomy) && populationInEconomy >= 0 && populationInEconomy <= 100
  const zonePercentagesValid = zonePercentageFields.every((field) => {
    const percentage = Number(settings[field.key])
    return Number.isFinite(percentage) && percentage >= 0 && percentage <= 100
  }) && zonePercentageTotal <= 100.000001
  const updateZonePercentage = (key: ZonePercentageKey, input: string) => {
    const normalized = input === '' ? '' : String(Math.min(100, Math.max(0, Number(input))))
    setSettings((current) => ({ ...current, [key]: normalized }))
  }
  const saveSettings = () => {
    if (!zonePercentagesValid || !populationInEconomyValid) {
      setError(!zonePercentagesValid ? 'La somme des quatre pourcentages de zones ne doit pas dépasser 100 %.' : 'La population dans l’économie doit être comprise entre 0 et 100 %.')
      setSuccess(null)
      return
    }
    return perform(async () => { const result = await saveUserSettings(settings); setSettings(result.settings) }, 'Hypothèses par défaut enregistrées.')
  }
  const createScenario = () => {
    if (!config || config.scenarios.length >= config.max_scenarios) return
    void perform(async () => {
      const usedNames = new Set(config.scenarios.map((scenario) => scenario.scenario_name.trim().toLocaleLowerCase('fr-FR')))
      let index = 1
      while (usedNames.has(`scénario ${index}`)) index += 1
      const result = await createUserScenario({ scenario_name: `Scénario ${index}`, description: 'Nouveau scénario économique personnel', parameters: initialParameters })
      await loadConfig(String(result.scenario.scenario_id))
    }, 'Scénario créé. Tu peux maintenant le personnaliser.')
  }
  const saveScenario = () => {
    if (!draft) return
    if (!allocationsValid) {
      const incomplete = [...allocationChecks.filter((item) => Math.abs(item.total - 100) > 0.00001),
        ...(Math.abs(customAllocationTotal - 100) > 0.00001 ? [{ title: 'Scénario personnalisé', total: customAllocationTotal }] : [])]
      setError(`Chaque scénario doit répartir exactement 100 % de la population investie en économie. À corriger : ${incomplete.map((item) => `${item.title} (${formatNumber(item.total, { maximumFractionDigits: 3 })} %)`).join(', ')}.`)
      setSuccess(null)
      return
    }
    void perform(async () => { await updateUserScenario(draft); await loadConfig(String(draft.scenario_id)) }, 'Scénario enregistré.')
  }
  const setDefault = () => {
    if (!draft) return
    void perform(async () => { await setUserDefaultScenario(draft.scenario_id); await loadConfig(String(draft.scenario_id)) }, 'Scénario défini par défaut.')
  }
  const removeScenario = () => {
    if (!draft || draft.is_default || !window.confirm(`Supprimer « ${draft.scenario_name} » ?`)) return
    void perform(async () => { await deleteUserScenario(draft.scenario_id); await loadConfig() }, 'Scénario supprimé.')
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null); setSuccess(null)
    if (newPassword !== confirmNewPassword) {
      setError('La confirmation ne correspond pas au nouveau mot de passe.')
      return
    }
    if (newPassword.length < 12) {
      setError('Le nouveau mot de passe doit contenir au moins 12 caractères.')
      return
    }
    setPasswordBusy(true)
    try {
      await changeOwnPassword(currentPassword, newPassword)
      setCurrentPassword(''); setNewPassword(''); setConfirmNewPassword('')
      setSuccess('Mot de passe modifié. Les prochaines connexions devront utiliser le nouveau mot de passe.')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Impossible de modifier le mot de passe.')
    } finally { setPasswordBusy(false) }
  }

  if (loading) return <section className="panel page-panel"><p className="page-message">Chargement de la configuration…</p></section>
  if (!config) return <section className="panel page-panel"><p className="page-message page-message--error">{error ?? 'Configuration indisponible.'}</p></section>

  return <div className="page-content">
    <section className="panel page-panel">
      <div className="panel-header page-panel-header"><div><p className="eyebrow">PRÉFÉRENCES PERSONNELLES</p><h2>Hypothèses par défaut</h2><p>Répartition par défaut des zones avant régulation spécifique par pays.</p></div><Settings2 size={24} /></div>
      <div className="form-grid form-grid--three">
        {zonePercentageFields.map((field) => <label className="form-field" key={field.key}>
          <span>{field.label} — % du territoire habitable</span>
          <input type="number" min="0" max="100" step="0.1" value={settings[field.key]} onChange={(e) => updateZonePercentage(field.key, e.target.value)} />
          <small>{field.hint}</small>
        </label>)}
      </div>
      <p className={`field-note config-zone-summary ${zonePercentagesValid ? '' : 'field-note--error'}`} role="status">
        Répartition par défaut : {formatNumber(zonePercentageTotal, { maximumFractionDigits: 2 })} % / 100 % maximum.
        {zonePercentagesValid ? ` Il restera ${formatNumber(Math.max(0, 100 - zonePercentageTotal), { maximumFractionDigits: 2 })} % non affecté.` : ' Réduis un ou plusieurs pourcentages avant d’enregistrer.'}
        {' '}Les effectifs sont calculés individuellement pour chaque joueur à partir de floor(habitable_regions / 20'000), puis arrondis au plus proche sans dépasser le total disponible.
      </p>
      <fieldset className="parameter-group config-economy-population">
        <legend>Hypothèse économique globale</legend>
        <div className="form-grid form-grid--two">
          <label className="form-field">
            <span>Population dans l’économie — % de la population totale</span>
            <input type="number" min="0" max="100" step="0.1" value={settings.population_in_economy_pct} onChange={(e) => setSettings((current) => ({ ...current, population_in_economy_pct: e.target.value }))} />
            <small>Part de la population supposée investie dans l’économie. Ce multiplicateur s’applique à tous les scénarios avant leur répartition par branche.</small>
          </label>
        </div>
      </fieldset>
      <section className="config-parameter-section" aria-labelledby="config-laws-title">
        <h3 className="config-parameter-section__title" id="config-laws-title">Lois</h3>
        <fieldset className="parameter-group">
          <legend>Multiplicateurs des lois</legend>
          <div className="form-grid form-grid--three">
            <label className="form-field form-field--checkbox">
              <span>Zones résidentielles denses</span>
              <div className="checkbox-row">
                <input type="checkbox" checked={settings.default_dense_residential_zones_enabled} onChange={(e) => setSettings({ ...settings, default_dense_residential_zones_enabled: e.target.checked })} />
                <strong>{settings.default_dense_residential_zones_enabled ? 'Activé · +20 %' : 'Désactivé · +0 %'}</strong>
              </div>
              <small>Ajoute +20 % à la capacité des zones résidentielles.</small>
            </label>
            <label className="form-field form-field--checkbox">
              <span>Pacte d’intégration sociale</span>
              <div className="checkbox-row">
                <input type="checkbox" checked={settings.default_social_integration_pact_enabled} onChange={(e) => setSettings({ ...settings, default_social_integration_pact_enabled: e.target.checked })} />
                <strong>{settings.default_social_integration_pact_enabled ? 'Activé · +20 %' : 'Désactivé · +0 %'}</strong>
              </div>
              <small>Ajoute +20 % à la capacité des zones résidentielles.</small>
            </label>
            <label className="form-field form-field--checkbox">
              <span>Réduction des congés</span>
              <div className="checkbox-row">
                <input type="checkbox" checked={settings.default_reduced_holidays_enabled} onChange={(e) => setSettings({ ...settings, default_reduced_holidays_enabled: e.target.checked })} />
                <strong>{settings.default_reduced_holidays_enabled ? 'Activé · ×1,3' : 'Désactivé · ×1'}</strong>
              </div>
              <small>Revenus industrie + commerce.</small>
            </label>
            <label className="form-field form-field--checkbox">
              <span>Exploitation des forêts</span>
              <div className="checkbox-row">
                <input type="checkbox" checked={settings.default_forest_exploitation_enabled} onChange={(e) => setSettings({ ...settings, default_forest_exploitation_enabled: e.target.checked })} />
                <strong>{settings.default_forest_exploitation_enabled ? 'Activé · ×1,4' : 'Désactivé · ×1'}</strong>
              </div>
              <small>Revenus agricoles.</small>
            </label>
            <label className="form-field form-field--checkbox">
              <span>Logements en zones industrielles</span>
              <div className="checkbox-row">
                <input type="checkbox" checked={settings.default_industrial_zone_housing_enabled} onChange={(e) => setSettings({ ...settings, default_industrial_zone_housing_enabled: e.target.checked })} />
                <strong>{settings.default_industrial_zone_housing_enabled ? 'Activé · ×1,4' : 'Désactivé · ×1'}</strong>
              </div>
              <small>Ajoute +40 % à la capacité des zones industrielles.</small>
            </label>
          </div>
        </fieldset>
      </section>

      <section className="config-parameter-section" aria-labelledby="config-other-title">
        <h3 className="config-parameter-section__title" id="config-other-title">Autres paramètres</h3>
        <fieldset className="parameter-group">
          <legend>Budget et financement</legend>
          <div className="form-grid form-grid--two">
            <label className="form-field form-field--checkbox">
              <span>Budget 200%</span>
              <div className="checkbox-row">
                <input type="checkbox" checked={settings.default_budget_200_enabled} onChange={(e) => setSettings({ ...settings, default_budget_200_enabled: e.target.checked })} />
                <strong>{settings.default_budget_200_enabled ? 'Activé · ×1,15' : 'Désactivé · ×1'}</strong>
              </div>
              <small>Bonus de productivité technologique à 200% de financement.</small>
            </label>
          </div>
        </fieldset>
      </section>
      <div className="form-actions"><button className="primary-button" type="button" disabled={busy || !zonePercentagesValid || !populationInEconomyValid} onClick={() => void saveSettings()}><Save size={16} /> Enregistrer les hypothèses</button></div>
    </section>

    <section className="panel page-panel">
      <div className="panel-header page-panel-header"><div><p className="eyebrow">MODÈLES ÉCONOMIQUES</p><h2>Scénarios économiques</h2><p>{formatNumber(config.scenarios.length)}/{formatNumber(config.max_scenarios)} scénarios personnels.</p></div><button className="primary-button" type="button" disabled={busy || config.scenarios.length >= config.max_scenarios} onClick={createScenario}><Plus size={16} /> Nouveau groupe de scénarios</button></div>
      <div className="scenario-layout">
        <aside className="scenario-list" aria-label="Scénarios enregistrés">
          {config.scenarios.map((scenario) => <button key={String(scenario.scenario_id)} type="button" className={`scenario-list__item ${selectedId === String(scenario.scenario_id) ? 'active' : ''}`} onClick={() => { setSelectedId(String(scenario.scenario_id)); setDraft(cloneScenario(scenario)); setError(null); setSuccess(null) }}>
            <span className="scenario-list__name">{scenario.scenario_name}</span>{scenario.is_default && <span className="scenario-default"><Star size={13} /> Par défaut</span>}{scenario.description && <small>{scenario.description}</small>}
          </button>)}
        </aside>
        {draft ? <div className="scenario-editor">
          <div className="form-grid form-grid--two">
            <label className="form-field"><span>Nom du groupe de scénarios</span><input maxLength={80} value={draft.scenario_name} onChange={(e) => setDraft({ ...draft, scenario_name: e.target.value })} /></label>
            <label className="form-field"><span>Description</span><input maxLength={500} value={draft.description ?? ''} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></label>
          </div>
          <fieldset className="parameter-group">
            <legend>Scénarios mono-branche</legend>
            <div className="form-grid form-grid--three">
              {fixedScenarios.map((scenario) => <div className="form-field" key={scenario.title}>
                <span>{scenario.title}</span>
                <strong>100 % de la population investie en économie</strong>
                <small>La totalité de la population retenue par le multiplicateur économique est affectée à cette branche.</small>
              </div>)}
            </div>
          </fieldset>
          {allocationGroups.map((group) => {
            const total = allocationTotal(draft.parameters, group.fields.map((field) => field.key))
            const valid = Math.abs(total - 100) <= 0.00001
            return <fieldset className="parameter-group" key={group.id}>
              <legend>{group.title}</legend>
              <p className="field-note">{group.description}</p>
              <div className="form-grid form-grid--two">
                {group.fields.map((field) => <label className="form-field" key={field.key}>
                  <span>{field.label} — % de la population investie en économie</span>
                  <input type="number" min="0" max="100" step="0.01" value={draft.parameters[field.key]} onChange={(e) => setDraft({ ...draft, parameters: { ...draft.parameters, [field.key]: e.target.value } })} />
                  <small>{group.industryPenalty && field.label.includes('industrie') ? 'La part affichée est conservée, mais sa contribution au potentiel est divisée par 10.' : `Part affectée à cette branche dans « ${group.title} ».`}</small>
                </label>)}
              </div>
              <p className={`field-note ${valid ? '' : 'field-note--error'}`} role="status">
                Répartition : {formatNumber(total, { maximumFractionDigits: 3 })} % / 100 %. {valid ? 'Répartition complète.' : 'Les deux branches doivent totaliser exactement 100 %.'}
              </p>
            </fieldset>
          })}
          <fieldset className="parameter-group parameter-group--custom">
            <legend>Scénario personnalisé — possibilité supplémentaire</legend>
            <div className="form-grid form-grid--two">
              <label className="form-field"><span>Nom du scénario interne</span><input maxLength={80} value={draft.parameters.custom_scenario_name} onChange={(e) => setDraft({ ...draft, parameters: { ...draft.parameters, custom_scenario_name: e.target.value } })} /></label>
              <label className="form-field form-field--checkbox"><span>Inclure ce calcul dans le potentiel économique</span><div className="checkbox-row"><input type="checkbox" checked={draft.parameters.custom_scenario_enabled} onChange={(e) => setDraft({ ...draft, parameters: { ...draft.parameters, custom_scenario_enabled: e.target.checked } })} /><strong>{draft.parameters.custom_scenario_enabled ? 'Scénario actif' : 'Scénario inactif'}</strong></div><small>Ce scénario supplémentaire est comparé aux six scénarios de référence.</small></label>
            </div>
            <div className="form-grid form-grid--three">
              {customAllocationFields.map((field) => <label className="form-field" key={field.key}>
                <span>{field.label} — % de la population</span>
                <input type="number" min="0" max="100" step="0.01" value={draft.parameters[field.key]} onChange={(e) => setDraft({ ...draft, parameters: { ...draft.parameters, [field.key]: e.target.value } })} />
                <small>Part de la population investie en économie affectée à cette branche dans le scénario personnalisé.</small>
              </label>)}
            </div>
            <p className={`field-note ${Math.abs(customAllocationTotal - 100) <= 0.00001 ? '' : 'field-note--error'}`} role="status">
              Répartition personnalisée : {formatNumber(customAllocationTotal, { maximumFractionDigits: 3 })} % / 100 %. {Math.abs(customAllocationTotal - 100) <= 0.00001 ? 'Répartition complète.' : 'Les trois branches doivent totaliser exactement 100 %.'}
            </p>
          </fieldset>
          <div className="form-actions form-actions--spread"><div className="form-actions__group"><button className="primary-button" type="button" disabled={busy || !draft.scenario_name.trim() || !allocationsValid} onClick={saveScenario}><Save size={16} /> Enregistrer le scénario</button><button className="secondary-button" type="button" disabled={busy || draft.is_default} onClick={setDefault}><Check size={16} /> Définir par défaut</button></div><button className="danger-button" type="button" disabled={busy || draft.is_default} onClick={removeScenario}><Trash2 size={15} /> Supprimer</button></div>
        </div> : <p className="page-message">Aucun scénario disponible.</p>}
      </div>
    </section>
    <section className="panel page-panel password-settings-panel">
      <div className="panel-header page-panel-header"><div><p className="eyebrow">SÉCURITÉ DU COMPTE</p><h2>Changer le mot de passe</h2><p>Cette option est disponible pour tous les utilisateurs. Le nouveau mot de passe doit contenir au moins 12 caractères.</p></div><KeyRound size={24} /></div>
      <form onSubmit={(event) => void changePassword(event)}>
        <div className="form-grid form-grid--three">
          <label className="form-field"><span>Mot de passe actuel</span><input type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required maxLength={1024} /></label>
          <label className="form-field"><span>Nouveau mot de passe</span><input type="password" autoComplete="new-password" minLength={12} maxLength={1024} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required /><small>12 caractères minimum.</small></label>
          <label className="form-field"><span>Confirmer le nouveau mot de passe</span><input type="password" autoComplete="new-password" minLength={12} maxLength={1024} value={confirmNewPassword} onChange={(e) => setConfirmNewPassword(e.target.value)} required /></label>
        </div>
        <div className="form-actions"><button className="primary-button" type="submit" disabled={passwordBusy || !currentPassword || newPassword.length < 12 || !confirmNewPassword}><KeyRound size={16} /> {passwordBusy ? 'Modification…' : 'Modifier le mot de passe'}</button></div>
      </form>
    </section>
    {error && <p className="notice notice--error" role="alert">{error}</p>}{success && <p className="notice notice--success" role="status">{success}</p>}
    <p className="page-footnote">Les hypothèses et scénarios sont privés à ton compte. Les six scénarios de référence couvrent Agriculture, Industrie, Commerce, Agro-industrie, Guerre et Agro-industrie militarisée. Chaque répartition est exprimée en pourcentage de la population investie en économie ; le multiplicateur global « Population dans l’économie » détermine la part de la population totale prise en compte. Le scénario personnalisé constitue une possibilité supplémentaire et répartit également 100 % de cette population entre agriculture, industrie et commerce.</p>
  </div>
}
