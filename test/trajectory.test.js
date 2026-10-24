const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluateTrajectory } = require("../trajectory");

const healthy = {
  liquidityUsd: 350_000, volume24h: 220_000, buys24h: 650, sells24h: 500,
  change24h: 12, ageHours: 240, warnings: [], security: { checked: true, penalty: 0 },
};

test("healthy market is relatively stable, but first scan has low confidence", () => {
  const result = evaluateTrajectory(healthy, [{ at: "2026-09-16T12:00:00Z", liquidityUsd: 350_000 }]);
  assert.equal(result.band, "more-stable");
  assert.equal(result.confidence, "Niedrig");
  assert.equal(result.liquidityChangePercent, null);
  assert.match(result.horizon, /6 Stunden/);
  assert.equal(result.inputWindowHours, 24);
});

test("hourly market weakness overrides strong 24-hour activity", () => {
  const result = evaluateTrajectory({ ...healthy, volume1h: 20, buys1h: 1, sells1h: 20, change1h: -45 });
  assert.equal(result.inputWindowHours, 1);
  assert.equal(result.band, "critical");
  assert.ok(result.reasons.some((reason) => reason.includes("1 Stunde")));
});

test("six hours of verified hourly observations can raise confidence", () => {
  const observations = [0, 3, 6].map((hours) => ({ at: new Date(Date.parse("2026-09-16T12:00:00Z") + hours * 3_600_000).toISOString(), liquidityUsd: 350_000 }));
  const result = evaluateTrajectory({ ...healthy, volume1h: 10_000, buys1h: 40, sells1h: 30, change1h: 3 }, observations);
  assert.equal(result.confidence, "Erhöht");
  assert.equal(result.inputWindowHours, 1);
});

test("honeypot never receives a reassuring outlook", () => {
  const result = evaluateTrajectory({ ...healthy, security: { checked: true, isHoneypot: true } });
  assert.equal(result.band, "critical");
  assert.ok(result.reasons.some((reason) => reason.includes("Verkaufbarkeit")));
});

test("thin inactive market is critical", () => {
  const result = evaluateTrajectory({ ...healthy, liquidityUsd: 4_000, volume24h: 800, buys24h: 2, sells24h: 8, ageHours: 3 });
  assert.equal(result.band, "critical");
});

test("material liquidity withdrawal lowers outlook after a spaced observation", () => {
  const at = ["2026-09-16T12:00:00Z", "2026-09-16T12:20:00Z", "2026-09-16T13:10:00Z"];
  const observations = at.map((time, index) => ({ at: time, liquidityUsd: index === 2 ? 105_000 : 350_000 }));
  const result = evaluateTrajectory({ ...healthy, liquidityUsd: 105_000 }, observations);
  assert.equal(result.liquidityChangePercent, -70);
  assert.equal(result.trend, "Liquidität bricht ein");
  assert.notEqual(result.band, "more-stable");
});

test("unverified contract cannot get high confidence", () => {
  const observations = [0, 1, 25].map((hours) => ({ at: new Date(Date.parse("2026-09-15T12:00:00Z") + hours * 3_600_000).toISOString(), liquidityUsd: 350_000 }));
  const result = evaluateTrajectory({ ...healthy, security: { checked: false } }, observations);
  assert.equal(result.confidence, "Niedrig");
});
