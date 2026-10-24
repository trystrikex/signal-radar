const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("frontend renders the operational radar shell", async () => {
  const app = { innerHTML: "" };
  const demoSignal = {
    id: "base:pair", address: "0x123", symbol: "TEST", name: "Test Token", chain: "Base",
    score: 78, risk: "Mittel", ageHours: 2, liquidityUsd: 120000, volume24h: 450000,
    change24h: 22, buys24h: 120, sells24h: 90, imageUrl: "", dexUrl: "https://example.com",
    socials: [], warnings: [{ level: "low", text: "Testhinweis" }], boostAmount: 4,
    scoreParts: { activity: 20, liquidity: 16, balance: 12, freshness: 14, momentum: 10, completeness: 6 },
    security: { checked: true, provider: "GoPlus", penalty: 0, isOpenSource: true },
    socialMetrics: { checked: false, provider: "X" },
    trajectory: { band: "fragile", label: "Fragil", confidence: "Niedrig", horizon: "Nächste 6 Stunden: eng beobachten", inputWindowHours: 1, trend: "Noch kein Verlauf", liquidityChangePercent: null, observations: 1, reasons: ["Begrenzte Liquidität"] },
  };
  const context = {
    console,
    URL,
    Intl,
    navigator: { clipboard: { writeText: async () => {} } },
    localStorage: { getItem: () => null, setItem: () => {} },
    document: {
      querySelector: (selector) => selector === "#app" ? app : null,
      querySelectorAll: () => [],
    },
    window: { setTimeout: () => 1 },
    clearTimeout: () => {},
    fetch: async (url) => ({ ok: true, json: async () => {
      if (url === "/api/status") return { scanIntervalMinutes: 5, alertMinScore: 75, telegram: {}, sources: { dexScreener: true, goPlus: true } };
      if (url === "/api/history") return { history: [] };
      return { mode: "live", signals: [demoSignal], updatedAt: "2026-09-14T18:00:00.000Z" };
    } }),
  };

  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../public/app.js"), "utf8"), context);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.match(app.innerHTML, /Signal Radar/);
  assert.match(app.innerHTML, /Frühwarnsignale/);
  assert.match(app.innerHTML, /TEST/);
  assert.match(app.innerHTML, /Scan starten/);
  assert.match(app.innerHTML, /Trajectory/);
  assert.match(app.innerHTML, /Heuristik, keine kalibrierte Überlebenswahrscheinlichkeit/);
  assert.match(app.innerHTML, /Nächste 6 Stunden/);
  assert.doesNotMatch(app.innerHTML, /Tage/);
});
