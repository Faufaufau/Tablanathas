import { API_URL } from './base'

export type ManagedUser = {
  user_id: string | number
  username: string
  email: string | null
  role: 'admin' | 'user'
  created_at: string
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    credentials: 'include',
    headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
    ...init,
  })
  if (!response.ok) {
    let message = `Erreur API : ${response.status} ${response.statusText}`
    try { const body = await response.json() as { error?: string }; if (body.error) message = body.error } catch { /* réponse vide */ }
    throw new Error(message)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export function getManagedUsers() { return request<{ users: ManagedUser[] }>('/api/admin/users') }
export function createManagedUser(input: { username: string; email: string | null; password: string }) {
  return request<{ user: ManagedUser }>('/api/admin/users', { method: 'POST', body: JSON.stringify(input) })
}
export function deleteManagedUser(userId: string | number) {
  return request<{ deleted: boolean; user_id: string }>('/api/admin/users/' + encodeURIComponent(String(userId)), { method: 'DELETE' })
}
