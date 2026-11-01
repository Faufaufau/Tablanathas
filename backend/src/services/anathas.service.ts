import { config } from "../config.js";

export class AnathasApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 502,
  ) {
    super(message);
    this.name = "AnathasApiError";
  }
}

export type AnathasApiResponse = {
  payload: unknown;
  /** Texte exact reçu du serveur ; utile pour conserver les grands nombres sans perte. */
  rawBody: string;
};

/**
 * Client serveur-à-serveur pour Anathas.
 * La clé est lue uniquement depuis le .env du backend et n'est jamais retournée au frontend.
 */
async function requestAnathasResponse(path: string): Promise<AnathasApiResponse> {
  if (!config.anathasApiKey) {
    throw new AnathasApiError(
      "L’API Anathas n’est pas configurée. Ajoute ANATHAS_API_KEY au fichier .env du backend puis redémarre-le.",
      503,
    );
  }

  const url = `${config.anathasApiBaseUrl}${path}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "X-API-Key": config.anathasApiKey,
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new AnathasApiError("L’API Anathas n’a pas répondu dans le délai imparti.", 504);
    }
    throw new AnathasApiError("Impossible de joindre l’API Anathas depuis le backend.", 502);
  }

  if (!response.ok) {
    // Ne pas renvoyer le corps d'erreur de l'API : il pourrait contenir des détails internes.
    if (response.status === 401 || response.status === 403) {
      throw new AnathasApiError(
        `Anathas a refusé la requête (HTTP ${response.status}). Vérifie ANATHAS_API_KEY.`,
        502,
      );
    }
    if (response.status === 429) {
      throw new AnathasApiError("Anathas limite temporairement les requêtes (HTTP 429). Réessaie plus tard.", 503);
    }
    throw new AnathasApiError(`L’API Anathas a répondu avec le statut HTTP ${response.status}.`, 502);
  }

  const rawBody = await response.text();
  try {
    return { payload: JSON.parse(rawBody) as unknown, rawBody };
  } catch {
    throw new AnathasApiError("L’API Anathas n’a pas renvoyé un document JSON valide.", 502);
  }
}

export async function getCurrentCountriesResponse(): Promise<AnathasApiResponse> {
  return requestAnathasResponse("/games/current/countries");
}

export async function getCountryDetailsResponse(countryId: string): Promise<AnathasApiResponse> {
  // Les identifiants sont validés dans la route avant cet appel.
  return requestAnathasResponse(`/games/current/countries/${encodeURIComponent(countryId)}`);
}

export async function getCurrentCountries(): Promise<unknown> {
  return (await getCurrentCountriesResponse()).payload;
}

export async function getCountryDetails(countryId: string): Promise<unknown> {
  return (await getCountryDetailsResponse(countryId)).payload;
}

/** Extrait les enregistrements de pays. Le format confirmé est { data: [...] }. */
export function extractCountryRecords(payload: unknown): Record<string, unknown>[] {
  const preferredKeys = ["countries", "players", "nations", "data", "results", "items", "ranking", "rankings", "records", "entries", "list", "classement", "pays"];

  function visit(value: unknown, depth: number): Record<string, unknown>[] | null {
    if (depth > 5 || value === null || value === undefined) return null;
    if (Array.isArray(value)) {
      const records = value.filter((item): item is Record<string, unknown> =>
        typeof item === "object" && item !== null && !Array.isArray(item),
      );
      return records.length > 0 ? records : null;
    }
    if (typeof value !== "object") return null;

    const obj = value as Record<string, unknown>;
    for (const key of preferredKeys) {
      if (key in obj) {
        const found = visit(obj[key], depth + 1);
        if (found) return found;
      }
    }
    for (const child of Object.values(obj)) {
      if (Array.isArray(child)) {
        const found = visit(child, depth + 1);
        if (found) return found;
      }
    }

    // Certains endpoints renvoient un objet indexé par ID plutôt qu'un tableau.
    const entries = Object.entries(obj);
    if (entries.length > 0 && entries.every(([key, child]) =>
      /^\d+$/.test(key) && typeof child === "object" && child !== null && !Array.isArray(child),
    )) {
      return entries.map(([key, child]) => {
        const record = child as Record<string, unknown>;
        return extractCountryId(record) ? record : { id: key, ...record };
      });
    }
    return null;
  }

  return visit(payload, 0) ?? [];
}

export function unwrapApiData(payload: unknown): unknown {
  if (isRecord(payload) && Object.prototype.hasOwnProperty.call(payload, "data")) {
    return payload.data;
  }
  return payload;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function extractCountryId(record: Record<string, unknown>): string | null {
  const keys = ["id", "country_id", "countryId", "player_id", "playerId", "nation_id", "nationId", "external_player_id", "ID"];
  for (const key of keys) {
    const value = record[key];
    if ((typeof value === "string" && /^\d+$/.test(value) && BigInt(value) > 0n)
      || (typeof value === "number" && Number.isSafeInteger(value) && value > 0)) {
      return String(value);
    }
  }
  for (const key of ["country", "player", "nation", "pays"]) {
    const nested = record[key];
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      const id = extractCountryId(nested as Record<string, unknown>);
      if (id) return id;
    }
  }
  return null;
}

function scalarString(value: unknown): string | null {
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function numericString(value: unknown): string | null {
  const result = scalarString(value);
  if (result === null || !/^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(result)) return null;
  return result;
}

/**
 * Helpers lexicaux pour extraire une valeur JSON sans passer les grands nombres par Number.
 * La recherche est limitée aux propriétés directes d'un objet afin de ne pas confondre
 * le score du pays avec wonder.score.
 */
function objectEnd(text: string, openIndex: number): number | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = openIndex; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return null;
}

function objectDepthAt(text: string, stopIndex: number): number | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < stopIndex; i += 1) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") depth -= 1;
  }
  return inString ? null : depth;
}

function extractRootObject(rawBody: string | null): string | null {
  if (!rawBody) return null;
  const openIndex = rawBody.indexOf("{");
  if (openIndex < 0) return null;
  const closeIndex = objectEnd(rawBody, openIndex);
  return closeIndex === null ? null : rawBody.slice(openIndex, closeIndex + 1);
}

function extractDirectObject(rawBody: string | null, key: string): string | null {
  if (!rawBody) return null;
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matcher = new RegExp(`"${escapedKey}"\\s*:\\s*\\{`, "g");
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(rawBody)) !== null) {
    // depth 1 signifie propriété directe de l'objet représenté par rawBody.
    if (objectDepthAt(rawBody, match.index) !== 1) continue;
    const openIndex = match.index + match[0].lastIndexOf("{");
    const closeIndex = objectEnd(rawBody, openIndex);
    if (closeIndex !== null) return rawBody.slice(openIndex, closeIndex + 1);
  }
  return null;
}

function extractDirectNumericProperty(rawObject: string | null, key: string): string | null {
  if (!rawObject) return null;
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const numericPattern = "-?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?";
  const matcher = new RegExp(`"${escapedKey}"\\s*:\\s*(?:"(${numericPattern})"|(${numericPattern}))`, "g");
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(rawObject)) !== null) {
    if (objectDepthAt(rawObject, match.index) !== 1) continue;
    return match[1] ?? match[2] ?? null;
  }
  return null;
}

function extractRawCountryObject(rawBody: string | null, payload: unknown): string | null {
  if (!rawBody) return null;
  if (isRecord(payload) && Object.prototype.hasOwnProperty.call(payload, "data")) {
    return extractDirectObject(rawBody, "data");
  }
  return extractRootObject(rawBody);
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function preferOwn(primary: Record<string, unknown>, secondary: Record<string, unknown>, key: string): unknown {
  if (Object.prototype.hasOwnProperty.call(primary, key)) return primary[key];
  return secondary[key];
}

export type NormalizedAnathasCountry = {
  countryId: string;
  countryName: string;
  rulerName: string | null;
  particule: string | null;
  rank: string | null;
  score: string | null;
  registeredTimestamp: string | null;
  seniorityCycles: string | null;
  population: string | null;
  happiness: string | null;
  landSize: string | null;
  habitableRegions: string | null;
  pollution: string | null;
  carbonCredits: string | null;
  agricultureTech: string | null;
  techIndustrial: string | null;
  techCommercial: string | null;
  researchPoints: string | null;
  educationPrimaryRatio: string | null;
  educationSecondaryRatio: string | null;
  educationHigherRatio: string | null;
  educationPrimaryPct: string | null;
  educationSecondaryPct: string | null;
  educationHigherPct: string | null;
  allianceId: string | null;
  allianceName: string | null;
  allianceStatus: string | null;
  allianceGameId: string | null;
  wonderType: string | null;
  wonderScore: string | null;
  gmsMultiplier: string;
  scienceWonderMultiplier: string;
  gmhMultiplier: string;
  economicWonderMultiplier: string;
  researchFundingMultiplier: string;
  militaryStatus: string | null;
  militaryVictories: string | null;
  militaryDefeats: string | null;
  isOnVacation: boolean | null;
  vacationUntil: string | null;
  description: string | null;
  rawRankingJson: string;
  rawDetailsJson: string | null;
};

function percentageFromRatio(value: unknown): string | null {
  const numeric = numericString(value);
  if (numeric === null) return null;
  const number = Number(numeric);
  if (!Number.isFinite(number)) return null;
  // Le JSON fourni exprime toujours ces champs comme ratios : 1 = 100 %, 0.4 = 40 %.
  return String(number * 100);
}

/** Décode les bonus confirmés pour les merveilles ; les autres restent neutres. */
export function wonderMultipliers(type: string | null): {
  gmsMultiplier: string;
  scienceWonderMultiplier: string;
  gmhMultiplier: string;
  economicWonderMultiplier: string;
  researchFundingMultiplier: string;
} {
  const normalized = (type ?? "").trim().toLowerCase();
  const match = normalized.match(/^([xcehgd])([+*])?$/);
  const category = match?.[1] ?? "";
  const suffix = match?.[2] ?? "";
  const great = suffix === "*";
  const standard = suffix === "+" || great;
  return {
    gmsMultiplier: category === "x" && great ? "0.6" : "1",
    scienceWonderMultiplier: category === "x" && standard ? "1.15" : "1",
    gmhMultiplier: category === "h" && great ? "1.5" : "1",
    economicWonderMultiplier: category === "e" && standard ? "1.3" : "1",
    researchFundingMultiplier: "1",
  };
}

/**
 * Mapping confirmé par l’utilisateur ; tech_military est un alias provisoire pour agriculture_tech.
 */
export function normalizeAnathasCountry(
  rankingRecord: Record<string, unknown>,
  detailPayload: unknown,
  rawDetailsJson: string | null,
): NormalizedAnathasCountry | null {
  const unwrappedDetail = rawDetailsJson === null ? null : recordOrNull(unwrapApiData(detailPayload));
  // Une réponse HTTP 200 qui ne contient pas un objet pays n'est pas une fiche complète.
  if (rawDetailsJson !== null && unwrappedDetail === null) return null;
  const ranking = rankingRecord;
  const details = unwrappedDetail ?? {};
  const hasDetails = rawDetailsJson !== null && unwrappedDetail !== null;
  const id = extractCountryId(ranking) ?? extractCountryId(details);
  if (!id) return null;

  const pick = (key: string) => preferOwn(details, ranking, key);
  const education = recordOrNull(details.education) ?? {};
  const alliance = recordOrNull(details.alliance);
  const wonder = recordOrNull(details.wonder);
  const rawCountryObject = hasDetails ? extractRawCountryObject(rawDetailsJson, detailPayload) : null;
  const rawWonderObject = rawCountryObject ? extractDirectObject(rawCountryObject, "wonder") : null;
  const military = recordOrNull(details.military);

  let allianceId: string | null;
  if (hasDetails && Object.prototype.hasOwnProperty.call(details, "alliance")) {
    allianceId = alliance ? scalarString(alliance.id) : null;
  } else {
    allianceId = scalarString(preferOwn(details, ranking, "alliance_id"));
  }

  // Sans jeton numérique exact dans la réponse brute, on laisse le score nul plutôt que
  // d'enregistrer une valeur qui aurait pu être arrondie par JSON.parse / Number.
  const score = hasDetails ? extractDirectNumericProperty(rawCountryObject, "score") : null;
  const wonderScore = hasDetails
    ? extractDirectNumericProperty(rawWonderObject, "score") ?? (typeof wonder?.score === "string" ? numericString(wonder.score) : null)
    : null;
  const vacationUntil = details.vacation_until;
  const isOnVacation = typeof details.is_on_vacation === "boolean" ? details.is_on_vacation : null;
  const countryName = scalarString(pick("name")) ?? `Pays ${id}`;

  return {
    countryId: id,
    countryName,
    rulerName: scalarString(pick("ruler_name")),
    particule: scalarString(pick("particule")),
    rank: numericString(pick("rank")),
    score,
    registeredTimestamp: hasDetails ? numericString(details.registered_timestamp) : null,
    seniorityCycles: hasDetails ? numericString(details.seniority_cycles) : null,
    population: numericString(pick("population")),
    happiness: hasDetails ? numericString(details.happiness) : null,
    landSize: numericString(pick("land_size")),
    habitableRegions: hasDetails ? numericString(details.habitable_regions) : null,
    pollution: hasDetails ? numericString(details.pollution) : null,
    carbonCredits: hasDetails ? numericString(details.carbon_credits) : null,
    agricultureTech: hasDetails ? numericString(details.tech_military) : null,
    techIndustrial: hasDetails ? numericString(details.tech_industrial) : null,
    techCommercial: hasDetails ? numericString(details.tech_commercial) : null,
    researchPoints: hasDetails ? numericString(details.research_points) : null,
    educationPrimaryRatio: hasDetails ? numericString(education.primary) : null,
    educationSecondaryRatio: hasDetails ? numericString(education.secondary) : null,
    educationHigherRatio: hasDetails ? numericString(education.higher) : null,
    educationPrimaryPct: hasDetails ? percentageFromRatio(education.primary) : null,
    educationSecondaryPct: hasDetails ? percentageFromRatio(education.secondary) : null,
    educationHigherPct: hasDetails ? percentageFromRatio(education.higher) : null,
    allianceId,
    allianceName: hasDetails ? scalarString(alliance?.name) : null,
    allianceStatus: hasDetails ? scalarString(alliance?.status) : null,
    allianceGameId: hasDetails ? numericString(alliance?.game_id) : null,
    wonderType: hasDetails ? scalarString(wonder?.type) : null,
    wonderScore,
    ...wonderMultipliers(hasDetails ? scalarString(wonder?.type) : null),
    militaryStatus: hasDetails ? scalarString(military?.status) : null,
    militaryVictories: hasDetails ? numericString(military?.victories) : null,
    militaryDefeats: hasDetails ? numericString(military?.defeats) : null,
    isOnVacation,
    vacationUntil: scalarString(vacationUntil),
    description: hasDetails ? (typeof details.description === "string" ? details.description : null) : null,
    rawRankingJson: JSON.stringify(ranking),
    rawDetailsJson: hasDetails ? rawDetailsJson : null,
  };
}
