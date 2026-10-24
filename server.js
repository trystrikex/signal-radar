const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { evaluateTrajectory } = require("./trajectory");

const PORT = Number(process.env.PORT || 4173);
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const HISTORY_FILE = path.join(DATA_DIR, "history.json");
const SNAPSHOTS_FILE = path.join(DATA_DIR, "snapshots.json");
const CACHE_MS = 60_000;
const SCAN_INTERVAL_MINUTES = Math.max(1, Number(process.env.SCAN_INTERVAL_MINUTES || 5));
const ALERT_MIN_SCORE = Math.max(0, Math.min(100, Number(process.env.ALERT_MIN_SCORE || 75)));
const SOCIAL_SCAN_LIMIT = Math.max(1, Math.min(10, Number(process.env.SOCIAL_SCAN_LIMIT || 5)));
let cache = { at: 0, data: null };
let scanPromise = null;
let history = loadHistory();
let snapshots = loadSnapshots();

function loadSnapshots() {
  try {
    const parsed = JSON.parse(fs.readFileSync(SNAPSHOTS_FILE, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

function recordSnapshots(signals, timestamp) {
  const cutoff = Date.parse(timestamp) - 7 * 24 * 3_600_000;
  for (const signal of signals) {
    const prior = Array.isArray(snapshots[signal.id]) ? snapshots[signal.id] : [];
    snapshots[signal.id] = [...prior.filter((item) => Date.parse(item.at) >= cutoff), {
      at: timestamp, liquidityUsd: signal.liquidityUsd,
    }].slice(-2016);
    signal.trajectory = evaluateTrajectory(signal, snapshots[signal.id]);
  }
  for (const [id, items] of Object.entries(snapshots)) {
    if (!Array.isArray(items) || !items.length || Date.parse(items.at(-1).at) < cutoff) delete snapshots[id];
  }
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SNAPSHOTS_FILE, JSON.stringify(snapshots));
  } catch {
    // Keep the current run useful when persistent storage is unavailable.
  }
}

const chainNames = {
  solana: "Solana",
  base: "Base",
  ethereum: "Ethereum",
  bsc: "BNB Chain",
  arbitrum: "Arbitrum",
};
const securityChainIds = { ethereum: "1", bsc: "56", arbitrum: "42161", base: "8453" };

function loadHistory() {
  try {
    const parsed = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8"));
    return Array.isArray(parsed) ? parsed.slice(0, 250) : [];
  } catch {
    return [];
  }
}

function saveHistory() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history.slice(0, 250), null, 2));
  } catch {
    // The radar can still run with in-memory history on a read-only deployment.
  }
}

function addHistory(events) {
  if (!events.length) return;
  history = [...events, ...history].slice(0, 250);
  saveHistory();
}

function telegramConfigured() {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

function telegramEnabled() {
  return process.env.TELEGRAM_ENABLED === "true" && telegramConfigured();
}

function xConfigured() {
  return Boolean(process.env.X_BEARER_TOKEN);
}

async function sendTelegram(text) {
  if (!telegramConfigured()) throw new Error("Telegram ist nicht vollständig konfiguriert");
  const response = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text, disable_web_page_preview: true }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`Telegram antwortet mit ${response.status}`);
  return response.json();
}

function buildScanEvents(previousSignals, signals, timestamp) {
  const previous = new Map((previousSignals || []).map((signal) => [signal.id, signal]));
  if (!previous.size) {
    return [{ id: `scan-${Date.now()}`, type: "scan", timestamp, message: `Erster Live-Scan mit ${signals.length} Kandidaten abgeschlossen` }];
  }
  const events = [];
  for (const signal of signals) {
    const before = previous.get(signal.id);
    if (!before) {
      events.push({ id: `new-${Date.now()}-${signal.id}`, type: "new", timestamp, tokenId: signal.id, symbol: signal.symbol, chain: signal.chain, score: signal.score, risk: signal.risk, message: `${signal.symbol} neu entdeckt` });
    } else if (Math.abs(signal.score - before.score) >= 8) {
      const direction = signal.score > before.score ? "gestiegen" : "gefallen";
      events.push({ id: `score-${Date.now()}-${signal.id}`, type: "score", timestamp, tokenId: signal.id, symbol: signal.symbol, chain: signal.chain, score: signal.score, previousScore: before.score, risk: signal.risk, message: `${signal.symbol}: Score auf ${signal.score} ${direction}` });
    }
  }
  if (!events.length) events.push({ id: `scan-${Date.now()}`, type: "scan", timestamp, message: `Scan abgeschlossen, ${signals.length} Kandidaten beobachtet` });
  return events;
}

