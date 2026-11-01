// L'API est sur localhost uniquement en développement local.
// En production, les appels sont relatifs (/api) par défaut et doivent être routés
// vers Express par le reverse proxy. VITE_API_URL peut remplacer cette origine.
const configuredApiUrl = import.meta.env.VITE_API_URL
const defaultApiUrl = import.meta.env.DEV ? 'http://localhost:3000' : ''
const apiUrl = (configuredApiUrl ?? defaultApiUrl).trim().replace(/\/+$/, '')

if (import.meta.env.PROD && /^https?:\/\/(localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?(?:\/|$)/i.test(apiUrl)) {
  throw new Error('VITE_API_URL pointe vers localhost dans le build de production. Configure une URL publique ou laisse la variable vide pour utiliser /api via le reverse proxy.')
}

export const API_URL = apiUrl
