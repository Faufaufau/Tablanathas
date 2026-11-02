import assert from "node:assert/strict";
import {
  ANATHAS_DETAIL_BATCH_SIZE,
  getAnathasDetailBatchCount,
} from "../src/services/anathas-batch.js";

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

console.info(
  `Collecte Anathas validée : lots de ${ANATHAS_DETAIL_BATCH_SIZE} ; ` +
  cases.map(([countries, batches]) => `${countries}→${batches}`).join(", "),
);
