import { Router } from "express";
import { hashPassword } from "../security/password.js";
import { z } from "zod";
import { pool, query } from "../db.js";
import { requireAuth } from "../middleware/require-auth.js";
import { requireAdmin } from "../middleware/require-admin.js";

export const adminRouter = Router();
adminRouter.use(requireAuth, requireAdmin);

adminRouter.get("/users", async (_req, res, next) => {
  try {
    const users = await query(
      `SELECT user_id, username, email, role, created_at
       FROM public.app_users
       ORDER BY lower(username), user_id`,
    );
    return res.json({ users: users.map((user) => ({ ...user, user_id: String(user.user_id) })) });
  } catch (error) { next(error); }
});

const createUserSchema = z.object({
  username: z.string().trim().min(3).max(100),
  email: z.union([z.string().trim().email().max(320), z.literal(""), z.null()]).optional(),
  password: z.string().min(12).max(1024),
});

adminRouter.post("/users", async (req, res, next) => {
  try {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Identifiant invalide ou mot de passe trop court (12 caractères minimum)." });
    }
    const username = parsed.data.username.trim();
    const email = parsed.data.email?.trim() || null;
    const passwordHash = await hashPassword(parsed.data.password);
    const rows = await query(
      `INSERT INTO public.app_users (username, email, password_hash, role)
       VALUES ($1, $2, $3, CASE WHEN lower($1) = 'admin' THEN 'admin' ELSE 'user' END)
       RETURNING user_id, username, email, role, created_at`,
      [username, email, passwordHash],
    );
    return res.status(201).json({ user: { ...rows[0], user_id: String(rows[0].user_id) } });
  } catch (error) { next(error); }
});

adminRouter.delete("/users/:id", async (req, res, next) => {
  const client = await pool.connect();
  try {
    const id = z.coerce.number().int().positive().transform(String).parse(req.params.id);
    if (id === req.session.userId) {
      return res.status(400).json({ error: "Tu ne peux pas supprimer ton propre compte administrateur." });
    }
    await client.query("BEGIN");
    // Sérialise les suppressions/créations pendant le contrôle du dernier administrateur.
    await client.query("LOCK TABLE public.app_users IN EXCLUSIVE MODE");
    const targetResult = await client.query<{ user_id: string; role: string }>(
      `SELECT user_id, role FROM public.app_users WHERE user_id = $1`,
      [id],
    );
    const target = targetResult.rows[0];
    if (!target) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Utilisateur introuvable." });
    }
    if (target.role === "admin") {
      const adminsResult = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM public.app_users WHERE role = 'admin'`,
      );
      if (Number(adminsResult.rows[0]?.count ?? 0) <= 1) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Impossible de supprimer le dernier administrateur." });
      }
    }
    await client.query("DELETE FROM public.app_users WHERE user_id = $1", [id]);
    await client.query("COMMIT");
    return res.json({ deleted: true, user_id: id });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    return next(error);
  } finally {
    client.release();
  }
});
