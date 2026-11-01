import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { ShieldCheck, Trash2, UserPlus, Users } from 'lucide-react'
import { createManagedUser, deleteManagedUser, getManagedUsers, type ManagedUser } from '../api/admin'
import { formatNumber } from '../utils/numberFormat'

function formatDate(input: string) {
  const date = new Date(input)
  return Number.isNaN(date.getTime()) ? input : date.toLocaleDateString('fr-FR', { year: 'numeric', month: 'short', day: 'numeric' })
}

export default function AdminPage({ currentUserId }: { currentUserId: string | number }) {
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  async function refreshUsers() {
    const result = await getManagedUsers()
    setUsers(result.users)
  }

  useEffect(() => {
    let active = true
    getManagedUsers().then((result) => { if (active) setUsers(result.users) })
      .catch((err: unknown) => { if (active) setError(err instanceof Error ? err.message : 'Impossible de charger les utilisateurs.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null); setSuccess(null); setBusy(true)
    try {
      await createManagedUser({ username: username.trim(), email: email.trim() || null, password })
      await refreshUsers()
      setUsername(''); setEmail(''); setPassword('')
      setSuccess('Utilisateur créé. Son rôle initial est « utilisateur ».')
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Impossible de créer cet utilisateur.') }
    finally { setBusy(false) }
  }

  async function handleDelete(user: ManagedUser) {
    if (!window.confirm(`Supprimer le compte « ${user.username} » ? Cette action est irréversible.`)) return
    setError(null); setSuccess(null); setBusy(true)
    try {
      await deleteManagedUser(user.user_id)
      await refreshUsers()
      setSuccess(`Le compte « ${user.username} » a été supprimé.`)
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Impossible de supprimer cet utilisateur.') }
    finally { setBusy(false) }
  }

  return <div className="page-content">
    <section className="panel page-panel">
      <div className="panel-header page-panel-header"><div><p className="eyebrow">ACCÈS RESTREINT</p><h2>Administration des utilisateurs</h2><p>Crée ou supprime les comptes Tablanathas. Les nouveaux comptes prennent le rôle utilisateur ; l’identifiant réservé « admin » est administrateur.</p></div><ShieldCheck size={24} /></div>
      <form className="admin-create-form" onSubmit={(event) => void handleCreate(event)}>
        <div className="form-grid form-grid--three">
          <label className="form-field"><span>Identifiant</span><input autoComplete="off" minLength={3} maxLength={100} value={username} onChange={(e) => setUsername(e.target.value)} required /></label>
          <label className="form-field"><span>E-mail (facultatif)</span><input type="email" maxLength={320} value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label className="form-field"><span>Mot de passe initial</span><input type="password" minLength={12} maxLength={1024} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required /><small>12 caractères minimum.</small></label>
        </div>
        <div className="form-actions"><button type="submit" className="primary-button" disabled={busy || username.trim().length < 3 || password.length < 12}><UserPlus size={16} /> Créer l’utilisateur</button></div>
      </form>
      {error && <p className="notice notice--error" role="alert">{error}</p>}
      {success && <p className="notice notice--success" role="status">{success}</p>}
    </section>

    <section className="panel page-panel">
      <div className="panel-header page-panel-header"><div><p className="eyebrow">COMPTES EXISTANTS</p><h2>Utilisateurs</h2><p>{formatNumber(users.length)} compte{users.length === 1 ? '' : 's'} enregistré{users.length === 1 ? '' : 's'}.</p></div><Users size={24} /></div>
      {loading ? <p className="page-message">Chargement des utilisateurs…</p> : users.length === 0 ? <p className="page-message">Aucun utilisateur.</p> : <div className="admin-user-list">
        {users.map((user) => <article className="admin-user-row" key={String(user.user_id)}>
          <div className="admin-user-row__identity"><strong>{user.username}</strong><span>{user.email || 'Aucun e-mail'} · créé le {formatDate(user.created_at)}</span></div>
          <span className={`role-tag ${user.role === 'admin' ? 'role-tag--admin' : ''}`}>{user.role === 'admin' ? 'Administrateur' : 'Utilisateur'}</span>
          <button type="button" className="danger-button" disabled={busy || String(user.user_id) === String(currentUserId)} onClick={() => void handleDelete(user)} title={String(user.user_id) === String(currentUserId) ? 'Tu ne peux pas supprimer ton propre compte' : `Supprimer ${user.username}`}><Trash2 size={15} /> Supprimer</button>
        </article>)}
      </div>}
      <p className="page-footnote">Les suppressions de compte entraînent également la suppression des paramètres et scénarios personnels associés par les clés étrangères. Le dernier administrateur ne peut pas être supprimé.</p>
    </section>
  </div>
}
