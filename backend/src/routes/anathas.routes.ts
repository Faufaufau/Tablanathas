import { Router } from "express";
import { requireAuth } from "../middleware/require-auth.js";
import { getAnathasSnapshotById, getLatestAnathasCountrySnapshot, getLatestAnathasSnapshot, listAnathasSnapshotRuns } from "../repositories/anathas.repository.js";
import {
  getCountryDetails,
  getCurrentCountries,
} from "../services/anathas.service.js";

export const anathasRouter = Router();
anathasRouter.use(requireAuth);

// Historique global des captures automatiques. Aucun bouton ou endpoint de synchronisation manuelle.
anathasRouter.get("/snapshots", async (req, res, next) => {
  try {
    const parsed = Number(req.query.limit ?? 30);
    const limit = Number.isFinite(parsed) ? parsed : 30;
    res.setHeader("Cache-Control", "no-store");
    return res.json({ runs: await listAnathasSnapshotRuns(limit) });
  } catch (error) {
    next(error);
  }
});

// Dernière capture complète et écarts par rapport à la première capture du même tour.
anathasRouter.get("/snapshots/latest", async (_req, res, next) => {
  try {
    res.setHeader("Cache-Control", "no-store");
    return res.json(await getLatestAnathasSnapshot());
  } catch (error) {
    next(error);
  }
});

// Charge une capture historique précise (un des créneaux automatiques).
anathasRouter.get("/snapshots/:snapshotId", async (req, res, next) => {
  try {
    const snapshotId = req.params.snapshotId;
    if (!/^\d{1,20}$/.test(snapshotId) || /^0+$/.test(snapshotId)) {
      return res.status(400).json({ error: "L’identifiant de capture doit être un entier positif." });
    }
    res.setHeader("Cache-Control", "no-store");
    const snapshot = await getAnathasSnapshotById(snapshotId);
    if (!snapshot.run) return res.status(404).json({ error: "Capture complète introuvable." });
    return res.json(snapshot);
  } catch (error) {
    next(error);
  }
});

// Détail historisé d'un pays : inclut les colonnes normalisées et le JSON brut API.
anathasRouter.get("/snapshots/latest/countries/:countryId", async (req, res, next) => {
  try {
    const countryId = req.params.countryId;
    if (!/^\d{1,20}$/.test(countryId) || /^0+$/.test(countryId)) {
      return res.status(400).json({ error: "L’identifiant du pays doit être un entier positif." });
    }
    res.setHeader("Cache-Control", "no-store");
    const country = await getLatestAnathasCountrySnapshot(countryId);
    if (!country) {
      return res.status(404).json({ error: "Aucune capture complète trouvée pour ce pays." });
    }
    return res.json({ country });
  } catch (error) {
    next(error);
  }
});

// Endpoints de consultation directe utiles pour diagnostiquer le format de l'API.
// La clé X-API-Key ne quitte jamais le backend.
anathasRouter.get("/countries", async (_req, res, next) => {
  try {
    res.setHeader("Cache-Control", "no-store");
    return res.json(await getCurrentCountries());
  } catch (error) {
    next(error);
  }
});

anathasRouter.get("/countries/:countryId", async (req, res, next) => {
  try {
    const countryId = req.params.countryId;
    if (!/^\d{1,20}$/.test(countryId) || /^0+$/.test(countryId)) {
      return res.status(400).json({ error: "L’identifiant du pays doit être un entier positif." });
    }
    res.setHeader("Cache-Control", "no-store");
    return res.json(await getCountryDetails(countryId));
  } catch (error) {
    next(error);
  }
});

