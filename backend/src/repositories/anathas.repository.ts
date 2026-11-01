import { pool } from "../db.js";

export async function listAnathasSnapshotRuns(limit = 30) {
  const result = await pool.query(
    `SELECT snapshot_id, schedule_key, scheduled_local_at, scheduled_for, snapshot_phase,
            game_turn, status, expected_country_count, captured_country_count,
            details_failed_count, failures, error_message, attempt_count,
            started_at, completed_at, created_at
     FROM public.anathas_snapshot_runs
     ORDER BY scheduled_for DESC
     LIMIT $1`,
    [Math.min(100, Math.max(1, Math.trunc(limit)))],
  );
  return result.rows;
}

export async function getAnathasSnapshotById(snapshotId: string) {
  const runResult = await pool.query(
    `SELECT snapshot_id, schedule_key, scheduled_local_at, scheduled_for, snapshot_phase,
            game_turn, status, expected_country_count, captured_country_count,
            details_failed_count, failures, error_message, attempt_count,
            started_at, completed_at
     FROM public.anathas_snapshot_runs
     WHERE snapshot_id = $1 AND status = 'completed'
     LIMIT 1`,
    [snapshotId],
  );
  const run = runResult.rows[0] ?? null;
  if (!run) return { run: null, countries: [] };

  const countryResult = await pool.query(
    `WITH baseline_run AS (
       SELECT snapshot_id
       FROM public.anathas_snapshot_runs
       WHERE game_turn = $2
         AND snapshot_phase = 'start'
         AND status = 'completed'
       ORDER BY completed_at DESC, snapshot_id DESC
       LIMIT 1
     )
     SELECT
       c.country_id, c.player_id, c.country_name, c.ruler_name, c.particule,
       c.rank, c.score, c.registered_timestamp, c.seniority_cycles, c.population,
       c.happiness, c.land_size, c.habitable_regions, c.total_zones, c.habitable_zones,
       c.agricultural_zones, c.pollution, c.carbon_credits,
       c.agriculture_tech, c.industry_tech, c.commerce_tech, c.research_points,
       c.education_primary_ratio, c.education_secondary_ratio, c.education_higher_ratio,
       c.education_primary_pct, c.education_secondary_pct, c.education_higher_pct,
       c.alliance_id, c.alliance_name, c.alliance_status, c.alliance_game_id,
       c.wonder_type, c.wonder_score, c.gms_multiplier, c.science_wonder_multiplier,
       c.gmh_multiplier, c.economic_wonder_multiplier, c.research_funding_multiplier,
       c.research_budget_estimate_billion, c.military_status, c.military_victories,
       c.military_defeats, c.is_on_vacation, c.vacation_until, c.captured_at,
       c.description, c.raw_details, c.details_synced_at,
       baseline.snapshot_id AS baseline_snapshot_id,
       CASE WHEN baseline.snapshot_id IS NULL THEN NULL ELSE c.score - baseline.score END AS delta_score,
       CASE WHEN baseline.snapshot_id IS NULL THEN NULL ELSE c.population - baseline.population END AS delta_population,
       CASE WHEN baseline.snapshot_id IS NULL THEN NULL ELSE c.research_points - baseline.research_points END AS delta_research_points,
       CASE WHEN baseline.snapshot_id IS NULL THEN NULL ELSE c.agriculture_tech - baseline.agriculture_tech END AS delta_agriculture_tech,
       CASE WHEN baseline.snapshot_id IS NULL THEN NULL ELSE c.industry_tech - baseline.industry_tech END AS delta_industry_tech,
       CASE WHEN baseline.snapshot_id IS NULL THEN NULL ELSE c.commerce_tech - baseline.commerce_tech END AS delta_commerce_tech
     FROM public.anathas_country_snapshots c
     LEFT JOIN baseline_run br ON true
     LEFT JOIN public.anathas_country_snapshots baseline
       ON baseline.snapshot_id = br.snapshot_id AND baseline.country_id = c.country_id
     WHERE c.snapshot_id = $1
     ORDER BY c.rank NULLS LAST, c.country_name`,
    [snapshotId, run.game_turn],
  );
  return { run, countries: countryResult.rows };
}

export async function getLatestAnathasSnapshot() {
  const runResult = await pool.query<{ snapshot_id: string }>(
    `SELECT snapshot_id
     FROM public.anathas_snapshot_runs
     WHERE status = 'completed'
     ORDER BY completed_at DESC NULLS LAST, snapshot_id DESC
     LIMIT 1`,
  );
  const snapshotId = runResult.rows[0]?.snapshot_id;
  return snapshotId ? getAnathasSnapshotById(snapshotId) : { run: null, countries: [] };
}

/**
 * Retourne la dernière fiche historisée d'un pays depuis la dernière capture complète.
 * `raw_details` reste disponible ici pour l'affichage des champs API qui ne nécessitent
 * pas encore de colonne dédiée, sans alourdir la réponse du classement complet.
 */
export async function getLatestAnathasCountrySnapshot(countryId: string) {
  const result = await pool.query(
    `SELECT current_country.*, run.game_turn, run.snapshot_phase,
            run.scheduled_local_at, run.completed_at
     FROM public.anathas_country_snapshots AS current_country
     JOIN public.anathas_snapshot_runs AS run
       ON run.snapshot_id = current_country.snapshot_id
     WHERE current_country.country_id = $1
       AND run.status = 'completed'
     ORDER BY run.completed_at DESC NULLS LAST, run.snapshot_id DESC
     LIMIT 1`,
    [countryId],
  );
  return result.rows[0] ?? null;
}
