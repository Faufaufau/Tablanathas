import assert from "node:assert/strict";
import {
  ANATHAS_DETAIL_BATCH_SIZE,
  getAnathasDetailBatchCount,
} from "../src/services/anathas-batch.js";
import { getMaxAnathasSeniorityTurn } from "../src/services/anathas-turn.js";

const cases: Array<[number, number]> = [
  [0, 0],
  [1, 1],
  [40, 1],
  [41, 2],
  [80, 2],
  [81, 3],
  [116, 3],
  [120, 3],
  [121, 4],
  [160, 4],
  [161, 5],
];

for (const [countries, expectedBatches] of cases) {
  assert.equal(
    getAnathasDetailBatchCount(countries),
    expectedBatches,
    `${countries} pays doivent nécessiter ${expectedBatches} lot(s)`,
  );
}

assert.throws(() => getAnathasDetailBatchCount(-1), RangeError);
assert.throws(() => getAnathasDetailBatchCount(1.5), RangeError);
assert.throws(() => getAnathasDetailBatchCount(Number.MAX_SAFE_INTEGER + 1), RangeError);

// Le cycle global doit toujours correspondre à la plus grande ancienneté
// entière réellement fournie par Anathas, jamais à un compteur Cron incrémenté.
assert.equal(getMaxAnathasSeniorityTurn(["7", "9", "8", null]), 9);
assert.equal(getMaxAnathasSeniorityTurn(["2", " 12 ", "4"]), 12);
assert.equal(getMaxAnathasSeniorityTurn(["0", 0, "invalid", "1.5", null]), 0);
assert.equal(getMaxAnathasSeniorityTurn([null, undefined, "", "invalid"]), null);
assert.equal(getMaxAnathasSeniorityTurn([String(Number.MAX_SAFE_INTEGER + 1)]), null);

console.info(
  `Collecte Anathas validée : lots de ${ANATHAS_DETAIL_BATCH_SIZE} ; ` +
  cases.map(([countries, batches]) => `${countries}→${batches}`).join(", ") +
  ` ; synchronisation du cycle par MAX(seniority_cycles) validée`,
);
