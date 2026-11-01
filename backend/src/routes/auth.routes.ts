import { Router } from "express";
import argon2 from "argon2";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import * as authRepository from "../repositories/auth.repository.js";
import { requireAuth } from "../middleware/require-auth.js";

export const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Trop de tentatives de connexion. Réessaie dans 15 minutes." },
});

const loginSchema = z.object({
  username: z.string().trim().min(1).max(100),
  password: z.string().min(1).max(1024),
});

authRouter.post("/login", loginLimiter, async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Identifiant ou mot de passe invalide." });
    }

    const user = await authRepository.findUserForLogin(parsed.data.username);
    // Réponse volontairement identique si le compte n'existe pas ou si le mot de passe est faux.
    const valid = user ? await argon2.verify(user.password_hash, parsed.data.password).catch(() => false) : false;
    if (!user || !valid) {
      return res.status(401).json({ error: "Identifiant ou mot de passe invalide." });
    }

    // Régénérer l'identifiant de session évite la fixation de session.
    req.session.regenerate((error) => {
      if (error) return next(error);
      req.session.userId = String(user.user_id);
      req.session.save(async (saveError) => {
        if (saveError) return next(saveError);
        return res.json({
          user: {
            user_id: String(user.user_id),
            username: user.username,
            email: user.email,
            role: user.role,
          },
        });
      });
    });
  } catch (error) {
    next(error);
  }
});

authRouter.get("/me", requireAuth, async (req, res, next) => {
  try {
    const user = await authRepository.findPublicUserById(req.session.userId!);
    if (!user) {
      req.session.destroy(() => undefined);
      return res.status(401).json({ error: "Session invalide." });
    }
    return res.json({ user: { ...user, user_id: String(user.user_id) } });
  } catch (error) {
    next(error);
  }
});

const passwordChangeSchema = z.object({
  current_password: z.string().min(1).max(1024),
  new_password: z.string().min(12).max(1024),
});

authRouter.put("/password", requireAuth, async (req, res, next) => {
  try {
    const parsed = passwordChangeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Le nouveau mot de passe doit contenir au moins 12 caractères." });
    }
    const account = await authRepository.findUserForPasswordChange(req.session.userId!);
    if (!account) return res.status(401).json({ error: "Session invalide." });
    const valid = await argon2.verify(account.password_hash, parsed.data.current_password).catch(() => false);
    if (!valid) return res.status(400).json({ error: "Le mot de passe actuel est incorrect." });
    const passwordHash = await argon2.hash(parsed.data.new_password, { type: argon2.argon2id });
    await authRepository.updatePasswordHash(account.user_id, passwordHash);
    return res.json({ changed: true });
  } catch (error) {
    next(error);
  }
});

authRouter.post("/logout", (req, res, next) => {
  if (!req.session) return res.status(204).end();
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie("tablanathas.sid", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    });
    return res.status(204).end();
  });
});
