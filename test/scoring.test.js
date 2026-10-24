const test = require("node:test");
const assert = require("node:assert/strict");
const { calculateScore, applySecurity, buildScanEvents, demoSignals, selectCandidates, isRelevantEarlyPair } = require("../server");

test("recent candidates keep priority and duplicate boosts do not consume slots", () => {
  const latest = Array.from({ length: 30 }, (_, index) => ({ chainId: "solana", tokenAddress: `new-${index}`, amount: 1 }));
  const selected = selectCandidates([{ chainId: "base", tokenAddress: "pool" }], latest, [{ chainId: "base", tokenAddress: "profile" }], [{ chainId: "solana", tokenAddress: "new-0", totalAmount: 3 }, { chainId: "base", tokenAddress: "top" }]);
  assert.equal(selected.length, 28);
  assert.ok(selected.some((item) => item.tokenAddress === "new-24"));
  assert.ok(!selected.some((item) => item.tokenAddress === "new-25"));
  assert.equal(selected.find((item) => item.tokenAddress === "new-0").totalAmount, 3);
});

test("minute-old pairs need minimum liquidity and trading activity", () => {
  const pair = { pairCreatedAt: Date.now() - 5 * 60_000, liquidity: { usd: 15_000 }, volume: { h1: 6_000 }, txns: { h1: { buys: 8, sells: 4 } } };
  assert.equal(isRelevantEarlyPair(pair), true);
  assert.equal(isRelevantEarlyPair({ ...pair, liquidity: { usd: 2_000 } }), false);
  assert.equal(isRelevantEarlyPair({ ...pair, txns: { h1: { buys: 2, sells: 1 } } }), false);
});

test("score stays within the 0 to 100 range", () => {
  const result = calculateScore({ liquidity: { usd: 10_000_000 }, volume: { h24: 100_000_000 }, txns: { h24: { buys: 1000, sells: 1000 } }, priceChange: { h24: 400 }, pairCreatedAt: Date.now(), info: { socials: [{}, {}], websites: [{}] } }, 1000);
  assert.ok(result.score >= 0 && result.score <= 100);
});

test("thin liquidity creates a high risk warning", () => {
  const result = calculateScore({ liquidity: { usd: 1000 }, volume: { h24: 3000 }, txns: { h24: { buys: 10, sells: 8 } }, priceChange: { h24: 4 } });
  assert.equal(result.risk, "Hoch");
});

test("fallback keeps at least ten clearly marked rows available", () => {
  assert.ok(demoSignals().length >= 10);
});

test("honeypot finding lowers score and forces high risk", () => {
  const signal = { score: 80, risk: "Mittel", warnings: [{ level: "unknown", text: "Vertragsrechte und Holder-Verteilung ungeprüft" }] };
  const result = applySecurity(signal, { is_honeypot: "1", is_open_source: "1", holders: [], lp_holders: [] });
  assert.equal(result.risk, "Hoch");
  assert.ok(result.score < 80);
  assert.equal(result.security.isHoneypot, true);
});

test("clean security result removes the unknown contract warning", () => {
  const signal = { score: 70, risk: "Mittel", warnings: [{ level: "unknown", text: "Vertragsrechte und Holder-Verteilung ungeprüft" }] };
  const result = applySecurity(signal, { is_honeypot: "0", is_open_source: "1", holders: [], lp_holders: [] });
  assert.equal(result.security.checked, true);
  assert.equal(result.security.penalty, 0);
  assert.ok(result.warnings.some((item) => item.text.includes("Keine kritischen")));
});

test("empty optional security values do not break enrichment", () => {
  const signal = { score: 70, risk: "Mittel", warnings: [{ level: "unknown", text: "Vertragsrechte und Holder-Verteilung ungeprüft" }] };
  const result = applySecurity(signal, { buy_tax: "", sell_tax: "", is_honeypot: "0", holders: null, lp_holders: null });
  assert.equal(result.security.buyTax, null);
  assert.equal(result.security.top10Percent, null);
});

test("scan history recognizes newly discovered tokens", () => {
  const events = buildScanEvents([{ id: "known", score: 70 }], [{ id: "known", score: 72 }, { id: "new", symbol: "NEW", chain: "Base", score: 81, risk: "Mittel" }], "2026-09-14T18:00:00.000Z");
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "new");
  assert.equal(events[0].symbol, "NEW");
});

test("scan history records material score changes", () => {
  const events = buildScanEvents([{ id: "coin", score: 60 }], [{ id: "coin", symbol: "COIN", chain: "Base", score: 71, risk: "Mittel" }], "2026-09-14T18:00:00.000Z");
  assert.equal(events[0].type, "score");
  assert.equal(events[0].previousScore, 60);
});