async function notifyNewSignals(events, signals) {
  if (!telegramEnabled()) return;
  const byId = new Map(signals.map((signal) => [signal.id, signal]));
  const alertable = events.filter((event) => event.type === "new").map((event) => byId.get(event.tokenId)).filter((signal) => signal && signal.score >= ALERT_MIN_SCORE && signal.risk !== "Hoch").slice(0, 5);
  if (!alertable.length) return;
  const lines = alertable.map((signal) => `${signal.symbol} · ${signal.chain}\nScore ${signal.score}/100 · Risiko ${signal.risk}\nLiquidität $${Math.round(signal.liquidityUsd).toLocaleString("de-DE")}\n${signal.dexUrl}`);
  await sendTelegram(`Signal Radar: ${alertable.length} neue Kandidaten\n\n${lines.join("\n\n")}`);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function ageHours(createdAt) {
  if (!createdAt) return null;
  return Math.max(0, (Date.now() - Number(createdAt)) / 3_600_000);
}

function calculateScore(pair, boostAmount = 0) {
  const liquidity = Number(pair.liquidity?.usd || 0);
  const volume24 = Number(pair.volume?.h24 || 0);
  const buys = Number(pair.txns?.h24?.buys || 0);
  const sells = Number(pair.txns?.h24?.sells || 0);
  const hours = ageHours(pair.pairCreatedAt);
  const priceChange = Number(pair.priceChange?.h24 || 0);

  const liquidityScore = clamp(Math.log10(Math.max(liquidity, 1)) * 4 - 8, 0, 20);
  const activityScore = clamp(Math.log10(Math.max(volume24, 1)) * 5 - 10, 0, 25);
  const balanceScore = buys + sells > 0 ? clamp(15 - Math.abs(buys - sells) / (buys + sells) * 18, 0, 15) : 0;
  const freshnessScore = hours === null ? 3 : clamp(15 - hours / 24, 0, 15);
  const momentumScore = clamp(Math.log10(Math.max(boostAmount, 1)) * 5 + Math.max(priceChange, 0) / 30, 0, 15);
  const completenessScore = clamp((pair.info?.socials?.length || 0) * 2 + (pair.info?.websites?.length || 0) * 2, 0, 10);
  const score = Math.round(liquidityScore + activityScore + balanceScore + freshnessScore + momentumScore + completenessScore);

  const warnings = [];
  if (liquidity < 25_000) warnings.push({ level: "high", text: "Sehr geringe Liquidität" });
  else if (liquidity < 100_000) warnings.push({ level: "medium", text: "Begrenzte Liquidität" });
  if (sells > 0 && buys / sells > 4) warnings.push({ level: "medium", text: "Ungewöhnlich hoher Kaufdruck" });
  if (Math.abs(priceChange) > 150) warnings.push({ level: "medium", text: "Extreme Preisbewegung" });
  if (!pair.info?.websites?.length) warnings.push({ level: "low", text: "Keine Website in den DEX-Daten" });
  warnings.push({ level: "unknown", text: "Vertragsrechte und Holder-Verteilung ungeprüft" });

  const risk = warnings.some((w) => w.level === "high") ? "Hoch" : warnings.filter((w) => w.level === "medium").length >= 2 ? "Erhöht" : "Mittel";
  return { score, risk, warnings, parts: { liquidity: Math.round(liquidityScore), activity: Math.round(activityScore), balance: Math.round(balanceScore), freshness: Math.round(freshnessScore), momentum: Math.round(momentumScore), completeness: Math.round(completenessScore) } };
}

function numberOrNull(value) {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function applySecurity(signal, raw) {
  if (!raw) return { ...signal, security: { checked: false, provider: "GoPlus", reason: "Für dieses Netzwerk nicht verfügbar" } };

  const findings = [];
  const add = (condition, level, text) => { if (condition) findings.push({ level, text }); };
  const buyTax = numberOrNull(raw.buy_tax);
  const sellTax = numberOrNull(raw.sell_tax);
  const top10Percent = Array.isArray(raw.holders)
    ? raw.holders.slice(0, 10).reduce((sum, holder) => sum + Number(holder.percent || 0), 0) * 100
    : null;
  const lpLocked = Array.isArray(raw.lp_holders) && raw.lp_holders.length
    ? raw.lp_holders.some((holder) => String(holder.is_locked) === "1")
    : null;

  add(raw.is_honeypot === "1", "high", "Honeypot-Indikator erkannt");
  add(raw.cannot_buy === "1", "high", "Token kann laut Prüfung nicht gekauft werden");
  add(raw.cannot_sell_all === "1", "high", "Bestand möglicherweise nicht vollständig verkaufbar");
  add(raw.is_blacklisted === "1", "high", "Blacklist-Funktion erkannt");
  add(raw.hidden_owner === "1", "high", "Versteckter Eigentümer erkannt");
  add(raw.selfdestruct === "1", "high", "Selbstzerstörungsfunktion erkannt");
  add(raw.can_take_back_ownership === "1", "high", "Eigentümerschaft kann zurückgeholt werden");
  add(raw.is_open_source === "0", "high", "Vertrag nicht quelloffen verifiziert");
  add(raw.is_mintable === "1", "medium", "Weitere Token können geprägt werden");
  add(raw.transfer_pausable === "1", "medium", "Transfers können pausiert werden");
  add(raw.slippage_modifiable === "1" || raw.personal_slippage_modifiable === "1", "medium", "Handelsgebühren können verändert werden");
  if (sellTax !== null && sellTax > 0.25) add(true, "high", `Sehr hohe Verkaufssteuer (${(sellTax * 100).toFixed(1)} %)`);
  else if (sellTax !== null && sellTax > 0.1) add(true, "medium", `Hohe Verkaufssteuer (${(sellTax * 100).toFixed(1)} %)`);
  if (top10Percent !== null && top10Percent > 80) add(true, "high", `Top-10-Holder halten ${top10Percent.toFixed(1)} %`);
  else if (top10Percent !== null && top10Percent > 60) add(true, "medium", `Top-10-Holder halten ${top10Percent.toFixed(1)} %`);
  add(lpLocked === false, "medium", "Keine gesperrte Liquidität erkannt");

  const highCount = findings.filter((item) => item.level === "high").length;
  const mediumCount = findings.filter((item) => item.level === "medium").length;
  const penalty = Math.min(45, highCount * 18 + mediumCount * 7);
  const warnings = signal.warnings.filter((item) => !item.text.includes("Vertragsrechte und Holder-Verteilung ungeprüft"));
  if (!findings.length) warnings.push({ level: "low", text: "Keine kritischen Vertragsindikatoren gefunden" });
  warnings.push(...findings);

  return {
    ...signal,
    score: Math.max(0, signal.score - penalty),
    risk: highCount ? "Hoch" : mediumCount >= 2 ? "Erhöht" : signal.risk,
    warnings,
    security: {
      checked: true,
      provider: "GoPlus",
      penalty,
      isOpenSource: raw.is_open_source === "1",
      isHoneypot: raw.is_honeypot === "1",
      buyTax,
      sellTax,
      holderCount: numberOrNull(raw.holder_count),
      top10Percent,
      lpLocked,
    },
  };
}

async function enrichSecurity(signals) {
  const groups = new Map();
  for (const signal of signals) {
    const chainId = securityChainIds[signal.chainId];
    if (!chainId) continue;
    if (!groups.has(chainId)) groups.set(chainId, []);
    groups.get(chainId).push(signal);
  }

  const securityByAddress = new Map();
  await Promise.all([...groups.entries()].map(async ([chainId, group]) => {
    try {
      const addresses = group.map((signal) => signal.address).join(",");
      const data = await fetchJson(`https://api.gopluslabs.io/api/v1/token_security/${chainId}?contract_addresses=${encodeURIComponent(addresses)}`);
      for (const [address, security] of Object.entries(data.result || {})) securityByAddress.set(address.toLowerCase(), security);
    } catch {
      // A security provider outage must not block the market scan.
    }
  }));

  return signals.map((signal) => applySecurity(signal, securityByAddress.get(signal.address.toLowerCase()))).sort((a, b) => b.score - a.score);
}

async function fetchXMetrics(signal) {
  const url = new URL("https://api.x.com/2/tweets/search/recent");
  const address = String(signal.address).replace(/[^a-zA-Z0-9]/g, "").slice(0, 80);
  const symbol = String(signal.symbol).replace(/[^\p{L}\p{N}_]/gu, "").slice(0, 20);
  url.searchParams.set("query", symbol ? `\"${address}\" OR \"$${symbol}\" -is:retweet` : `\"${address}\" -is:retweet`);
  url.searchParams.set("max_results", "10");
  url.searchParams.set("tweet.fields", "author_id,public_metrics,created_at");
  const response = await fetch(url, { headers: { authorization: `Bearer ${process.env.X_BEARER_TOKEN}`, accept: "application/json" }, signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`X antwortet mit ${response.status}`);
  const data = await response.json();
  const posts = data.data || [];
  const engagement = posts.reduce((sum, post) => {
    const metrics = post.public_metrics || {};
    return sum + Number(metrics.like_count || 0) + Number(metrics.retweet_count || 0) + Number(metrics.reply_count || 0) + Number(metrics.quote_count || 0);
  }, 0);
  const uniqueAuthors = new Set(posts.map((post) => post.author_id).filter(Boolean)).size;
  const bonus = clamp(Math.round(Math.log2(posts.length + 1) * 2 + Math.log10(engagement + 1)), 0, 8);
  return { checked: true, provider: "X", mentions: posts.length, uniqueAuthors, engagement, bonus, checkedAt: new Date().toISOString() };
}

async function enrichSocial(signals) {
  if (!xConfigured()) return signals.map((signal) => ({ ...signal, socialMetrics: { checked: false, provider: "X", reason: "Nicht konfiguriert" } }));
  const prioritized = new Set(signals.slice(0, SOCIAL_SCAN_LIMIT).map((signal) => signal.id));
  const enriched = [];
  for (const signal of signals) {
    if (!prioritized.has(signal.id)) {
      enriched.push({ ...signal, socialMetrics: { checked: false, provider: "X", reason: "Außerhalb des Scan-Limits" } });
      continue;
    }
    try {
      const socialMetrics = await fetchXMetrics(signal);
      const warnings = [...signal.warnings];
      if (socialMetrics.mentions >= 8 && socialMetrics.uniqueAuthors <= 2) warnings.push({ level: "medium", text: "X-Aktivität konzentriert sich auf wenige Accounts" });
      enriched.push({ ...signal, score: Math.min(100, signal.score + socialMetrics.bonus), warnings, socialMetrics });
    } catch (error) {
      enriched.push({ ...signal, socialMetrics: { checked: false, provider: "X", reason: error.message } });
    }
  }
  return enriched.sort((a, b) => b.score - a.score);
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { accept: "application/json", "user-agent": "signal-radar/0.1" }, signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`Quelle antwortet mit ${response.status}`);
  return response.json();
}

function selectCandidates(newPools, latestBoosts, profiles, topBoosts) {
  const selected = new Map();
  for (const [items, limit] of [[newPools, 10], [latestBoosts, 25], [profiles, 20], [topBoosts, 10]]) {
    let added = 0;
    for (const item of items) {
      if (!chainNames[item.chainId] || !item.tokenAddress) continue;
      const key = `${item.chainId}:${item.tokenAddress}`;
      if (selected.has(key)) {
        const existing = selected.get(key);
        if (Number(item.totalAmount || item.amount || 0) > Number(existing.totalAmount || existing.amount || 0)) selected.set(key, item);
      } else if (added < limit) {
        selected.set(key, item);
        added++;
      }
    }
  }
  return [...selected.values()];
}

function isRelevantEarlyPair(pair) {
  const hours = ageHours(pair.pairCreatedAt);
  if (hours === null || hours > 1) return true;
  const trades = Number(pair.txns?.h1?.buys || 0) + Number(pair.txns?.h1?.sells || 0);
  return Number(pair.liquidity?.usd || 0) >= 10_000 && Number(pair.volume?.h1 || 0) >= 5_000 && trades >= 10;
}

async function loadNewPoolCandidates() {
  const networks = ["solana", "base"];
  const results = await Promise.allSettled(networks.map((network) =>
    fetchJson(`https://api.geckoterminal.com/api/v2/networks/${network}/new_pools?include=base_token`)));
  const candidates = [];
  for (const [index, result] of results.entries()) {
    if (result.status !== "fulfilled") continue;
    const data = result.value;
    const tokens = new Map((data.included || []).map((token) => [token.id, token.attributes?.address]));
    for (const pool of data.data || []) {
      const network = networks[index];
      const address = tokens.get(pool.relationships?.base_token?.data?.id);
      const createdAt = Date.parse(pool.attributes?.pool_created_at);
      const trades = Number(pool.attributes?.transactions?.h1?.buys || 0) + Number(pool.attributes?.transactions?.h1?.sells || 0);
      if (!chainNames[network] || !address || !Number.isFinite(createdAt) || Date.now() - createdAt > 60 * 60_000) continue;
      if (Number(pool.attributes?.reserve_in_usd || 0) < 10_000 || Number(pool.attributes?.volume_usd?.h1 || 0) < 5_000 || trades < 10) continue;
      candidates.push({ chainId: network, tokenAddress: address });
    }
  }
  return candidates.slice(0, 10);
}

async function loadLiveSignals() {
  const [latestBoosts, profiles, topBoosts, newPools] = await Promise.all([
    fetchJson("https://api.dexscreener.com/token-boosts/latest/v1"),
    fetchJson("https://api.dexscreener.com/token-profiles/latest/v1"),
    fetchJson("https://api.dexscreener.com/token-boosts/top/v1"),
    loadNewPoolCandidates(),
  ]);
  const supported = selectCandidates(newPools, latestBoosts, profiles, topBoosts);
  const settled = await Promise.allSettled(supported.map(async (boost) => {
    const pairs = await fetchJson(`https://api.dexscreener.com/token-pairs/v1/${encodeURIComponent(boost.chainId)}/${encodeURIComponent(boost.tokenAddress)}`);
    const pair = pairs.filter((item) => item.baseToken?.address?.toLowerCase() === boost.tokenAddress.toLowerCase() && isRelevantEarlyPair(item))
      .sort((a, b) => Number(b.liquidity?.usd || 0) - Number(a.liquidity?.usd || 0))[0];
    if (!pair) return null;
    const assessment = calculateScore(pair, Number(boost.totalAmount || boost.amount || 0));
    const socials = (pair.info?.socials || []).map((social) => ({ type: social.type || "social", url: social.url }));
    return {
      id: `${pair.chainId}:${pair.pairAddress}`,
      address: pair.baseToken.address,
      pairAddress: pair.pairAddress,
      symbol: pair.baseToken.symbol,
      name: pair.baseToken.name,
      chain: chainNames[pair.chainId] || pair.chainId,
      chainId: pair.chainId,
      score: assessment.score,
      risk: assessment.risk,
      warnings: assessment.warnings,
      scoreParts: assessment.parts,
      priceUsd: Number(pair.priceUsd || 0),
      change24h: Number(pair.priceChange?.h24 || 0),
      change1h: numberOrNull(pair.priceChange?.h1),
      liquidityUsd: Number(pair.liquidity?.usd || 0),
      volume24h: Number(pair.volume?.h24 || 0),
      volume1h: numberOrNull(pair.volume?.h1),
      buys24h: Number(pair.txns?.h24?.buys || 0),
      sells24h: Number(pair.txns?.h24?.sells || 0),
      buys1h: numberOrNull(pair.txns?.h1?.buys),
      sells1h: numberOrNull(pair.txns?.h1?.sells),
      ageHours: ageHours(pair.pairCreatedAt),
      dexUrl: pair.url,
      imageUrl: pair.info?.imageUrl || "",
      websites: pair.info?.websites || [],
      socials,
      boostAmount: Number(boost.totalAmount || boost.amount || 0),
    };
  }));

  const signals = settled.map((result) => result.status === "fulfilled" ? result.value : null).filter(Boolean);
  return enrichSocial(await enrichSecurity(signals));
}

function demoSignals() {
  const seeds = [
    ["NEKO", "Neko AI", "Solana", 84, 212000, 640000, 132, 18, "Mittel"],
    ["FROG", "Frog Terminal", "Base", 78, 164000, 418000, 88, 41, "Erhöht"],
    ["MOONI", "Mooni", "Solana", 73, 121000, 302000, 64, 57, "Mittel"],
    ["DINO", "Dino Coin", "Ethereum", 66, 92000, 196000, 37, 79, "Erhöht"],
    ["NYAN", "Nyan Coin", "Base", 59, 71000, 112000, 18, 95, "Hoch"],
    ["BILLY", "Just a Billy", "Base", 57, 68000, 97000, 15, 110, "Mittel"],
    ["TREX", "T-Rex", "Solana", 55, 61000, 86000, 12, 126, "Mittel"],
    ["GOON", "Gooner", "Arbitrum", 52, 54000, 72000, 8, 142, "Mittel"],
    ["KABU", "Kabosu AI", "Solana", 48, 47000, 62000, -3, 151, "Erhöht"],
    ["SMOL", "Smol Doge", "Solana", 46, 42000, 58000, 6, 164, "Mittel"],
    ["PEPE2", "Pepe 2.0", "Ethereum", 43, 38000, 51000, -5, 173, "Erhöht"],
    ["HODL", "HODL Coin", "Base", 39, 31000, 44000, -9, 190, "Hoch"],
  ];
  return seeds.map(([symbol, name, chain, score, liquidityUsd, volume24h, change24h, ageHours, risk], index) => ({
    id: `demo-${index}`, address: "Demo-Adresse", pairAddress: "", symbol, name, chain, chainId: chain.toLowerCase(), score, risk,
    liquidityUsd, volume24h, change24h, ageHours, priceUsd: 0.0001 * (index + 1), buys24h: 1200 - index * 130, sells24h: 680 + index * 90,
    volume1h: Math.round(volume24h / 24), change1h: change24h / 8, buys1h: Math.round((1200 - index * 130) / 24), sells1h: Math.round((680 + index * 90) / 24),
    warnings: [{ level: index > 2 ? "high" : "medium", text: index > 2 ? "Liquidität unter Beobachtung" : "Holder-Verteilung ungeprüft" }, { level: "unknown", text: "Vertragsrechte nicht geprüft" }],
    scoreParts: { liquidity: 15 - index, activity: 22 - index * 2, balance: 13 - index, freshness: 12 - index, momentum: 14 - index, completeness: 8 },
    socials: [{ type: "twitter", url: "#" }], websites: [], dexUrl: "#", boostAmount: 0, security: { checked: false, provider: "GoPlus", reason: "Demo-Datensatz" }, socialMetrics: { checked: false, provider: "X", reason: "Demo-Datensatz" },
  })).map((signal) => ({ ...signal, trajectory: evaluateTrajectory(signal) }));
}

async function performScan() {
  const previousSignals = cache.data?.mode === "live" ? cache.data.signals : [];
  const signals = await loadLiveSignals();
  if (!signals.length) throw new Error("Keine Kandidaten geliefert");
  const updatedAt = new Date().toISOString();
  recordSnapshots(signals, updatedAt);
  const events = buildScanEvents(previousSignals, signals, updatedAt);
  cache = { at: Date.now(), data: { mode: "live", signals, updatedAt } };
  addHistory(events);
  notifyNewSignals(events, signals).catch((error) => addHistory([{ id: `telegram-${Date.now()}`, type: "error", timestamp: new Date().toISOString(), message: `Telegram-Alarm fehlgeschlagen: ${error.message}` }]));
  return cache.data;
}

async function getSignals(force = false) {
  if (!force && cache.data && Date.now() - cache.at < CACHE_MS) return cache.data;
  if (scanPromise) return scanPromise;
  scanPromise = (async () => {
  try {
    return await performScan();
  } catch (error) {
    cache = { at: Date.now(), data: { mode: "demo", signals: demoSignals(), updatedAt: new Date().toISOString(), message: error.message } };
    addHistory([{ id: `error-${Date.now()}`, type: "error", timestamp: cache.data.updatedAt, message: `Live-Scan fehlgeschlagen: ${error.message}` }]);
    return cache.data;
  } finally {
    scanPromise = null;
  }
  })();
  return scanPromise;
}

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function serveFile(req, res) {
  const requested = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  const filePath = path.normalize(path.join(PUBLIC_DIR, requested));
  if (!filePath.startsWith(PUBLIC_DIR)) return sendJson(res, 403, { error: "Nicht erlaubt" });
  fs.readFile(filePath, (error, data) => {
    if (error) return sendJson(res, 404, { error: "Nicht gefunden" });
    const ext = path.extname(filePath);
    const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml" };
    res.writeHead(200, { "content-type": `${types[ext] || "application/octet-stream"}; charset=utf-8` });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.url?.startsWith("/api/signals")) {
    try { return sendJson(res, 200, await getSignals(req.url.includes("refresh=1"))); }
    catch (error) { return sendJson(res, 500, { error: error.message }); }
  }
  if (req.url === "/api/history") return sendJson(res, 200, { history });
  if (req.url === "/api/status") return sendJson(res, 200, {
    scanIntervalMinutes: SCAN_INTERVAL_MINUTES,
    alertMinScore: ALERT_MIN_SCORE,
    telegram: { configured: telegramConfigured(), enabled: telegramEnabled() },
    sources: { dexScreener: true, goPlus: true, x: xConfigured(), reddit: false },
  });
  if (req.url === "/api/telegram/test" && req.method === "POST") {
    try {
      await sendTelegram("Signal Radar ist verbunden. Testnachricht erfolgreich.");
      addHistory([{ id: `telegram-${Date.now()}`, type: "telegram", timestamp: new Date().toISOString(), message: "Telegram-Testnachricht versendet" }]);
      return sendJson(res, 200, { ok: true });
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }
  serveFile(req, res);
});

if (require.main === module) server.listen(PORT, "127.0.0.1", () => {
  console.log(`Signal Radar läuft auf http://127.0.0.1:${PORT}`);
  getSignals(true).catch(() => {});
  setInterval(() => getSignals(true).catch(() => {}), SCAN_INTERVAL_MINUTES * 60_000).unref();
});

module.exports = { calculateScore, applySecurity, buildScanEvents, demoSignals, selectCandidates, isRelevantEarlyPair };
