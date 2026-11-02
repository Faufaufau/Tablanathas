/**
 * Politique de collecte compatible avec la limite de 50 sous-requêtes externes
 * de Cloudflare Workers Free. On garde 10 requêtes de marge (classement,
 * éventuelles redirections et évolution future du client).
 *
 * Le nombre de lots n'est jamais codé en dur : chaque invocation traite
 * jusqu'à ANATHAS_DETAIL_BATCH_SIZE lignes de la file PostgreSQL ; le Cron
 * reprend au lot suivant tant que des lignes restent en attente.
 */
export const ANATHAS_DETAIL_BATCH_SIZE = 40;
export const ANATHAS_DETAIL_CONCURRENCY = 4;

export function getAnathasDetailBatchCount(totalCountries: number): number {
  if (!Number.isSafeInteger(totalCountries) || totalCountries < 0) {
    throw new RangeError("Le nombre de pays doit être un entier positif ou nul.");
  }
  return Math.ceil(totalCountries / ANATHAS_DETAIL_BATCH_SIZE);
}
