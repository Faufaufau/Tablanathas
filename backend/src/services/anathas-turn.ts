/**
 * Détermine le cycle global réel à partir des seniority_cycles renvoyés par
 * Anathas. Les joueurs peuvent avoir des anciennetés différentes : le cycle
 * courant est ancré sur la valeur entière maximale observée.
 */
export function getMaxAnathasSeniorityTurn(
  values: Array<string | number | null | undefined>,
): number | null {
  let maxTurn: number | null = null;

  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const parsed = typeof value === "number" ? value : Number(String(value).trim());
    if (!Number.isSafeInteger(parsed) || parsed < 0) continue;
    if (maxTurn === null || parsed > maxTurn) maxTurn = parsed;
  }

  return maxTurn;
}
