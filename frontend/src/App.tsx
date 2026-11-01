import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { LogIn, ShieldCheck } from 'lucide-react'
import Dashboard from './Dashboard'
import { getCurrentUser, login, logout } from './api/auth'
import type { AuthUser } from './api/auth'

function LoginScreen({ onLogin }: { onLogin: (username: string, password: string) => Promise<void> }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await onLogin(username.trim(), password)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Échec de la connexion.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-icon"><ShieldCheck size={28} /></div>
        <p className="eyebrow">ESPACE SÉCURISÉ</p>
        <h1>Tablanathas</h1>
        <p className="auth-description">Connecte-toi pour accéder au tableau de bord.</p>
        <form className="auth-form" onSubmit={handleSubmit}>
          <label htmlFor="username">Identifiant</label>
          <input
            id="username"
            name="username"
            autoComplete="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            required
            autoFocus
          />
          <label htmlFor="password">Mot de passe</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button className="auth-submit" type="submit" disabled={submitting}>
            <LogIn size={17} />
            {submitting ? 'Connexion...' : 'Se connecter'}
          </button>
        </form>
      </section>
    </main>
  )
}

function App() {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [checkingSession, setCheckingSession] = useState(true)
  const [authError, setAuthError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getCurrentUser()
      .then((currentUser) => {
        if (!cancelled) setUser(currentUser)
      })
      .catch(() => {
        // Une session absente ou expirée doit afficher le formulaire de connexion.
      })
      .finally(() => {
        if (!cancelled) setCheckingSession(false)
      })
    return () => { cancelled = true }
  }, [])

  async function handleLogin(username: string, password: string) {
    setAuthError(null)
    const currentUser = await login(username, password)
    setUser(currentUser)
  }

  async function handleLogout() {
    try {
      await logout()
    } catch (err: unknown) {
      setAuthError(err instanceof Error ? err.message : 'Erreur lors de la déconnexion.')
    } finally {
      setUser(null)
    }
  }

  if (checkingSession) {
    return <main className="auth-page"><p className="auth-loading">Vérification de la session...</p></main>
  }

  if (!user) {
    return (
      <>
        {authError && <p className="auth-global-error" role="alert">{authError}</p>}
        <LoginScreen onLogin={handleLogin} />
      </>
    )
  }

  return <Dashboard user={user} onLogout={handleLogout} />
}

export default App
