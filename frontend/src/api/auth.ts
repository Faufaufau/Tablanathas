export type AuthUser = {
  user_id: string
  username: string
  email: string | null
  role: 'admin' | 'user'
}

type AuthResponse = {
  user: AuthUser
}

import { API_URL } from './base'

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string }
    if (body.error) return body.error
  } catch {
    // La réponse n'est pas du JSON.
  }
  return `Erreur API : ${response.status} ${response.statusText}`
}

export async function login(username: string, password: string): Promise<AuthUser> {
  const response = await fetch(`${API_URL}/api/auth/login`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })

  if (!response.ok) throw new Error(await readError(response))
  const data = (await response.json()) as AuthResponse
  return data.user
}

export async function getCurrentUser(): Promise<AuthUser> {
  const response = await fetch(`${API_URL}/api/auth/me`, {
    credentials: 'include',
  })

  if (!response.ok) throw new Error(await readError(response))
  const data = (await response.json()) as AuthResponse
  return data.user
}

export async function logout(): Promise<void> {
  const response = await fetch(`${API_URL}/api/auth/logout`, {
    method: 'POST',
    credentials: 'include',
  })

  if (!response.ok) throw new Error(await readError(response))
}


export async function changeOwnPassword(currentPassword: string, newPassword: string): Promise<void> {
  const response = await fetch(`${API_URL}/api/auth/password`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  })
  if (!response.ok) throw new Error(await readError(response))
}
