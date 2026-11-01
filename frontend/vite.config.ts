import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// Bloque une configuration de production qui enverrait les utilisateurs vers localhost.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const apiUrl = (env.VITE_API_URL ?? '').trim()
  const pointsToLocalHost = /^https?:\/\/(localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?(?:\/|$)/i.test(apiUrl)

  if (mode === 'production' && pointsToLocalHost) {
    throw new Error('VITE_API_URL pointe vers localhost. Vide cette variable pour utiliser /api via le reverse proxy, ou configure une URL publique.')
  }

  return {
    plugins: [react()],
  }
})
