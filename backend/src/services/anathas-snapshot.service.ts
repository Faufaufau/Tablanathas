import type { PoolClient } from "pg";
import { pool } from "../db.js";
import { config } from "../config.js";
import {
  ANATHAS_DETAIL_BATCH_SIZE,
  ANATHAS_DETAIL_CONCURRENCY,
  getAnathasDetailBatchCount,
} from "./anathas-batch.js";
import {
  extractCountryId,
  extractCountryRecords,
  getCountryDetailsResponse,
  getCurrentCountriesResponse,
  normalizeAnathasCountry,
  type NormalizedAnathasCountry,
} from "./anathas.service.js";

type ScheduleSlot = {
  key: string;
  localAt: string;
  date: string;
  time: string;
  phase: "start" | "end";
  scheduledFor: Date;
};

type CaptureFailure = { countryId: string | null; countryName: string | null; error: string };
type CountryCapture = {
  ranking: Record<string, unknown>;
  countryId: string | null;
  normalized?: NormalizedAnathasCountry;
  rawDetails?: string | null;
  error?: string;
};

const TIME_SLOTS: Array<{ time: string; phase: ScheduleSlot["phase"] }> = [
  { time: "00:00", phase: "end" },
  { time: "05:05", phase: "start" },
  { time: "18:00", phase: "end" },
  { time: "20:05", phase: "start" },
];
const RUN_RETRY_DELAY_MS = 5 * 60 * 1000;
const DETAIL_RETRY_DELAY_MS = 60 * 1000;
const MAX_DETAIL_ATTEMPTS = 3;
// Le lot est volontairement borné à 40 requêtes externes maximum par invocation.
// La file persistante et le Cron chaque minute déclenchent autant de lots que nécessaire.
// Si une invocation est interrompue brutalement, une autre peut reprendre après ce bail.
const SNAPSHOT_LEASE_MS = 4 * 60 * 1000;

function zonedParts(date: Date, timeZone: string): Record<string, string> {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
}

function localDateTimeToUtc(date: string, time: string, timeZone: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const desired = Date.UTC(year, month - 1, day, hour, minute, 0);
  let candidate = desired;
  // Ajustement itératif : prend en compte automatiquement l'heure d'été / d'hiver.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const parts = zonedParts(new Date(candidate), timeZone);
    const represented = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour), Number(parts.minute), Number(parts.second),
    );
    const delta = represented - desired;
    if (delta === 0) break;
    candidate -= delta;
  }
  return new Date(candidate);
}

