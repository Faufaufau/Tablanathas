import type { NextFunction, Request, Response } from "express";
import { query } from "../db.js";

export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.session.userId) return res.status(401).json({ error: "Authentification requise." });
    const rows = await query<{ role: string }>(
      "SELECT role FROM public.app_users WHERE user_id = $1 LIMIT 1",
      [req.session.userId],
    );
    if (rows[0]?.role !== "admin") {
      return res.status(403).json({ error: "Accès réservé aux administrateurs." });
    }
    return next();
  } catch (error) {
    return next(error);
  }
}
