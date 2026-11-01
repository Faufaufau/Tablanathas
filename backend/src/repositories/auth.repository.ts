import { query } from "../db.js";

export type AuthUser = {
  user_id: string;
  username: string;
  email: string | null;
  password_hash: string;
  role: "admin" | "user";
  created_at: Date;
};

export async function findUserForLogin(username: string) {
  const rows = await query<AuthUser>(
    `SELECT user_id, username, email, password_hash, role, created_at
     FROM public.app_users
     WHERE lower(username) = lower($1)
     LIMIT 1`,
    [username]
  );
  return rows[0] ?? null;
}

export async function findPublicUserById(userId: string) {
  const rows = await query<Pick<AuthUser, "user_id" | "username" | "email" | "role" | "created_at">>(
    `SELECT user_id, username, email, role, created_at
     FROM public.app_users
     WHERE user_id = $1
     LIMIT 1`,
    [userId]
  );
  return rows[0] ?? null;
}


export async function findUserForPasswordChange(userId: string) {
  const rows = await query<Pick<AuthUser, "user_id" | "username" | "password_hash">>(
    `SELECT user_id, username, password_hash
     FROM public.app_users
     WHERE user_id = $1
     LIMIT 1`,
    [userId],
  );
  return rows[0] ?? null;
}

export async function updatePasswordHash(userId: string, passwordHash: string) {
  const rows = await query<{ user_id: string }>(
    `UPDATE public.app_users
     SET password_hash = $2, updated_at = now()
     WHERE user_id = $1
     RETURNING user_id`,
    [userId, passwordHash],
  );
  return rows[0] ?? null;
}