function dateKey(date: Date, timeZone: string): string {
  const parts = zonedParts(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function buildSlotsForDate(date: string): ScheduleSlot[] {
  return TIME_SLOTS.map(({ time, phase }) => ({
    key: `anathas:${date}:${time}`,
    localAt: `${date} ${time} ${config.anathasTimezone}`,
    date,
    time,
    phase,
    scheduledFor: localDateTimeToUtc(date, time, config.anathasTimezone),
  }));
}

function isTurnStart(slot: ScheduleSlot): boolean {
  return slot.phase === "start";
}

function asNumeric(value: string | null | undefined, fallback = "0"): string {
  return value === null || value === undefined || value.trim() === "" ? fallback : value;
}

function intOrDefault(value: string | null, fallback = 0): number {
  if (value === null) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

type SnapshotQueueRow = {
  rank_order: number;
  country_id: string | null;
  country_name: string | null;
  ranking: Record<string, unknown>;
  status: "pending" | "completed" | "failed";
  attempt_count: number;
  details_raw: string | null;
  error_message: string | null;
  next_attempt_at: Date | string | null;
};

type QueueUpdate = {
  rank_order: number;
  status: "completed" | "failed";
  attempt_count: number;
  details_raw: string | null;
  error_message: string | null;
  next_attempt_at: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredDetailFields(country: NormalizedAnathasCountry): string[] {
  const requiredFields: Array<[string, string | null]> = [
    ["score", country.score],
    ["seniority_cycles", country.seniorityCycles],
    ["population", country.population],
    ["land_size", country.landSize],
    ["habitable_regions", country.habitableRegions],
    ["tech_military", country.agricultureTech],
    ["tech_industrial", country.techIndustrial],
    ["tech_commercial", country.techCommercial],
    ["research_points", country.researchPoints],
    ["education.primary", country.educationPrimaryRatio],
    ["education.secondary", country.educationSecondaryRatio],
    ["education.higher", country.educationHigherRatio],
  ];
  return requiredFields.filter(([, value]) => value === null).map(([name]) => name);
}

/**
 * Initialise la file une seule fois par capture.
 * Pour une capture partielle créée par l'ancienne version, les 49 fiches déjà
 * récupérées sont reprises depuis raw_details (jsonb::text conserve la précision
 * numérique PostgreSQL) et seules les fiches manquantes sont redemandées.
 */
async function ensureSnapshotQueue(client: PoolClient, snapshotId: string): Promise<number> {
  const existingQueue = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count
     FROM public.anathas_snapshot_country_queue
     WHERE snapshot_id = $1`,
    [snapshotId],
  );
  if (Number(existingQueue.rows[0]?.count ?? 0) > 0) {
    return Number(existingQueue.rows[0].count);
  }

  const seeded = await client.query(
    `INSERT INTO public.anathas_snapshot_country_queue (
       snapshot_id, rank_order, country_id, country_name, ranking,
       status, attempt_count, details_raw, error_message
     )
     SELECT
       $1,
       (row_number() OVER (ORDER BY rank NULLS LAST, country_name, country_id) - 1)::integer,
       country_id::text,
       country_name,
       COALESCE(raw_ranking, jsonb_build_object('id', country_id::text, 'name', country_name, 'rank', rank)),
       CASE WHEN raw_details IS NULL THEN 'pending' ELSE 'completed' END,
       0,
       raw_details::text,
       NULL
     FROM public.anathas_country_snapshots
     WHERE snapshot_id = $1
     ON CONFLICT (snapshot_id, rank_order) DO NOTHING`,
    [snapshotId],
  );
  if ((seeded.rowCount ?? 0) > 0) {
    const seededCount = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM public.anathas_snapshot_country_queue
       WHERE snapshot_id = $1`,
      [snapshotId],
    );
    const count = Number(seededCount.rows[0]?.count ?? 0);
    await client.query(
      `UPDATE public.anathas_snapshot_runs
       SET expected_country_count = $2,
           captured_country_count = (
             SELECT count(*) FROM public.anathas_snapshot_country_queue
             WHERE snapshot_id = $1 AND status = 'completed'
           ),
           updated_at = now()
       WHERE snapshot_id = $1`,
      [snapshotId, count],
    );
    console.info(`[Anathas snapshots] Reprise de la capture ${snapshotId} : ${count} pays déjà historisés, seules les fiches absentes seront récupérées.`);
    return count;
  }

  // Nouvelle capture : on ne demande le classement qu'une seule fois, puis on le conserve.
  const rankingResponse = await getCurrentCountriesResponse();
  const rankingRecords = extractCountryRecords(rankingResponse.payload);
  if (rankingRecords.length === 0) {
    throw new Error("Le classement Anathas n'a renvoyé aucun pays identifiable.");
  }

  const queueItems = rankingRecords.map((ranking, index) => {
    const countryId = extractCountryId(ranking);
    const countryName = typeof ranking.name === "string" ? ranking.name : null;
    return {
      rank_order: index,
      country_id: countryId,
      country_name: countryName,
      ranking,
      status: countryId ? "pending" : "failed",
      attempt_count: countryId ? 0 : MAX_DETAIL_ATTEMPTS,
      error_message: countryId ? null : "Identifiant Anathas absent ou non reconnu dans le classement.",
    };
  });

  await client.query(
    `INSERT INTO public.anathas_snapshot_country_queue (
       snapshot_id, rank_order, country_id, country_name, ranking,
       status, attempt_count, error_message
     )
     SELECT $1, item.rank_order, item.country_id, item.country_name, item.ranking,
            item.status, item.attempt_count, item.error_message
     FROM jsonb_to_recordset($2::jsonb) AS item(
       rank_order integer,
       country_id text,
       country_name text,
       ranking jsonb,
       status text,
       attempt_count integer,
       error_message text
     )
     ON CONFLICT (snapshot_id, rank_order) DO NOTHING`,
    [snapshotId, JSON.stringify(queueItems)],
  );
  await client.query(
    `UPDATE public.anathas_snapshot_runs
     SET expected_country_count = $2, updated_at = now()
     WHERE snapshot_id = $1`,
    [snapshotId, rankingRecords.length],
  );
  const plannedBatchCount = getAnathasDetailBatchCount(rankingRecords.length);
  console.info(
    `[Anathas snapshots] Classement enregistré : ${rankingRecords.length} pays ; ` +
    `${plannedBatchCount} lot(s) de ${ANATHAS_DETAIL_BATCH_SIZE} fiche(s) maximum seront nécessaires.`,
  );
  return rankingRecords.length;
}

async function processNextDetailBatch(client: PoolClient, snapshotId: string): Promise<void> {
  const batchResult = await client.query<SnapshotQueueRow>(
    `SELECT rank_order, country_id, country_name, ranking, status,
            attempt_count, details_raw, error_message, next_attempt_at
     FROM public.anathas_snapshot_country_queue
     WHERE snapshot_id = $1
       AND (
         status = 'pending'
         OR (status = 'failed'
             AND attempt_count < $2
             AND (next_attempt_at IS NULL OR next_attempt_at <= now()))
       )
     ORDER BY CASE WHEN status = 'pending' THEN 0 ELSE 1 END, rank_order
     LIMIT $3`,
    [snapshotId, MAX_DETAIL_ATTEMPTS, ANATHAS_DETAIL_BATCH_SIZE],
  );
  const batch = batchResult.rows;
  if (batch.length === 0) return;

  console.info(`[Anathas snapshots] Capture ${snapshotId} : traitement du lot de ${batch.length} fiche(s) (plafond ${ANATHAS_DETAIL_BATCH_SIZE}).`);
  const updates: QueueUpdate[] = new Array(batch.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = nextIndex++;
      if (index >= batch.length) return;
      const item = batch[index];
      const attempt = item.attempt_count + 1;

      if (!item.country_id || !isRecord(item.ranking)) {
        updates[index] = {
          rank_order: item.rank_order,
          status: "failed",
          attempt_count: MAX_DETAIL_ATTEMPTS,
          details_raw: null,
          error_message: "Identifiant ou classement du pays invalide dans la file de capture.",
          next_attempt_at: null,
        };
        continue;
      }

      try {
        // Une seule requête par pays et par invocation. Les reprises ont lieu
        // lors d'une invocation Cron ultérieure, jamais dans la même invocation.
        const response = await getCountryDetailsResponse(item.country_id);
        const normalized = normalizeAnathasCountry(item.ranking, response.payload, response.rawBody);
        if (!normalized) {
          throw new Error("La réponse détaillée ne contient pas un objet pays exploitable.");
        }
        const missingFields = requiredDetailFields(normalized);
        if (missingFields.length > 0) {
          throw new Error(`Fiche pays incomplète ; champs requis absents : ${missingFields.join(", ")}.`);
        }
        updates[index] = {
          rank_order: item.rank_order,
          status: "completed",
          attempt_count: attempt,
          details_raw: response.rawBody,
          error_message: null,
          next_attempt_at: null,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Échec de chargement de la fiche.";
        updates[index] = {
          rank_order: item.rank_order,
          status: "failed",
          attempt_count: attempt,
          details_raw: null,
          error_message: message.slice(0, 1000),
          next_attempt_at: attempt < MAX_DETAIL_ATTEMPTS
            ? new Date(Date.now() + DETAIL_RETRY_DELAY_MS).toISOString()
            : null,
        };
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(ANATHAS_DETAIL_CONCURRENCY, batch.length) }, () => worker()),
  );

  // Une seule écriture SQL pour les résultats de tout le lot.
  await client.query(
    `UPDATE public.anathas_snapshot_country_queue AS queue
     SET status = update_row.status,
         attempt_count = update_row.attempt_count,
         details_raw = update_row.details_raw,
         error_message = update_row.error_message,
         next_attempt_at = update_row.next_attempt_at,
         updated_at = now()
     FROM jsonb_to_recordset($2::jsonb) AS update_row(
       rank_order integer,
       status text,
       attempt_count integer,
       details_raw text,
       error_message text,
       next_attempt_at timestamptz
     )
     WHERE queue.snapshot_id = $1
       AND queue.rank_order = update_row.rank_order`,
    [snapshotId, JSON.stringify(updates)],
  );
}

async function getQueueSummary(client: PoolClient, snapshotId: string): Promise<{
  total: number;
  completed: number;
  pending: number;
  retryable: number;
  exhausted: number;
  nextRetryAt: Date | null;
}> {
  const result = await client.query<{
    total: string;
    completed: string;
    pending: string;
    retryable: string;
    exhausted: string;
    next_retry_at: Date | null;
  }>(
    `SELECT
       count(*)::text AS total,
       count(*) FILTER (WHERE status = 'completed')::text AS completed,
       count(*) FILTER (WHERE status = 'pending')::text AS pending,
       count(*) FILTER (WHERE status = 'failed' AND attempt_count < $2)::text AS retryable,
       count(*) FILTER (WHERE status = 'failed' AND attempt_count >= $2)::text AS exhausted,
       min(next_attempt_at) FILTER (WHERE status = 'failed' AND attempt_count < $2) AS next_retry_at
     FROM public.anathas_snapshot_country_queue
     WHERE snapshot_id = $1`,
    [snapshotId, MAX_DETAIL_ATTEMPTS],
  );
  const row = result.rows[0];
  return {
    total: Number(row?.total ?? 0),
    completed: Number(row?.completed ?? 0),
    pending: Number(row?.pending ?? 0),
    retryable: Number(row?.retryable ?? 0),
    exhausted: Number(row?.exhausted ?? 0),
    nextRetryAt: row?.next_retry_at ?? null,
  };
}

async function buildCaptureFromQueue(client: PoolClient, snapshotId: string): Promise<{
  countries: CountryCapture[];
  failures: CaptureFailure[];
  expected: number;
}> {
  const result = await client.query<SnapshotQueueRow>(
    `SELECT rank_order, country_id, country_name, ranking, status,
            attempt_count, details_raw, error_message, next_attempt_at
     FROM public.anathas_snapshot_country_queue
     WHERE snapshot_id = $1
     ORDER BY rank_order`,
    [snapshotId],
  );
  const countries: CountryCapture[] = [];
  const failures: CaptureFailure[] = [];

  for (const item of result.rows) {
    const ranking = isRecord(item.ranking) ? item.ranking : {};
    const countryId = item.country_id;
    let normalized: NormalizedAnathasCountry | null = null;
    let rawDetails: string | null = null;
    let error: string | undefined;

    if (item.status === "completed" && item.details_raw) {
      try {
        const payload = JSON.parse(item.details_raw) as unknown;
        normalized = normalizeAnathasCountry(ranking, payload, item.details_raw);
        if (!normalized) throw new Error("La fiche conservée ne peut plus être normalisée.");
        rawDetails = item.details_raw;
      } catch (cause) {
        error = cause instanceof Error ? cause.message : "La fiche conservée est invalide.";
        await client.query(
          `UPDATE public.anathas_snapshot_country_queue
           SET status = 'failed', attempt_count = $3, details_raw = NULL,
               error_message = $4, next_attempt_at = NULL, updated_at = now()
           WHERE snapshot_id = $1 AND rank_order = $2`,
          [snapshotId, item.rank_order, MAX_DETAIL_ATTEMPTS, error.slice(0, 1000)],
        );
      }
    } else {
      error = item.error_message ?? "Fiche pays non récupérée après plusieurs tentatives.";
    }

    if (error) {
      failures.push({
        countryId,
        countryName: item.country_name,
        error,
      });
      normalized = normalizeAnathasCountry(ranking, null, null);
      rawDetails = null;
    }

    countries.push({
      ranking,
      countryId,
      normalized: normalized ?? undefined,
      rawDetails,
      error,
    });
  }

  return { countries, failures, expected: result.rows.length };
}

async function ensurePlayer(client: PoolClient, country: NormalizedAnathasCountry): Promise<string> {
  const existingByExternalId = await client.query<{ player_id: string }>(
    `SELECT player_id FROM public.players WHERE external_player_id = $1 ORDER BY player_id LIMIT 1 FOR UPDATE`,
    [country.countryId],
  );
  if (existingByExternalId.rowCount && existingByExternalId.rows[0]) {
    const id = existingByExternalId.rows[0].player_id;
    await client.query(
      `UPDATE public.players SET player_name = $2, updated_at = now() WHERE player_id = $1`,
      [id, country.countryName],
    );
    return id;
  }

  // Rattache d'abord l'ancien joueur via ruler_name (correspondance historique), puis le nom du pays.
  const oldNames = [...new Set([country.rulerName, country.countryName].filter((item): item is string => Boolean(item)))];
  for (const oldName of oldNames) {
    const byOldName = await client.query<{ player_id: string }>(
      `SELECT player_id FROM public.players
       WHERE external_player_id IS NULL AND lower(player_name) = $1
       ORDER BY player_id LIMIT 1 FOR UPDATE`,
      [oldName.toLowerCase()],
    );
    if (byOldName.rowCount && byOldName.rows[0]) {
      const id = byOldName.rows[0].player_id;
      await client.query(
        `UPDATE public.players SET external_player_id = $1, player_name = $2, updated_at = now() WHERE player_id = $3`,
        [country.countryId, country.countryName, id],
      );
      return id;
    }
  }

  const inserted = await client.query<{ player_id: string }>(
    `INSERT INTO public.players(player_name, external_player_id) VALUES ($1, $2) RETURNING player_id`,
    [country.countryName, country.countryId],
  );
  return inserted.rows[0].player_id;
}

async function assignGameTurn(
  client: PoolClient,
  slot: ScheduleSlot,
  runId: string,
  apiCountries: CountryCapture[],
  publishToDashboard: boolean,
): Promise<{ gameTurn: number; gameId: string }> {
  const priorRun = await client.query<{ game_turn: number | null }>(
    `SELECT game_turn FROM public.anathas_snapshot_runs WHERE snapshot_id = $1 FOR UPDATE`,
    [runId],
  );
  const storedTurn = priorRun.rows[0]?.game_turn;

  const stateResult = await client.query<{
    current_game_turn: number;
    game_id: string | null;
    initialized: boolean;
  }>(`SELECT current_game_turn, game_id, initialized FROM public.anathas_game_state WHERE singleton = true FOR UPDATE`);
  let state = stateResult.rows[0];
  if (!state) {
    await client.query(`INSERT INTO public.anathas_game_state(singleton) VALUES (true) ON CONFLICT DO NOTHING`);
    const again = await client.query<{ current_game_turn: number; game_id: string | null; initialized: boolean }>(
      `SELECT current_game_turn, game_id, initialized FROM public.anathas_game_state WHERE singleton = true FOR UPDATE`,
    );
    state = again.rows[0];
  }
  if (!state) throw new Error("Impossible d'initialiser le compteur du tour global.");

  let gameId = state.game_id;
  if (!gameId) {
    if (config.anathasGameId !== null && Number.isFinite(config.anathasGameId)) {
      gameId = String(config.anathasGameId);
      const configured = await client.query(`SELECT 1 FROM public.games WHERE game_id = $1`, [gameId]);
      if (!configured.rowCount) throw new Error(`ANATHAS_GAME_ID=${gameId} n'existe pas dans public.games.`);
    } else {
      const firstGame = await client.query<{ game_id: string }>(`SELECT game_id FROM public.games ORDER BY game_id LIMIT 1 FOR UPDATE`);
      if (firstGame.rowCount && firstGame.rows[0]) gameId = firstGame.rows[0].game_id;
      else {
        const created = await client.query<{ game_id: string }>(
          `INSERT INTO public.games(game_name, current_turn) VALUES ('Anathas', 0) RETURNING game_id`,
        );
        gameId = created.rows[0].game_id;
      }
    }
  }

  let turn = storedTurn;
  let initializedFrom = "";
  if (turn === null || turn === undefined) {
    if (!state.initialized) {
      const localMax = await client.query<{ max_turn: number | null }>(
        `SELECT MAX(seniority_turns)::integer AS max_turn FROM public.player_turn_state WHERE game_id = $1`,
        [gameId],
      );
      const maxLocalTurn = localMax.rows[0]?.max_turn;
      const apiSeniority = apiCountries
        .map((entry) => entry.normalized?.seniorityCycles)
        .filter((value): value is string => value !== null && value !== undefined && /^\d+$/.test(value))
        .map((value) => Number(value))
        .filter(Number.isFinite);
      const maxApiSeniority = apiSeniority.length ? Math.max(...apiSeniority) : 0;
      turn = maxLocalTurn !== null && maxLocalTurn !== undefined ? maxLocalTurn : maxApiSeniority;
      initializedFrom = maxLocalTurn !== null && maxLocalTurn !== undefined
        ? "MAX(player_turn_state.seniority_turns)"
        : "MAX(Anathas.seniority_cycles) (repli si la base ne contient aucun tour historique)";
      await client.query(
        `UPDATE public.anathas_game_state
         SET current_game_turn = $1, game_id = $2, initialized = true, initialized_from = $3,
             last_turn_start_key = CASE WHEN $4 THEN $5 ELSE last_turn_start_key END, updated_at = now()
         WHERE singleton = true`,
        [turn, gameId, initializedFrom, isTurnStart(slot), isTurnStart(slot) ? slot.key : null],
      );
    } else {
      turn = state.current_game_turn + (isTurnStart(slot) ? 1 : 0);
      await client.query(
        `UPDATE public.anathas_game_state
         SET current_game_turn = $1, game_id = $2,
             last_turn_start_key = CASE WHEN $3 THEN $4 ELSE last_turn_start_key END,
             updated_at = now()
         WHERE singleton = true`,
        [turn, gameId, isTurnStart(slot), isTurnStart(slot) ? slot.key : null],
      );
    }
  } else {
    turn = Number(storedTurn);
    // Une relance d'une capture partielle réutilise son tour, sans incrémenter deux fois.
    await client.query(
      `UPDATE public.anathas_game_state
       SET current_game_turn = GREATEST(current_game_turn, $1), game_id = $2, updated_at = now()
       WHERE singleton = true`,
      [turn, gameId],
    );
  }

  if (publishToDashboard) {
    await client.query(`UPDATE public.games SET current_turn = $1, updated_at = now() WHERE game_id = $2`, [turn, gameId]);
  }
  await client.query(
    `UPDATE public.anathas_snapshot_runs SET game_turn = $1, updated_at = now() WHERE snapshot_id = $2`,
    [turn, runId],
  );
  return { gameTurn: Number(turn), gameId };
}

async function insertCountrySnapshot(
  client: PoolClient,
  snapshotId: string,
  country: NormalizedAnathasCountry,
  linkPlayer: boolean,
  gameId: string,
): Promise<{ playerId: string | null; totalZones: number; habitableZones: number }> {
  const playerId = linkPlayer && country.rawDetailsJson ? await ensurePlayer(client, country) : null;
  const totalZones = Math.max(0, Math.floor(Number(country.habitableRegions ?? 0) / 20_000));
  const previous = playerId
    ? await client.query<{ habitable_zones: number }>(
      `SELECT habitable_zones FROM public.player_turn_state WHERE player_id = $1 AND game_id = $2 ORDER BY game_turn DESC LIMIT 1`,
      [playerId, gameId],
    )
    : { rows: [] as Array<{ habitable_zones: number }> };
  // L'API ne fournit pas le nombre de zones habitables : on conserve l'ancienne valeur si elle existe,
  // sinon on applique une valeur de repli explicite et configurable.
  const habitableZones = previous.rows[0]?.habitable_zones ?? config.anathasDefaultHabitableZones;
  const values: unknown[] = [
    snapshotId, country.countryId, playerId, country.countryName, country.rulerName, country.particule,
    country.rank === null ? null : intOrDefault(country.rank), country.score, country.registeredTimestamp,
    country.seniorityCycles, country.population, country.happiness, country.landSize, country.habitableRegions,
    totalZones, habitableZones, config.anathasDefaultAgriculturalZones, country.pollution, country.carbonCredits,
    country.agricultureTech, country.techIndustrial, country.techCommercial, country.researchPoints,
    country.educationPrimaryRatio, country.educationSecondaryRatio, country.educationHigherRatio,
    country.educationPrimaryPct, country.educationSecondaryPct, country.educationHigherPct,
    country.allianceId, country.allianceName, country.allianceStatus, country.allianceGameId,
    country.wonderType, country.wonderScore, country.gmsMultiplier, country.scienceWonderMultiplier,
    country.gmhMultiplier, country.economicWonderMultiplier, country.researchFundingMultiplier,
    country.militaryStatus, country.militaryVictories, country.militaryDefeats, country.isOnVacation,
    country.vacationUntil, country.description, country.rawRankingJson, country.rawDetailsJson,
  ];
  await client.query(
    `INSERT INTO public.anathas_country_snapshots (
      snapshot_id, country_id, player_id, country_name, ruler_name, particule, rank, score,
      registered_timestamp, seniority_cycles, population, happiness, land_size, habitable_regions,
      total_zones, habitable_zones, agricultural_zones, pollution, carbon_credits,
      agriculture_tech, industry_tech, commerce_tech, research_points,
      education_primary_ratio, education_secondary_ratio, education_higher_ratio,
      education_primary_pct, education_secondary_pct, education_higher_pct,
      alliance_id, alliance_name, alliance_status, alliance_game_id, wonder_type, wonder_score,
      gms_multiplier, science_wonder_multiplier, gmh_multiplier, economic_wonder_multiplier,
      research_funding_multiplier, military_status, military_victories, military_defeats,
      is_on_vacation, vacation_until, description, raw_ranking, raw_details, details_synced_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
      $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
      $21, $22, $23, $24, $25, $26, $27, $28, $29, $30,
      $31, $32, $33, $34, $35, $36, $37, $38, $39, $40,
      $41, $42, $43, $44, $45, $46, $47::jsonb, $48::jsonb,
      CASE WHEN $48::jsonb IS NOT NULL THEN now() ELSE NULL END
    )`,
    values,
  );
  return { playerId, totalZones, habitableZones };
}

async function updateResearchBudgetEstimates(client: PoolClient, snapshotId: string, gameTurn: number) {
  await client.query(
    `UPDATE public.anathas_country_snapshots current_snapshot
     SET research_budget_estimate_billion = COALESCE(
       (
         SELECT prior.research_budget_estimate_billion
         FROM public.anathas_country_snapshots prior
         JOIN public.anathas_snapshot_runs prior_run ON prior_run.snapshot_id = prior.snapshot_id
         WHERE prior.country_id = current_snapshot.country_id
           AND prior_run.game_turn = $2
           AND prior_run.snapshot_phase = 'start'
           AND prior_run.status = 'completed'
           AND prior.snapshot_id <> current_snapshot.snapshot_id
           AND prior.research_budget_estimate_billion > 0
         ORDER BY prior_run.completed_at DESC
         LIMIT 1
       ),
       (
         power(GREATEST(COALESCE(current_snapshot.research_points, 0), 0), 4)
         * power(GREATEST(
             COALESCE(current_snapshot.agriculture_tech, 0) * 10
             + COALESCE(current_snapshot.industry_tech, 0) * 20
             + COALESCE(current_snapshot.commerce_tech, 0) * 30, 0
           ), 0.11) / 195000000::numeric
       )
     )
     WHERE current_snapshot.snapshot_id = $1`,
    [snapshotId, gameTurn],
  );
}

async function upsertPlayerTurnState(
  client: PoolClient,
  country: NormalizedAnathasCountry,
  playerId: string,
  gameId: string,
  gameTurn: number,
  totalZones: number,
  habitableZones: number,
  snapshotId: string,
) {
  const result = await client.query<{ research_budget_estimate_billion: string | null }>(
    `SELECT research_budget_estimate_billion FROM public.anathas_country_snapshots
     WHERE snapshot_id = $1 AND country_id = $2`,
    [snapshotId, country.countryId],
  );
  const budget = result.rows[0]?.research_budget_estimate_billion ?? null;

  // Garantit que le pays est associé au jeu avant l'insertion de son état de tour.
  // Nécessaire lorsque l'API fait apparaître un nouveau pays/joueur.
  await client.query(
    `INSERT INTO public.game_players (game_id, player_id)
     VALUES ($1, $2)
     ON CONFLICT (game_id, player_id) DO NOTHING`,
    [gameId, playerId],
  );

  await client.query(
    `INSERT INTO public.player_turn_state (
      player_id, game_id, game_turn, seniority_turns, research_points,
      agriculture_tech, industry_tech, commerce_tech, population,
      education_primary_pct, education_secondary_pct, education_higher_pct,
      gms_multiplier, science_wonder_multiplier, research_funding_multiplier, gmh_multiplier,
      total_zones, habitable_zones, agricultural_zones, pollution,
      economic_wonder_multiplier, research_budget_estimate_billion,
      rank, score, happiness, land_size, habitable_regions, carbon_credits,
      education_primary_ratio, education_secondary_ratio, education_higher_ratio,
      wonder_type, wonder_score, military_status, military_victories, military_defeats,
      captured_at
    ) VALUES (
      $1, $2, $3, $4, $5::numeric, $6::numeric, $7::numeric, $8::numeric, $9::numeric,
      $10::numeric, $11::numeric, $12::numeric, $13::numeric, $14::numeric, $15::numeric,
      $16::numeric, $17, $18, $19, $20::numeric, $21::numeric, $22::numeric,
      $23::integer, $24::numeric, $25::numeric, $26::numeric, $27::numeric, $28::numeric,
      $29::numeric, $30::numeric, $31::numeric, $32, $33::numeric, $34, $35::numeric, $36::numeric,
      now()
    )
    ON CONFLICT (player_id, game_id, game_turn) DO UPDATE SET
      seniority_turns = EXCLUDED.seniority_turns,
      research_points = EXCLUDED.research_points,
      agriculture_tech = EXCLUDED.agriculture_tech,
      industry_tech = EXCLUDED.industry_tech,
      commerce_tech = EXCLUDED.commerce_tech,
      population = EXCLUDED.population,
      education_primary_pct = EXCLUDED.education_primary_pct,
      education_secondary_pct = EXCLUDED.education_secondary_pct,
      education_higher_pct = EXCLUDED.education_higher_pct,
      gms_multiplier = EXCLUDED.gms_multiplier,
      science_wonder_multiplier = EXCLUDED.science_wonder_multiplier,
      research_funding_multiplier = EXCLUDED.research_funding_multiplier,
      gmh_multiplier = EXCLUDED.gmh_multiplier,
      total_zones = EXCLUDED.total_zones,
      habitable_zones = EXCLUDED.habitable_zones,
      agricultural_zones = EXCLUDED.agricultural_zones,
      pollution = EXCLUDED.pollution,
      economic_wonder_multiplier = EXCLUDED.economic_wonder_multiplier,
      rank = EXCLUDED.rank,
      score = EXCLUDED.score,
      happiness = EXCLUDED.happiness,
      land_size = EXCLUDED.land_size,
      habitable_regions = EXCLUDED.habitable_regions,
      carbon_credits = EXCLUDED.carbon_credits,
      education_primary_ratio = EXCLUDED.education_primary_ratio,
      education_secondary_ratio = EXCLUDED.education_secondary_ratio,
      education_higher_ratio = EXCLUDED.education_higher_ratio,
      wonder_type = EXCLUDED.wonder_type,
      wonder_score = EXCLUDED.wonder_score,
      military_status = EXCLUDED.military_status,
      military_victories = EXCLUDED.military_victories,
      military_defeats = EXCLUDED.military_defeats,
      research_budget_estimate_billion = COALESCE(
        NULLIF(public.player_turn_state.research_budget_estimate_billion, 0),
        NULLIF(EXCLUDED.research_budget_estimate_billion, 0)
      ),
      captured_at = now()`,
    [
      playerId, gameId, gameTurn, intOrDefault(country.seniorityCycles), asNumeric(country.researchPoints),
      asNumeric(country.agricultureTech), asNumeric(country.techIndustrial), asNumeric(country.techCommercial),
      asNumeric(country.population), asNumeric(country.educationPrimaryPct), asNumeric(country.educationSecondaryPct),
      asNumeric(country.educationHigherPct), country.gmsMultiplier, country.scienceWonderMultiplier,
      country.researchFundingMultiplier, country.gmhMultiplier, totalZones, habitableZones,
      config.anathasDefaultAgriculturalZones, asNumeric(country.pollution), country.economicWonderMultiplier,
      budget, country.rank === null ? null : intOrDefault(country.rank), country.score, country.happiness,
      country.landSize, country.habitableRegions, country.carbonCredits,
      country.educationPrimaryRatio, country.educationSecondaryRatio, country.educationHigherRatio,
      country.wonderType, country.wonderScore, country.militaryStatus,
      country.militaryVictories, country.militaryDefeats,
    ],
  );
}

export async function runAnathasSnapshot(slot: ScheduleSlot): Promise<void> {
  const client = await pool.connect();
  let runId: string | null = null;
  try {
    const previousResult = await client.query<{ status: string }>(
      `SELECT status FROM public.anathas_snapshot_runs WHERE schedule_key = $1 LIMIT 1`,
      [slot.key],
    );
    const previousStatus = previousResult.rows[0]?.status ?? null;

    // Bail atomique : une seule invocation Cron traite un lot à la fois.
    // Le bail est libéré en fin de traitement et expire automatiquement si le Worker est interrompu.
    const reservation = await client.query<{ snapshot_id: string }>(
      `INSERT INTO public.anathas_snapshot_runs
         (schedule_key, scheduled_local_at, scheduled_for, snapshot_phase, status, worker_lease_until)
       VALUES ($1, $2, $3, $4, 'running', now() + ($5 * interval '1 millisecond'))
       ON CONFLICT (schedule_key) DO UPDATE SET
         status = 'running',
         attempt_count = public.anathas_snapshot_runs.attempt_count
           + CASE WHEN public.anathas_snapshot_runs.status IN ('partial', 'failed') THEN 1 ELSE 0 END,
         started_at = CASE
           WHEN public.anathas_snapshot_runs.status IN ('partial', 'failed') THEN now()
           ELSE public.anathas_snapshot_runs.started_at
         END,
         completed_at = NULL,
         error_message = NULL,
         retry_after = NULL,
         worker_lease_until = now() + ($5 * interval '1 millisecond'),
         updated_at = now()
       WHERE public.anathas_snapshot_runs.status <> 'completed'
         AND (public.anathas_snapshot_runs.status <> 'running'
              OR public.anathas_snapshot_runs.worker_lease_until IS NULL
              OR public.anathas_snapshot_runs.worker_lease_until <= now())
         AND (public.anathas_snapshot_runs.retry_after IS NULL
              OR public.anathas_snapshot_runs.retry_after <= now())
       RETURNING snapshot_id`,
      [slot.key, slot.localAt, slot.scheduledFor, slot.phase, SNAPSHOT_LEASE_MS],
    );
    if (!reservation.rows[0]) return;
    runId = reservation.rows[0].snapshot_id;

    try {
      // Une reprise d'une capture partielle ne retélécharge que les fiches en échec.
      if (previousStatus === "partial") {
        await client.query(
          `UPDATE public.anathas_snapshot_country_queue
           SET status = 'pending', attempt_count = 0, next_attempt_at = NULL,
               error_message = NULL, updated_at = now()
           WHERE snapshot_id = $1 AND status = 'failed' AND country_id IS NOT NULL`,
          [runId],
        );
      }

      await ensureSnapshotQueue(client, runId);
      await processNextDetailBatch(client, runId);
      const summary = await getQueueSummary(client, runId);

      if (summary.pending > 0 || summary.retryable > 0) {
        const nextRetry = summary.pending > 0 ? null : summary.nextRetryAt;
        await client.query(
          `UPDATE public.anathas_snapshot_runs SET
             expected_country_count = $2,
             captured_country_count = $3,
             details_failed_count = $4,
             status = 'running',
             error_message = NULL,
             retry_after = $5,
             completed_at = NULL,
             worker_lease_until = NULL,
             updated_at = now()
           WHERE snapshot_id = $1`,
          [runId, summary.total, summary.completed, summary.total - summary.completed, nextRetry],
        );
        console.info(
          `[Anathas snapshots] Progression ${slot.localAt} : ${summary.completed}/${summary.total} fiches récupérées ; ` +
          `${summary.pending} en attente ; ${summary.retryable} à retenter ; ` +
          `${getAnathasDetailBatchCount(summary.total)} lot(s) prévus au total.`,
        );
        return;
      }

      // Toutes les fiches sont traitées (succès ou tentatives épuisées) : finalisation.
      const capture = await buildCaptureFromQueue(client, runId);
      const validWithDetails = capture.countries.filter((entry) => entry.normalized && entry.rawDetails);
      const completed = capture.failures.length === 0 && validWithDetails.length === capture.expected;
      const allNormalized = capture.countries.flatMap((entry) => entry.normalized ? [entry.normalized] : []);

      await client.query("BEGIN");
      try {
        const { gameTurn, gameId } = await assignGameTurn(client, slot, runId, capture.countries, completed);
        await client.query(`DELETE FROM public.anathas_country_snapshots WHERE snapshot_id = $1`, [runId]);
        const playerLinks = new Map<string, { playerId: string | null; totalZones: number; habitableZones: number }>();
        for (const country of allNormalized) {
          const linked = await insertCountrySnapshot(client, runId, country, completed, gameId);
          playerLinks.set(country.countryId, linked);
        }
        await updateResearchBudgetEstimates(client, runId, gameTurn);

        if (completed) {
          for (const country of allNormalized) {
            const linked = playerLinks.get(country.countryId);
            if (!linked?.playerId) throw new Error(`Liaison joueur manquante pour le pays ${country.countryId}.`);
            await upsertPlayerTurnState(
              client, country, linked.playerId, gameId, gameTurn,
              linked.totalZones, linked.habitableZones, runId,
            );
          }
        }

        await client.query(
          `UPDATE public.anathas_snapshot_runs SET
            expected_country_count = $2,
            captured_country_count = $3,
            details_failed_count = $4,
            failures = $5::jsonb,
            status = $6,
            error_message = $7,
            retry_after = CASE WHEN $6 = 'completed' THEN NULL ELSE now() + ($8 * interval '1 millisecond') END,
            completed_at = now(),
            worker_lease_until = NULL,
            updated_at = now()
           WHERE snapshot_id = $1`,
          [
            runId, capture.expected, validWithDetails.length, capture.failures.length,
            JSON.stringify(capture.failures), completed ? "completed" : "partial",
            completed ? null : `Capture incomplète : ${capture.failures.length} fiche(s) manquante(s).`, RUN_RETRY_DELAY_MS,
          ],
        );
        await client.query("COMMIT");

        if (completed) {
          console.info(`[Anathas snapshots] Capture complète : ${validWithDetails.length}/${capture.expected} pays, tour ${gameTurn}.`);
        } else {
          console.warn(`[Anathas snapshots] Capture partielle : ${validWithDetails.length}/${capture.expected} fiches détaillées. Les fiches en échec seront seules retentées après le délai de reprise ; le dashboard n'a pas été mis à jour.`);
        }
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    } catch (error) {
      await client.query(
        `UPDATE public.anathas_snapshot_runs SET status = 'failed', error_message = $2,
         retry_after = now() + ($3 * interval '1 millisecond'),
         completed_at = now(), worker_lease_until = NULL, updated_at = now()
         WHERE snapshot_id = $1 AND status <> 'completed'`,
        [runId, error instanceof Error ? error.message : "Erreur inattendue pendant la capture.", RUN_RETRY_DELAY_MS],
      );
      console.error(`[Anathas snapshots] Erreur pendant le lot de capture ${slot.key}.`, error);
    }
  } finally {
    client.release();
  }
}

/**
 * Ne traite que le créneau le plus récent déjà arrivé aujourd'hui.
 *
 * L'API Anathas ne fournit pas d'historique des fiches : rejouer un créneau
 * ancien après le changement de tour enregistrerait les données actuelles
 * sous une ancienne date. Les créneaux manqués ou incomplets sont donc
 * abandonnés dès qu'un créneau plus récent devient exigible.
 */
export async function schedulerTick(): Promise<void> {
  const now = new Date();
  const today = dateKey(now, config.anathasTimezone);
  const currentSlot = buildSlotsForDate(today)
    .filter((slot) => slot.scheduledFor.getTime() <= now.getTime())
    .sort((a, b) => a.scheduledFor.getTime() - b.scheduledFor.getTime())
    .at(-1);

  // Avant le premier créneau de la journée, on attend le prochain tick.
  if (!currentSlot) return;

  const result = await pool.query<{ status: string; retry_after: Date | null }>(
    `SELECT status, retry_after
     FROM public.anathas_snapshot_runs
     WHERE schedule_key = $1
     ORDER BY snapshot_id DESC
     LIMIT 1`,
    [currentSlot.key],
  );
  const run = result.rows[0];

  // Un créneau déjà réussi ne doit jamais être rejoué.
  if (run?.status === "completed") return;

  // Respecte le délai de reprise pour le créneau courant uniquement.
  // Dès que le créneau suivant arrive, celui-ci n'est plus sélectionné :
  // les erreurs d'un ancien tour ne bloquent donc pas les captures suivantes.
  if (run?.retry_after && new Date(run.retry_after).getTime() > now.getTime()) return;

  await runAnathasSnapshot(currentSlot);
}

export function startAnathasSnapshotScheduler(): () => void {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      await schedulerTick();
    } catch (error) {
      console.error("[Anathas snapshots] Le planificateur n'a pas pu vérifier les créneaux.", error);
    } finally {
      busy = false;
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), config.anathasSnapshotPollMs);
  console.info(`[Anathas snapshots] Planificateur activé (${config.anathasTimezone}, ${TIME_SLOTS.map((slot) => slot.time).join(", ")}).`);
  return () => clearInterval(timer);
}
