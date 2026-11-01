import type { NextFunction, Request, Response } from "express";
import { query } from "../db.js";

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Authentification requise." });
  }
  try {
    // Une session ne reste pas valable après suppression de son compte utilisateur.
    const rows = await query<{ user_id: string }>(
      "SELECT user_id FROM public.app_users WHERE user_id = $1 LIMIT 1",
      [req.session.userId],
    );
    if (!rows.length) {
      req.session.destroy(() => undefined);
      return res.status(401).json({ error: "Ce compte n’existe plus. Reconnecte-toi avec un compte valide." });
    }
    return next();
  } catch (error) {
    return next(error);
  }
}
